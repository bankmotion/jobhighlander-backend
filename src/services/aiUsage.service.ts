import { prisma } from '../lib/prisma';
import { priceUsage, rateCard, type TokenUsage } from '../lib/pricing';
import { logger } from './logger.service';

/** Which generator spent the money. */
/**
 * Which generator spent the money.
 *
 * `application` is what the current code writes: one call produces both
 * documents. `resume` and `cover_letter` remain because historical rows carry
 * them and a spend log must keep reading its own history.
 */
export type AiFeature = 'application' | 'resume' | 'cover_letter';

/** Human labels, so the dashboard never has to translate a database value. */
const FEATURE_LABELS: Record<AiFeature, string> = {
  application: 'Resume + cover letter',
  resume: 'Resume (legacy, separate call)',
  cover_letter: 'Cover letter (legacy, separate call)',
};

export interface RecordInput {
  feature: AiFeature;
  model: string;
  userId: number;
  profileId?: number | null;
  jobId?: number | null;
  usage: TokenUsage | null | undefined;
}

/** Token counts for one bucket, accumulated in micro-dollars. */
interface Accumulator {
  calls: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

/** One bucket of the summary: a day, a model, a feature or a person. */
export interface UsageBucket {
  key: string;
  label: string;
  calls: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type UsageTotals = Omit<UsageBucket, 'key' | 'label'>;

export interface UsageSummary {
  /** Inclusive UTC dates (YYYY-MM-DD) actually covered. */
  from: string;
  to: string;
  days: number;
  totals: UsageTotals;
  /** One entry per day in range, zero-filled: a quiet day is a real fact. */
  daily: UsageBucket[];
  byModel: UsageBucket[];
  byFeature: UsageBucket[];
  /**
   * Calls whose model had no compiled-in rate, so their cost counted as $0.
   * Non-zero means every total here understates the real bill.
   */
  unpricedCalls: number;
  /** The rate table the figures came from, so the UI never hardcodes a price. */
  rates: ReturnType<typeof rateCard>;
}

/** Longest window the summary will scan in one request. */
export const MAX_RANGE_DAYS = 365;

const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

const emptyAcc = (): Accumulator => ({
  calls: 0,
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  costMicroUsd: 0,
});

export const aiUsageService = {
  /**
   * Log one completed Anthropic call.
   *
   * NEVER THROWS. This runs after a generation the user already waited a minute
   * for, and before the document reaches them. Letting an accounting insert
   * fail the request would trade a real deliverable for a bookkeeping row. A
   * failure is logged loudly instead, because a silently missing row understates
   * the bill.
   */
  async record({ feature, model, userId, profileId, jobId, usage }: RecordInput): Promise<void> {
    try {
      const priced = priceUsage(model, usage);

      if (!priced.priced) {
        logger.warn('AI call used a model with no compiled-in rate; cost recorded as 0', {
          model,
          feature,
        });
      }

      // Copy the email onto the row rather than relying on the join: the record
      // must still name who spent it after that user is deleted, and by then
      // there is nothing left to join to.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      await prisma.aiUsage.create({
        data: {
          feature,
          model,
          userId,
          userEmail: user?.email ?? null,
          profileId: profileId ?? null,
          jobId: jobId ?? null,
          inputTokens: priced.inputTokens,
          cacheWriteTokens: priced.cacheWriteTokens,
          cacheReadTokens: priced.cacheReadTokens,
          outputTokens: priced.outputTokens,
          costMicroUsd: priced.costMicroUsd,
          priced: priced.priced,
        },
      });
    } catch (err) {
      logger.error('Failed to record AI usage; spend for this call is missing', {
        feature,
        model,
        userId,
        err: String(err),
      });
    }
  },

  /**
   * One user's spend over the last `days` days, split by day, model and
   * generator.
   *
   * `userId` is REQUIRED, and there is deliberately no way to ask for everyone:
   * each person sees only their own spend, so an unscoped summary is not a
   * feature with no UI, it is a hole waiting for one. Widening this later means
   * adding a parameter and a role check together, in one visible change.
   *
   * One findMany over the window, bucketed here, rather than three grouped
   * queries plus raw SQL for the daily series. A user's window holds one row per
   * generation (hundreds at the outside), so a single scan beats three round
   * trips, and bucketing in JS keeps days in UTC instead of at the mercy of the
   * database session timezone.
   */
  async summary(days: number, userId: number): Promise<UsageSummary> {
    const span = Math.min(Math.max(Math.trunc(days) || 1, 1), MAX_RANGE_DAYS);

    // Whole UTC days, so "last 30 days" always means 30 complete buckets.
    const end = new Date();
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - (span - 1));

    const rows = await prisma.aiUsage.findMany({
      // Scoping in the WHERE clause, not by filtering buckets afterwards: another
      // user's rows must never be read into this process at all, or the next
      // breakdown added here silently leaks them.
      where: { createdAt: { gte: start }, userId },
      select: {
        feature: true,
        model: true,
        inputTokens: true,
        cacheWriteTokens: true,
        cacheReadTokens: true,
        outputTokens: true,
        costMicroUsd: true,
        priced: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Micro-dollars all the way through accumulation, converted to dollars
    // exactly once at the end. Summing rounded dollars per bucket would let the
    // parts disagree with the whole.
    const dims = {
      day: new Map<string, { label: string; acc: Accumulator }>(),
      model: new Map<string, { label: string; acc: Accumulator }>(),
      feature: new Map<string, { label: string; acc: Accumulator }>(),
    };
    const bucket = (dim: keyof typeof dims, key: string, label: string): Accumulator => {
      let entry = dims[dim].get(key);
      if (!entry) {
        entry = { label, acc: emptyAcc() };
        dims[dim].set(key, entry);
      }
      return entry.acc;
    };

    const totals = emptyAcc();
    let unpricedCalls = 0;

    // Zero-fill every day up front. A day with no generations is information,
    // and a chart that omits it silently rescales the timeline.
    for (let i = 0; i < span; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      bucket('day', utcDay(d), utcDay(d));
    }

    for (const r of rows) {
      const day = utcDay(r.createdAt);
      const targets: Accumulator[] = [
        totals,
        bucket('day', day, day),
        bucket('model', r.model, r.model),
        bucket('feature', r.feature, FEATURE_LABELS[r.feature as AiFeature] ?? r.feature),
      ];

      for (const t of targets) {
        t.calls += 1;
        t.inputTokens += r.inputTokens;
        t.cacheWriteTokens += r.cacheWriteTokens;
        t.cacheReadTokens += r.cacheReadTokens;
        t.outputTokens += r.outputTokens;
        t.costMicroUsd += r.costMicroUsd;
      }

      if (!r.priced) unpricedCalls += 1;
    }

    const toTotals = ({ costMicroUsd, ...rest }: Accumulator): UsageTotals => ({
      ...rest,
      costUsd: costMicroUsd / 1_000_000,
    });
    const collect = (dim: keyof typeof dims): UsageBucket[] =>
      [...dims[dim].entries()].map(([key, { label, acc }]) => ({ key, label, ...toTotals(acc) }));

    const byCostDesc = (a: UsageBucket, b: UsageBucket): number =>
      b.costUsd - a.costUsd || b.calls - a.calls;

    return {
      from: utcDay(start),
      to: utcDay(end),
      days: span,
      totals: toTotals(totals),
      daily: collect('day').sort((a, b) => a.key.localeCompare(b.key)),
      byModel: collect('model').sort(byCostDesc),
      byFeature: collect('feature').sort(byCostDesc),
      unpricedCalls,
      rates: rateCard(),
    };
  },
};
