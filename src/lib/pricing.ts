import { providerOf, PROVIDER_LABEL, type AiProvider } from './ai';

interface Rate {
  input: number;
  output: number;
}

const RATES: Readonly<Record<string, Rate>> = {
  // ── Anthropic ─────────────────────────────────────────────────────────────
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 },
  // Standard rate. Anthropic is running an introductory $2/$10 through
  // 2026-08-31; that is deliberately NOT modelled, because a rate that changes
  // with the calendar makes every historical total depend on when you ask.
  // This app calls Opus and Haiku, so the only effect is a slight
  // over-estimate if someone points MODEL at Sonnet before the intro ends.
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },

  // ── OpenAI ────────────────────────────────────────────────────────────────
  // Same reasoning as the Sonnet note above: Sol's promotional rate runs
  // through 2026-11-21 and is not modelled, so a Sol call would be recorded at
  // or above its real price rather than below it.
  'gpt-5.6-sol': { input: 4, output: 20 },
  'gpt-5.6-terra': { input: 2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
};

// Both vendors happen to price cached input identically as a multiple of the
// fresh input rate — a cache write at 1.25x and a read at 0.1x. If that ever
// diverges these have to move onto the rate row rather than staying global.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface PricedUsage {
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  priced: boolean;
}

const int = (v: number | null | undefined): number =>
  Number.isFinite(v) && (v as number) > 0 ? Math.round(v as number) : 0;

export function priceUsage(model: string, usage: TokenUsage | null | undefined): PricedUsage {
  const inputTokens = int(usage?.input_tokens);
  const cacheWriteTokens = int(usage?.cache_creation_input_tokens);
  const cacheReadTokens = int(usage?.cache_read_input_tokens);
  const outputTokens = int(usage?.output_tokens);

  const rate = RATES[model];
  if (!rate) {
    return { inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, costMicroUsd: 0, priced: false };
  }

  const costMicroUsd = Math.round(
    inputTokens * rate.input +
      cacheWriteTokens * rate.input * CACHE_WRITE_MULTIPLIER +
      cacheReadTokens * rate.input * CACHE_READ_MULTIPLIER +
      outputTokens * rate.output,
  );

  return { inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, costMicroUsd, priced: true };
}

export const isPricedModel = (model: string): boolean => model in RATES;

export interface RateRow {
  model: string;
  provider: AiProvider | null;
  providerLabel: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

export function rateCard(): RateRow[] {
  return Object.entries(RATES).map(([model, r]) => {
    const provider = providerOf(model);
    return {
      model,
      provider,
      providerLabel: provider ? PROVIDER_LABEL[provider] : 'Unknown',
      inputPerMTok: r.input,
      outputPerMTok: r.output,
      cacheWritePerMTok: r.input * CACHE_WRITE_MULTIPLIER,
      cacheReadPerMTok: r.input * CACHE_READ_MULTIPLIER,
    };
  });
}
