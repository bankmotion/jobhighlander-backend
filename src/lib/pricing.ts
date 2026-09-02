import { providerOf, PROVIDER_LABEL, AI_PROVIDERS, type AiProvider } from './ai';

/**
 * Markups are held in BASIS POINTS of list price: 10000 is list, 12000 is 1.2x.
 *
 * Integer arithmetic end to end, for the same reason costs are integer
 * micro-dollars — 1.2 has no exact binary representation, and a markup that
 * drifts in the last place makes two runs of one report disagree.
 */
export const LIST_PRICE_BP = 10_000;

export type ProviderMultipliers = Readonly<Record<AiProvider, number>>;

export const LIST_MULTIPLIERS: ProviderMultipliers = Object.fromEntries(
  AI_PROVIDERS.map((p) => [p, LIST_PRICE_BP]),
) as ProviderMultipliers;

/** The markup that applies to a model, defaulting to list for anything unknown. */
export function multiplierFor(model: string, multipliers: ProviderMultipliers): number {
  const provider = providerOf(model);
  return provider ? (multipliers[provider] ?? LIST_PRICE_BP) : LIST_PRICE_BP;
}

const applyMarkup = (listMicroUsd: number, multiplierBp: number): number =>
  Math.round((listMicroUsd * multiplierBp) / LIST_PRICE_BP);

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
  /** What the vendor charges, before this deployment's markup. */
  listMicroUsd: number;
  /** What this deployment charges — `listMicroUsd` at `multiplierBp`. */
  costMicroUsd: number;
  multiplierBp: number;
  priced: boolean;
}

const int = (v: number | null | undefined): number =>
  Number.isFinite(v) && (v as number) > 0 ? Math.round(v as number) : 0;

export function priceUsage(
  model: string,
  usage: TokenUsage | null | undefined,
  multiplierBp: number = LIST_PRICE_BP,
): PricedUsage {
  const inputTokens = int(usage?.input_tokens);
  const cacheWriteTokens = int(usage?.cache_creation_input_tokens);
  const cacheReadTokens = int(usage?.cache_read_input_tokens);
  const outputTokens = int(usage?.output_tokens);

  const rate = RATES[model];
  if (!rate) {
    return {
      inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens,
      listMicroUsd: 0, costMicroUsd: 0, multiplierBp, priced: false,
    };
  }

  const listMicroUsd = Math.round(
    inputTokens * rate.input +
      cacheWriteTokens * rate.input * CACHE_WRITE_MULTIPLIER +
      cacheReadTokens * rate.input * CACHE_READ_MULTIPLIER +
      outputTokens * rate.output,
  );

  return {
    inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens,
    listMicroUsd,
    costMicroUsd: applyMarkup(listMicroUsd, multiplierBp),
    multiplierBp,
    priced: true,
  };
}

export const isPricedModel = (model: string): boolean => model in RATES;

export interface RateRow {
  model: string;
  provider: AiProvider | null;
  providerLabel: string;
  /** The markup as a plain number for display: 12000 bp reads as 1.2. */
  multiplier: number;
  /** What the vendor lists. Shown beside the billed rate so the markup is visible. */
  listInputPerMTok: number;
  listOutputPerMTok: number;
  /**
   * What this deployment actually bills — list x markup. These keep the plain
   * names because they are the numbers every total on the page is built from;
   * the vendor's own price is the qualified one.
   */
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

export function rateCard(multipliers: ProviderMultipliers = LIST_MULTIPLIERS): RateRow[] {
  return Object.entries(RATES).map(([model, r]) => {
    const provider = providerOf(model);
    const bp = multiplierFor(model, multipliers);
    const marked = (listRate: number) => (listRate * bp) / LIST_PRICE_BP;
    return {
      model,
      provider,
      providerLabel: provider ? PROVIDER_LABEL[provider] : 'Unknown',
      multiplier: bp / LIST_PRICE_BP,
      listInputPerMTok: r.input,
      listOutputPerMTok: r.output,
      inputPerMTok: marked(r.input),
      outputPerMTok: marked(r.output),
      cacheWritePerMTok: marked(r.input * CACHE_WRITE_MULTIPLIER),
      cacheReadPerMTok: marked(r.input * CACHE_READ_MULTIPLIER),
    };
  });
}
