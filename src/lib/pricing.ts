/**
 * Published list price per MILLION tokens, in USD, for the models this app can
 * call. Source: platform.claude.com/docs/en/pricing.
 *
 * Rates are compiled in rather than fetched. There is no pricing endpoint, and
 * a spend log that silently re-rated itself whenever Anthropic changed a price
 * would stop matching the invoice it exists to reconcile against. When a price
 * moves, add the new number here: rows already written keep the cost they were
 * charged at, because `AiUsage.costMicroUsd` is computed once, at call time.
 */
interface Rate {
  /** USD per million UNCACHED input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

const RATES: Readonly<Record<string, Rate>> = {
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
};

/**
 * Cache multipliers, applied to the model's INPUT rate.
 *
 * The write premium is the 5-minute figure, which is what
 * `cache_control: { type: 'ephemeral' }` buys — both generators use exactly
 * that, with no `ttl`. If a call site ever asks for `ttl: '1h'`, the premium
 * there is 2x and this constant stops being right for it.
 */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** The four token counts an Anthropic response reports, all optional. */
export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Token counts normalised to plain numbers, plus what they cost. */
export interface PricedUsage {
  /**
   * The UNCACHED input remainder — not the prompt size. Total tokens sent is
   * `inputTokens + cacheWriteTokens + cacheReadTokens`, and reading this field
   * as "the prompt" is the single easiest mistake to make with this API.
   */
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** Cost in MILLIONTHS of a dollar. */
  costMicroUsd: number;
  /** False when the model has no rate here, so `costMicroUsd` is 0. */
  priced: boolean;
}

const int = (v: number | null | undefined): number =>
  Number.isFinite(v) && (v as number) > 0 ? Math.round(v as number) : 0;

/**
 * Price one call.
 *
 * Micro-dollars fall out of the rate table for free: a rate is dollars per
 * million tokens, so `tokens * ratePerMillion` is already the cost in
 * millionths of a dollar. No division, no floating-point drift across a month
 * of summing, and enough resolution for a cache read — a thousand cached
 * tokens on Opus cost $0.0005, which rounds to nothing in cents.
 *
 * An unknown model yields cost 0 with `priced: false` rather than a guess. A
 * fabricated number in a spend report is worse than a visible gap, and the
 * summary surfaces the count of unpriced calls so the gap is never silent.
 */
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

/** Whether a spend figure for this model can be trusted (used by callers/tests). */
export const isPricedModel = (model: string): boolean => model in RATES;

/** Rates as the admin page shows them, so the UI never hardcodes a price. */
export function rateCard(): Array<{ model: string; inputPerMTok: number; outputPerMTok: number; cacheWritePerMTok: number; cacheReadPerMTok: number }> {
  return Object.entries(RATES).map(([model, r]) => ({
    model,
    inputPerMTok: r.input,
    outputPerMTok: r.output,
    cacheWritePerMTok: r.input * CACHE_WRITE_MULTIPLIER,
    cacheReadPerMTok: r.input * CACHE_READ_MULTIPLIER,
  }));
}
