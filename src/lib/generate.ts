import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ReasoningEffort } from 'openai/resources/shared';
import * as z4 from 'zod/v4';
import { anthropic } from './anthropic';
import { openai } from './openai';
import { AiProviderError, PROVIDER_LABEL, PROVIDER_MODEL, type AiProvider } from './ai';
import type { TokenUsage } from './pricing';
import { logger } from '../services/logger.service';

/**
 * One call, one answer, whichever vendor produced it.
 *
 * `model` travels with the result rather than being read back from a constant:
 * it is what gets recorded against the spend and stamped on the saved document,
 * and those must name the model that actually ran.
 */
export interface AiResult<T> {
  output: T;
  usage: TokenUsage;
  model: string;
}

/**
 * Anthropic system blocks, with the cache breakpoint on the LAST one when asked
 * for — a breakpoint covers everything before it, so one at the end caches the
 * whole prefix rather than only the first block.
 */
const systemBlocks = (system: string[], cache: boolean) =>
  system.map((text, i) => ({
    type: 'text' as const,
    text,
    ...(cache && i === system.length - 1
      ? { cache_control: { type: 'ephemeral' as const } }
      : {}),
  }));

/**
 * GPT-5.6 Luna reasons at `medium` by default. Reasoning tokens bill at the
 * output rate, and neither generator is a reasoning problem — the shape is
 * fixed by a schema and the facts are supplied — so this is held at `low`,
 * which keeps a run roughly comparable to Haiku 4.5 running without thinking.
 */
const OPENAI_EFFORT: ReasoningEffort = 'low';

/**
 * Anthropic reports `input_tokens` as the UNCACHED REMAINDER. OpenAI reports it
 * as the whole prompt, with the cached and cache-written parts broken out
 * underneath — so those have to come off the top, or every cached token is
 * billed twice: once at the full rate here and again at the cache rate in
 * pricing.
 */
function openAiUsage(
  u:
    | {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
      }
    | null
    | undefined,
): TokenUsage {
  const cacheRead = u?.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = u?.input_tokens_details?.cache_write_tokens ?? 0;
  return {
    input_tokens: Math.max(0, (u?.input_tokens ?? 0) - cacheRead - cacheWrite),
    output_tokens: u?.output_tokens ?? 0,
    cache_creation_input_tokens: cacheWrite,
    cache_read_input_tokens: cacheRead,
  };
}

/**
 * OpenAI's strict structured outputs reject a schema that leaves any object
 * open or any property optional, and zod's emitter marks neither. Rather than
 * hand-maintaining a second copy of every schema, the generated one is walked
 * once and closed: `additionalProperties: false`, every property required.
 *
 * Safe for these schemas specifically because they are objects, arrays, strings
 * and booleans with no optionals — nothing in them wants to be absent, so
 * requiring everything changes no meaning.
 */
function closeObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closeObjects);
  if (node === null || typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = closeObjects(v);

  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as Record<string, unknown>);
  }
  return out;
}

function jsonSchemaOf(schema: z4.ZodType): Record<string, unknown> {
  const raw = z4.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  // `$schema` is not part of the subset OpenAI accepts.
  delete raw.$schema;
  return closeObjects(raw) as Record<string, unknown>;
}

export interface CallInput {
  provider: AiProvider;
  /**
   * System blocks in order, stable content first. Anthropic takes them as
   * separate blocks; OpenAI joins them into one `instructions` string. Both
   * cache on the prompt prefix, so the order is what makes caching possible.
   */
  system: string[];
  user: string;
  maxTokens: number;
  /**
   * Ask for a cache breakpoint at the end of the system blocks.
   *
   * ONLY MEANINGFUL ON CLAUDE. OpenAI caches eligible prefixes automatically
   * with nothing to declare, which is why the two providers were not costing
   * the same for the same work before this existed.
   *
   * Set it where the prefix is genuinely repeated AND long enough to qualify:
   * Haiku 4.5 needs 4096 tokens before caching engages, and a breakpoint under
   * that is silently ignored — no error, just `cache_creation_input_tokens: 0`.
   * Passing it on a short prefix is therefore harmless but pointless.
   */
  cacheSystem?: boolean;
}

/** A refusal, or a body nothing can be done with. The caller picks the status. */
export class AiOutputError extends Error {
  constructor(
    message: string,
    readonly kind: 'refused' | 'unusable',
  ) {
    super(message);
    this.name = 'AiOutputError';
  }
}

/**
 * Ask for JSON matching `schema`, and get it back parsed.
 *
 * Both vendors constrain generation to the schema rather than being asked for
 * JSON in prose, so a response that arrives is a response that fits — the
 * validation below is a guard, not the mechanism.
 */
export async function structuredCall<S extends z4.ZodType>(
  input: CallInput & { schema: S; schemaName: string },
): Promise<AiResult<z4.infer<S>>> {
  const { provider, system, user, maxTokens, schema, schemaName, cacheSystem } = input;
  const model = PROVIDER_MODEL[provider];

  if (provider === 'claude') {
    const res = await anthropic()
      .messages.parse({
        model,
        max_tokens: maxTokens,
        // No `effort`: Haiku 4.5 rejects output_config.effort with a 400.
        output_config: { format: zodOutputFormat(schema) },
        system: systemBlocks(system, cacheSystem === true),
        messages: [{ role: 'user', content: user }],
      })
      .catch((err) => mapProviderError(provider, err));

    if (res.stop_reason === 'refusal') {
      throw new AiOutputError(`${PROVIDER_LABEL[provider]} declined this request.`, 'refused');
    }
    if (!res.parsed_output) {
      throw new AiOutputError(
        `${PROVIDER_LABEL[provider]} returned nothing usable. Try again.`,
        'unusable',
      );
    }
    return { output: res.parsed_output as z4.infer<S>, usage: res.usage, model };
  }

  const res = await openai()
    .responses.create({
      model,
      max_output_tokens: maxTokens,
      reasoning: { effort: OPENAI_EFFORT },
      instructions: system.join('\n\n'),
      input: [{ role: 'user', content: user }],
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          schema: jsonSchemaOf(schema),
          strict: true,
        },
      },
    })
    .catch((err) => mapProviderError(provider, err));

  const refusal = openAiRefusal(res.output);
  if (refusal) throw new AiOutputError(refusal, 'refused');

  const text = res.output_text?.trim();
  if (!text) {
    throw new AiOutputError(
      res.status === 'incomplete'
        ? `OpenAI stopped early (${res.incomplete_details?.reason ?? 'unknown reason'}). Try again.`
        : 'OpenAI returned nothing usable. Try again.',
      'unusable',
    );
  }

  // Strict mode guarantees the shape, so a failure here is a genuine surprise
  // and must not surface as a raw zod dump to whoever clicked Generate.
  const parsed = z4.safeParse(schema, safeJson(text));
  if (!parsed.success) {
    logger.error('OpenAI structured output did not match the schema', {
      schemaName,
      issues: parsed.error.issues.slice(0, 5),
    });
    throw new AiOutputError('OpenAI returned a malformed document. Try again.', 'unusable');
  }

  return { output: parsed.data, usage: openAiUsage(res.usage), model };
}

/** Prose, not a schema — the "Ask AI about a job" answer a person reads. */
export async function textCall(input: CallInput): Promise<AiResult<string>> {
  const { provider, system, user, maxTokens, cacheSystem } = input;
  const model = PROVIDER_MODEL[provider];

  if (provider === 'claude') {
    const res = await anthropic()
      .messages.create({
        model,
        max_tokens: maxTokens,
        // Plain text, not a parsed schema: the answer is prose a person reads,
        // and forcing it through a JSON envelope would buy nothing and cost
        // tokens on both sides.
        //
        // No `effort`: Haiku 4.5 rejects it with a 400.
        system: systemBlocks(system, cacheSystem === true),
        messages: [{ role: 'user', content: user }],
      })
      .catch((err) => mapProviderError(provider, err));

    if (res.stop_reason === 'refusal') {
      throw new AiOutputError(`${PROVIDER_LABEL[provider]} declined this question.`, 'refused');
    }
    // Narrowed inline rather than with a type predicate: the SDK's union
    // includes blocks that carry no `text` at all, and a hand-written guard has
    // to match `ContentBlock` exactly to be assignable.
    const answer = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    if (!answer) {
      throw new AiOutputError('The AI returned an empty answer. Try rephrasing.', 'unusable');
    }
    return { output: answer, usage: res.usage, model };
  }

  const res = await openai()
    .responses.create({
      model,
      max_output_tokens: maxTokens,
      reasoning: { effort: OPENAI_EFFORT },
      instructions: system.join('\n\n'),
      input: [{ role: 'user', content: user }],
    })
    .catch((err) => mapProviderError(provider, err));

  const refusal = openAiRefusal(res.output);
  if (refusal) throw new AiOutputError(refusal, 'refused');

  const answer = res.output_text?.trim();
  if (!answer) {
    throw new AiOutputError('The AI returned an empty answer. Try rephrasing.', 'unusable');
  }
  return { output: answer, usage: openAiUsage(res.usage), model };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * A safety refusal arrives as a 200 with a `refusal` content part rather than
 * as an error, so code that only reads `output_text` sees an empty answer and
 * reports "try again" for something retrying cannot fix.
 */
function openAiRefusal(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if ((part as { type?: string })?.type === 'refusal') {
        return (part as { refusal?: string }).refusal || 'OpenAI declined this request.';
      }
    }
  }
  return null;
}

/**
 * Turn a vendor failure into something that names the fix.
 *
 * The three that matter are told apart because each is someone else's job: no
 * credit is billing, a rejected key is deployment, a rate limit is "wait".
 * Collapsing them into "the AI failed" sends people hunting.
 */
function mapProviderError(provider: AiProvider, err: unknown): never {
  const e = err as {
    status?: number;
    code?: string;
    type?: string;
    error?: { error?: { message?: string }; message?: string; code?: string; type?: string };
    message?: string;
  };
  const msg = e.error?.error?.message ?? e.error?.message ?? e.message ?? '';
  const code = e.code ?? e.error?.code ?? e.error?.type ?? '';
  const label = PROVIDER_LABEL[provider];

  if (/credit balance is too low/i.test(msg) || /insufficient_quota/i.test(`${code}${msg}`)) {
    throw new AiProviderError(
      provider === 'claude'
        ? 'The Anthropic account has no API credits. Add credits at platform.claude.com under Billing.'
        : 'The OpenAI account has no remaining quota. Add credits at platform.openai.com under Billing.',
      503,
    );
  }
  if (e.status === 401 || e.status === 403) {
    const key = provider === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    throw new AiProviderError(`The ${label} API key was rejected. Check ${key}.`, 503);
  }
  if (e.status === 429) {
    throw new AiProviderError(`Rate limited by ${label}. Wait a moment and try again.`, 429);
  }

  logger.error(`${label} call failed`, { status: e.status, code, msg });
  throw new AiProviderError(`The ${label} service failed. Try again.`, 502);
}
