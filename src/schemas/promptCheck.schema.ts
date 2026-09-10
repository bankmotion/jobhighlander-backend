import * as z4 from 'zod/v4';

/**
 * What the review says about one instruction the admin wrote.
 *
 * Keyed on EFFECT rather than severity. "How bad is this" is a judgement the
 * admin is better placed to make than the model — they know what they were
 * trying to achieve. "Does this reach the output" is the fact they cannot get
 * any other way, and it is the only thing worth a billable call.
 */
export const promptCheckFindingSchema = z4.object({
  quote: z4
    .string()
    .describe(
      "The admin's own words, copied exactly, cut to the operative clause. " +
        'Never paraphrased: they need to find it in their own text.',
    ),
  effect: z4
    .enum(['ignored', 'weakened', 'reinterpreted', 'inapplicable'])
    .describe(
      'ignored = the application prompt forbids it and it changes nothing. ' +
        'weakened = it lands, but a rule above it caps how far. ' +
        'reinterpreted = it lands, but not as written. ' +
        'inapplicable = nothing is stopping it, but the candidate record has ' +
        'nothing for it to act on — it names a role, employer or career shape ' +
        'this person does not have.',
    ),
  reason: z4
    .string()
    .describe(
      'One sentence naming the rule that wins, in plain language. The effect ' +
        'of the rule, never where it lives in the prompt.',
    ),
  fix: z4
    .string()
    .describe(
      'What to write instead so the intent survives, or where else to make ' +
        'the change. Says so plainly when the intent cannot survive at all.',
    ),
});

export const promptCheckSchema = z4.object({
  verdict: z4
    .enum(['clean', 'partial', 'conflicts'])
    .describe('clean = all of it lands. partial = some does not. conflicts = most does not.'),
  summary: z4
    .string()
    .describe(
      'One sentence, read before anything is expanded. Leads with the count ' +
        'that matters.',
    ),
  findings: z4
    .array(promptCheckFindingSchema)
    .describe(
      'Only the instructions that do NOT land as written. An instruction that ' +
        'works is absent, because a list that reports everything reports nothing.',
    ),
});

export type PromptCheckFinding = z4.infer<typeof promptCheckFindingSchema>;
export type PromptCheck = z4.infer<typeof promptCheckSchema>;

/**
 * The longest addendum that can be saved.
 *
 * The application prompt is roughly nine thousand characters. An addendum
 * allowed to rival it stops being an addendum and becomes a second prompt
 * competing with the first, which is exactly the arrangement this feature was
 * shaped to avoid.
 */
export const CUSTOM_PROMPT_MAX = 4_000;

/**
 * The fence the addendum is delivered inside, and the reason the text is
 * cleaned before it is stored.
 *
 * An addendum containing its own closing fence could end the block early and
 * have whatever followed read as top-level instruction. Admins are trusted
 * enough that this is a guard against accident rather than attack — someone
 * pasting a formatted document is far likelier than someone crafting an escape
 * — but it costs one regex either way.
 */
const FENCE = '='.repeat(20);
const FENCE_LINE = /^[ \t]*={4,}[ \t]*$/gm;

/** Strip anything that could close the fence early. */
export const sanitizeCustomPrompt = (raw: string): string =>
  raw.replace(FENCE_LINE, '').trim();

/**
 * Wrap the addendum for delivery as its own system block.
 *
 * Returns null for empty input, and the caller sends NO block at all in that
 * case. An empty labelled block is not the same as no block: it reads to the
 * model as a deliberate silence, which is the same failure the notes block was
 * shaped around in generation.service.ts.
 */
export function addendumBlock(raw: string | null | undefined): string | null {
  const body = sanitizeCustomPrompt(raw ?? '');
  if (!body) return null;
  return `HOUSE STYLE ADDENDUM\n\n${FENCE}\n${body}\n${FENCE}`;
}
