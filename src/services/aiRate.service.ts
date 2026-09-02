import { prisma } from '../lib/prisma';
import { AI_PROVIDERS, PROVIDER_LABEL, PROVIDER_MODEL, type AiProvider } from '../lib/ai';
import { LIST_PRICE_BP, type ProviderMultipliers } from '../lib/pricing';
import { logger } from './logger.service';

/**
 * The markup a super admin has set for each provider.
 *
 * A missing row means list price. That is load-bearing: the table starts empty
 * on a fresh deployment and every generator prices calls through here, so
 * "no row" has to be a working default rather than a failure.
 */

/** What a human may type. Below 1 would bill less than the vendor charges. */
export const MIN_MULTIPLIER = 0.01;
export const MAX_MULTIPLIER = 100;

export interface ProviderRate {
  provider: AiProvider;
  label: string;
  model: string;
  multiplier: number;
  multiplierBp: number;
  backfilledAt: Date | null;
  updatedByEmail: string | null;
  updatedAt: Date | null;
}

/**
 * Cached because `record()` runs on every billable call and the answer changes
 * about once a quarter. Short TTL rather than forever: several processes may
 * serve the API, and a super admin should not have to restart one for a markup
 * to take effect. Writes clear it locally for the immediate case.
 */
const CACHE_TTL_MS = 30_000;
let cached: { at: number; value: ProviderMultipliers } | null = null;

export const clearRateCache = (): void => {
  cached = null;
};

const toBp = (multiplier: number): number => Math.round(multiplier * LIST_PRICE_BP);

export const isValidMultiplier = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_MULTIPLIER && v <= MAX_MULTIPLIER;

export const aiRateService = {
  /**
   * Basis points per provider, for pricing a call.
   *
   * Never throws: a database hiccup here would otherwise lose the usage record
   * for a call that has already been paid for, which is far worse than pricing
   * one call at list. It reports loudly instead.
   */
  async multipliers(): Promise<ProviderMultipliers> {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const value = Object.fromEntries(
      AI_PROVIDERS.map((p) => [p, LIST_PRICE_BP]),
    ) as Record<AiProvider, number>;

    try {
      for (const row of await prisma.aiProviderRate.findMany()) {
        if ((AI_PROVIDERS as readonly string[]).includes(row.provider)) {
          value[row.provider as AiProvider] = row.multiplierBp;
        }
      }
      cached = { at: Date.now(), value };
    } catch (err) {
      logger.error('Could not read AI cost markups; pricing this call at list', {
        err: String(err),
      });
    }

    return value;
  },

  /** Every provider the app knows, whether or not a row exists for it yet. */
  async list(): Promise<ProviderRate[]> {
    const rows = new Map(
      (await prisma.aiProviderRate.findMany()).map((r) => [r.provider, r]),
    );
    return AI_PROVIDERS.map((provider) => {
      const row = rows.get(provider);
      const multiplierBp = row?.multiplierBp ?? LIST_PRICE_BP;
      return {
        provider,
        label: PROVIDER_LABEL[provider],
        model: PROVIDER_MODEL[provider],
        multiplierBp,
        multiplier: multiplierBp / LIST_PRICE_BP,
        backfilledAt: row?.backfilledAt ?? null,
        updatedByEmail: row?.updatedByEmail ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  },

  /**
   * Change what a provider costs from now on.
   *
   * Deliberately does NOT touch existing `ai_usage` rows. Each of those was
   * priced at the markup in force when it ran, and rewriting them would make
   * last month's invoice change every time someone edits this field. Moving
   * historical rows is the backfill script's job, once.
   */
  async set(provider: AiProvider, multiplier: number, byEmail: string | null): Promise<ProviderRate> {
    const multiplierBp = toBp(multiplier);
    await prisma.aiProviderRate.upsert({
      where: { provider },
      create: { provider, multiplierBp, updatedByEmail: byEmail },
      update: { multiplierBp, updatedByEmail: byEmail },
    });
    clearRateCache();
    logger.info('AI cost markup changed', { provider, multiplier, by: byEmail });

    const updated = (await this.list()).find((r) => r.provider === provider);
    // `list` returns a row for every known provider, so this cannot miss — but
    // the non-null assertion would be a lie if a provider were ever removed.
    if (!updated) throw new Error(`Unknown provider ${provider}`);
    return updated;
  },
};
