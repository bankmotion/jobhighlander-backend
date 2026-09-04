import { prisma } from '../lib/prisma';
import { providerOf, providerLabelOf, providerKey, type AiProvider } from '../lib/ai';
import {
  LIST_PRICE_BP,
  multiplierFor,
  priceUsage,
  rateCard,
  type ProviderMultipliers,
  type TokenUsage,
} from '../lib/pricing';
import { aiRateService } from './aiRate.service';
import { billingService } from './billing.service';
import { logger } from './logger.service';
import {
  addZonedDays,
  endOfZonedDate,
  resolveZone,
  startOfZonedDate,
  startOfZonedDay,
  startOfZonedHour,
  zonedDayKey,
  zonedDaysBetween,
  zonedHourKey,
} from '../lib/zone';

export type AiFeature = 'application' | 'job_query' | 'resume' | 'cover_letter';

const FEATURE_LABELS: Record<AiFeature, string> = {
  application: 'Resume + cover letter',
  job_query: 'Ask AI about a job',
  resume: 'Resume (legacy, separate call)',
  cover_letter: 'Cover letter (legacy, separate call)',
};

const featureLabel = (feature: string): string => FEATURE_LABELS[feature as AiFeature] ?? feature;

export interface RecordInput {
  feature: AiFeature;
  model: string;
  userId: number;
  profileId?: number | null;
  jobId?: number | null;
  usage: TokenUsage | null | undefined;
}

interface Accumulator {
  calls: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

export interface UsageBucket {
  key: string;
  label: string;
  sub?: string;
  calls: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type UsageTotals = Omit<UsageBucket, 'key' | 'label' | 'sub'>;

export interface UsageSummary {
  from: string;
  to: string;
  days: number;
  /** Whether `daily` is bucketed by hour or by day, so the UI can title it. */
  granularity: Granularity;
  /** The range in words — "today", "the last 24 hours", "1 Sep – 8 Sep". */
  rangeLabel: string;
  totals: UsageTotals;
  daily: UsageBucket[];
  /**
   * Spend split by vendor. Derived from each row's model string, so it covers
   * calls made before the app could choose a provider at all.
   */
  byProvider: UsageBucket[];
  byModel: UsageBucket[];
  byFeature: UsageBucket[];
  unpricedCalls: number;
  rates: ReturnType<typeof rateCard>;
}

export interface FilterOption {
  id: number;
  label: string;
  sub?: string;
}

export interface AdminUsageSummary extends UsageSummary {
  byUser: UsageBucket[];
  byProfile: UsageBucket[];
  scope: { userId: number | null; profileId: number | null };
  filters: { users: FilterOption[]; profiles: FilterOption[] };
}

export interface UsageCall {
  id: number;
  at: string;
  feature: string;
  featureLabel: string;
  model: string;
  provider: AiProvider | null;
  providerLabel: string;
  /**
   * The markup this row was billed at, as a plain number (1.2). Shown in the
   * log so the effect of a markup change — or of the historical backfill — is
   * visible per call rather than only in the totals.
   */
  multiplier: number;
  userId: number | null;
  userLabel: string;
  profileId: number | null;
  profileLabel: string | null;
  jobId: number | null;
  jobLabel: string | null;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
  priced: boolean;
}

export interface UsageCallPage {
  rows: UsageCall[];
  total: number;
  limit: number;
  offset: number;
}

export const MAX_RANGE_DAYS = 365;

export const MAX_PAGE_SIZE = 200;


const emptyAcc = (): Accumulator => ({
  calls: 0,
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  costMicroUsd: 0,
});

/**
 * The two short presets, which are NOT the same thing.
 *
 *   today — the calendar day so far: 00:00 UTC until now. At 09:00 that is a
 *           nine-hour window, and it resets at midnight.
 *   24h   — a rolling day: the last 24 hours whenever you ask, which spans
 *           two calendar dates for most of the day.
 *
 * Both are bucketed hourly. A one-day range drawn as a single daily bar says
 * nothing about when the spend happened, which is the only question a range
 * this short is asked.
 */
export type UsagePreset = 'today' | '24h';

export interface RangeInput {
  days?: number;
  preset?: UsagePreset;
  /** ISO dates (YYYY-MM-DD), inclusive on both ends. */
  from?: string;
  to?: string;
  /** The viewer's display zone. Unknown or absent means UTC. */
  tz?: string;
}

export type Granularity = 'hour' | 'day';

interface UsageWindow {
  start: Date;
  end: Date;
  /** How many empty buckets to draw, in `unit`s. */
  buckets: number;
  unit: Granularity;
  /** Whole days spanned, for callers that still report a day count. */
  days: number;
  /** Human range for the page header, e.g. "today" or "1 Sep – 8 Sep". */
  label: string;
  /** The zone every boundary and bucket key in this window is expressed in. */
  zone: string;
}

const HOUR = 3_600_000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const shortDate = (d: Date, zone: string): string =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: zone });

/** Local hours elapsed since local midnight, for sizing the "today" window. */
const hoursIntoDay = (now: Date, zone: string): number =>
  Math.floor((now.getTime() - startOfZonedDay(now, zone).getTime()) / HOUR);

export class RangeError extends Error {}

/**
 * Turn what the caller asked for into a concrete window.
 *
 * Throws rather than returning a sentinel: every caller would have to check it,
 * and a range quietly falling back to "30 days" is the kind of wrong that shows
 * plausible numbers for the wrong period.
 */
function usageWindow(input: RangeInput): UsageWindow {
  const now = new Date();
  const zone = resolveZone(input.tz);

  if (input.from || input.to) {
    if (!input.from || !input.to) {
      throw new RangeError('Both from and to are required for a custom range');
    }
    if (!ISO_DATE.test(input.from) || !ISO_DATE.test(input.to)) {
      throw new RangeError('Dates must be in YYYY-MM-DD form');
    }
    // The dates came off a date input, so they name days on the viewer's
    // calendar, not UTC days that happen to share the label.
    const start = startOfZonedDate(input.from, zone);
    // Inclusive of the whole final day, so picking one date is a full day
    // rather than a zero-length window.
    const end = endOfZonedDate(input.to, zone);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new RangeError('Invalid dates');
    }
    if (start > end) throw new RangeError('from must be on or before to');
    const buckets = zonedDaysBetween(start, end, zone);
    if (buckets > MAX_RANGE_DAYS) {
      throw new RangeError(`Range cannot exceed ${MAX_RANGE_DAYS} days`);
    }
    return {
      start, end, buckets, unit: 'day', days: buckets, zone,
      label:
        input.from === input.to
          ? shortDate(start, zone)
          : `${shortDate(start, zone)} – ${shortDate(end, zone)}`,
    };
  }

  if (input.preset === '24h') {
    // Ends at the top of the current hour plus the partial one in progress, so
    // there are exactly 24 buckets and the newest is the hour you are in.
    const start = new Date(startOfZonedHour(now, zone).getTime() - 23 * HOUR);
    return { start, end: now, buckets: 24, unit: 'hour', days: 1, zone, label: 'the last 24 hours' };
  }

  if (input.preset === 'today') {
    const start = startOfZonedDay(now, zone);
    return {
      start, end: now,
      // Local hours so far. On a spring-forward day this is 23, not 24, which
      // is exactly how many hours that day has.
      buckets: hoursIntoDay(now, zone) + 1,
      unit: 'hour', days: 1, zone,
      label: 'today',
    };
  }

  const span = Math.min(Math.max(Math.trunc(input.days ?? 30) || 1, 1), MAX_RANGE_DAYS);
  const start = addZonedDays(startOfZonedDay(now, zone), -(span - 1), zone);
  return {
    start, end: now, buckets: span, unit: 'day', days: span, zone,
    label: span === 1 ? 'today' : `${span} days`,
  };
}

export interface UsageFilter {
  userId?: number | null;
  profileId?: number | null;
}

const filterWhere = (start: Date, end: Date, filter: UsageFilter) => ({
  createdAt: { gte: start, lte: end },
  ...(filter.userId != null ? { userId: filter.userId } : {}),
  ...(filter.profileId != null ? { profileId: filter.profileId } : {}),
});

const ROW_SELECT = {
  feature: true,
  model: true,
  multiplierBp: true,
  userId: true,
  userEmail: true,
  profileId: true,
  inputTokens: true,
  cacheWriteTokens: true,
  cacheReadTokens: true,
  outputTokens: true,
  costMicroUsd: true,
  priced: true,
  createdAt: true,
} as const;

interface UsageRow {
  feature: string;
  model: string;
  multiplierBp: number;
  userId: number | null;
  userEmail: string | null;
  profileId: number | null;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  priced: boolean;
  createdAt: Date;
}

interface Named {
  label: string;
  sub?: string;
}

const profileName = (p: {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string => [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || `Profile #${p.id}`;

async function nameLookups(
  userIds: number[],
  profileIds: number[],
): Promise<{ users: Map<number, Named>; profiles: Map<number, Named> }> {
  const [users, profiles] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, role: true },
        })
      : Promise.resolve([]),
    profileIds.length
      ? prisma.profile.findMany({
          where: { id: { in: profileIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            owner: { select: { email: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    users: new Map<number, Named>(users.map((u) => [u.id, { label: u.email, sub: u.role }])),
    profiles: new Map<number, Named>(
      profiles.map((p) => [p.id, { label: profileName(p), sub: `owner ${p.owner.email}` }]),
    ),
  };
}

export const aiUsageService = {
  async record({ feature, model, userId, profileId, jobId, usage }: RecordInput): Promise<void> {
    try {
      // Read at record time, not at read time: this row is a receipt for what
      // the call cost when it ran, and a later markup change must not rewrite
      // it. `multipliers()` swallows its own failures and answers list price,
      // so a rate-table problem can never lose the usage row itself.
      const priced = priceUsage(model, usage, multiplierFor(model, await aiRateService.multipliers()));

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

      const row = await prisma.aiUsage.create({
        select: { id: true },
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
          multiplierBp: priced.multiplierBp,
          priced: priced.priced,
        },
      });

      // Charged AFTER the usage row exists, so the ledger entry can point at
      // the call that caused it. Never throws — the vendor has already been
      // paid, and losing the document the user waited for to report a
      // bookkeeping problem would be the worse trade.
      await billingService.chargeUsage({
        userId,
        amountMicroUsd: priced.costMicroUsd,
        aiUsageId: row.id,
        note: `${featureLabel(feature)} · ${model}`,
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

  async summary(range: RangeInput, userId: number): Promise<UsageSummary> {
    const win = usageWindow(range);

    const [rows, multipliers] = await Promise.all([
      prisma.aiUsage.findMany({
        where: { createdAt: { gte: win.start, lte: win.end }, userId },
        select: ROW_SELECT,
        orderBy: { createdAt: 'asc' },
      }) as Promise<UsageRow[]>,
      aiRateService.multipliers(),
    ]);

    return aggregate(rows, win, multipliers);
  },

  async adminSummary(range: RangeInput, filter: UsageFilter = {}): Promise<AdminUsageSummary> {
    const win = usageWindow(range);
    const { start, end } = win;

    // The two groupBys build the filter menus from the UNFILTERED window (see
    // `filters` on the type). They return distinct ids only — cheap next to
    // the row read, and they run alongside it.
    const [rows, userIds, profileIds, multipliers] = await Promise.all([
      prisma.aiUsage.findMany({
        where: filterWhere(start, end, filter),
        select: ROW_SELECT,
        orderBy: { createdAt: 'asc' },
      }) as Promise<UsageRow[]>,
      prisma.aiUsage.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: start, lte: end }, userId: { not: null } },
      }),
      prisma.aiUsage.groupBy({
        by: ['profileId'],
        where: { createdAt: { gte: start, lte: end }, profileId: { not: null } },
      }),
      aiRateService.multipliers(),
    ]);

    const optionUserIds = userIds.map((u) => u.userId).filter((id): id is number => id != null);
    const optionProfileIds = profileIds
      .map((p) => p.profileId)
      .filter((id): id is number => id != null);

    const names = await nameLookups(
      [...new Set([...optionUserIds, ...rows.map((r) => r.userId)])].filter(
        (id): id is number => id != null,
      ),
      [...new Set([...optionProfileIds, ...rows.map((r) => r.profileId)])].filter(
        (id): id is number => id != null,
      ),
    );

    const byUser: BucketMap = new Map();
    const byProfile: BucketMap = new Map();

    for (const r of rows) {
      // A deleted user leaves `userId` null but keeps the email copied onto the
      // row, so their spend still lands under a name of its own instead of
      // collapsing into one anonymous pile shared with everyone else deleted.
      const known = r.userId != null ? names.users.get(r.userId) : undefined;
      const userAcc = upsert(byUser, r.userId != null ? `u${r.userId}` : `gone:${r.userEmail ?? 'unknown'}`, {
        label: known?.label ?? r.userEmail ?? 'Deleted user',
        sub: known?.sub ?? 'account deleted',
      });

      const named = r.profileId != null ? names.profiles.get(r.profileId) : undefined;
      const profileAcc = upsert(byProfile, r.profileId != null ? `p${r.profileId}` : 'none', {
        label:
          r.profileId == null
            ? 'No profile'
            : (named?.label ?? `Profile #${r.profileId} (deleted)`),
        sub: r.profileId == null ? 'call made outside a profile' : named?.sub,
      });

      for (const acc of [userAcc, profileAcc]) add(acc, r);
    }

    const option = (map: Map<number, Named>, id: number, kind: string): FilterOption => ({
      id,
      label: map.get(id)?.label ?? `${kind} #${id} (deleted)`,
      sub: map.get(id)?.sub,
    });

    return {
      ...aggregate(rows, win, multipliers),
      byUser: collect(byUser).sort(byCostDesc),
      byProfile: collect(byProfile).sort(byCostDesc),
      scope: { userId: filter.userId ?? null, profileId: filter.profileId ?? null },
      filters: {
        users: optionUserIds
          .map((id) => option(names.users, id, 'User'))
          .sort((a, b) => a.label.localeCompare(b.label)),
        profiles: optionProfileIds
          .map((id) => option(names.profiles, id, 'Profile'))
          .sort((a, b) => a.label.localeCompare(b.label)),
      },
    };
  },

  async calls(range: RangeInput, filter: UsageFilter = {}, limit = 50, offset = 0): Promise<UsageCallPage> {
    const { start, end } = usageWindow(range);
    const take = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_PAGE_SIZE);
    const skip = Math.max(Math.trunc(offset) || 0, 0);
    const where = filterWhere(start, end, filter);

    const [rows, total] = await Promise.all([
      prisma.aiUsage.findMany({
        where,
        select: { ...ROW_SELECT, id: true, jobId: true },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.aiUsage.count({ where }),
    ]);

    const names = await nameLookups(
      [...new Set(rows.map((r) => r.userId))].filter((id): id is number => id != null),
      [...new Set(rows.map((r) => r.profileId))].filter((id): id is number => id != null),
    );

    // Jobs are re-scraped and pruned routinely, so a call outliving the posting
    // it was written for is normal. Those keep their id and say what happened.
    const jobIds = [...new Set(rows.map((r) => r.jobId))].filter((id): id is number => id != null);
    const jobs = jobIds.length
      ? await prisma.job.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, title: true, company: true },
        })
      : [];
    const jobById = new Map(jobs.map((j) => [j.id, [j.title, j.company].filter(Boolean).join(' — ')]));

    return {
      rows: rows.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        feature: r.feature,
        featureLabel: featureLabel(r.feature),
        model: r.model,
        provider: providerOf(r.model),
        providerLabel: providerLabelOf(r.model),
        multiplier: r.multiplierBp / LIST_PRICE_BP,
        userId: r.userId,
        userLabel:
          (r.userId != null ? names.users.get(r.userId)?.label : null) ?? r.userEmail ?? 'Deleted user',
        profileId: r.profileId,
        profileLabel:
          r.profileId == null
            ? null
            : (names.profiles.get(r.profileId)?.label ?? `Profile #${r.profileId} (deleted)`),
        jobId: r.jobId,
        jobLabel: r.jobId == null ? null : (jobById.get(r.jobId) ?? `Job #${r.jobId} (pruned)`),
        inputTokens: r.inputTokens,
        cacheWriteTokens: r.cacheWriteTokens,
        cacheReadTokens: r.cacheReadTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costMicroUsd / 1_000_000,
        priced: r.priced,
      })),
      total,
      limit: take,
      offset: skip,
    };
  },
};

type BucketMap = Map<string, { label: string; sub?: string; acc: Accumulator }>;

function add(acc: Accumulator, r: UsageRow): void {
  acc.calls += 1;
  acc.inputTokens += r.inputTokens;
  acc.cacheWriteTokens += r.cacheWriteTokens;
  acc.cacheReadTokens += r.cacheReadTokens;
  acc.outputTokens += r.outputTokens;
  acc.costMicroUsd += r.costMicroUsd;
}

function upsert(map: BucketMap, key: string, named: Named): Accumulator {
  let entry = map.get(key);
  if (!entry) {
    entry = { label: named.label, sub: named.sub, acc: emptyAcc() };
    map.set(key, entry);
  }
  return entry.acc;
}

// Micro-dollars all the way through accumulation, converted to dollars exactly
// once at the end. Summing rounded dollars per bucket would let the parts
// disagree with the whole.
const toTotals = ({ costMicroUsd, ...rest }: Accumulator): UsageTotals => ({
  ...rest,
  costUsd: costMicroUsd / 1_000_000,
});

const collect = (map: BucketMap): UsageBucket[] =>
  [...map.entries()].map(([key, { label, sub, acc }]) => ({ key, label, sub, ...toTotals(acc) }));

const byCostDesc = (a: UsageBucket, b: UsageBucket): number =>
  b.costUsd - a.costUsd || b.calls - a.calls;

/**
 * Bucket keys sort lexicographically in both units, which is what the chart's
 * ordering relies on. The label is what a person reads: a bare hour for an
 * hourly range, since the date is already in the header.
 */
const bucketKey = (d: Date, unit: Granularity, zone: string): string =>
  unit === 'hour' ? zonedHourKey(d, zone) : zonedDayKey(d, zone);

const bucketLabel = (key: string, unit: Granularity): string =>
  unit === 'hour' ? `${key.slice(11, 13)}:00` : key;

const stamp = (d: Date, unit: Granularity, zone: string): string =>
  unit === 'hour'
    ? `${zonedDayKey(d, zone)} ${zonedHourKey(d, zone).slice(11, 13)}:00`
    : zonedDayKey(d, zone);

function aggregate(
  rows: UsageRow[],
  win: UsageWindow,
  multipliers: ProviderMultipliers,
): UsageSummary {
  const { start, end, buckets, unit, zone } = win;
  const day: BucketMap = new Map();
  const provider: BucketMap = new Map();
  const model: BucketMap = new Map();
  const feature: BucketMap = new Map();

  const totals = emptyAcc();
  let unpricedCalls = 0;

  // Zero-fill every bucket up front. A quiet hour or day is information, and a
  // chart that omits it silently rescales the timeline.
  for (let i = 0; i < buckets; i++) {
    // Days step by local days — a fixed 24h stride drifts an hour across a
    // daylight-saving change and starts zero-filling the wrong dates. Hours
    // step by real hours, since that is what an hour is; on a fall-back night
    // two of them share one local key and merge, which is what the clock did.
    const d = unit === 'hour' ? new Date(start.getTime() + i * HOUR) : addZonedDays(start, i, zone);
    const key = bucketKey(d, unit, zone);
    upsert(day, key, { label: bucketLabel(key, unit) });
  }

  for (const r of rows) {
    const key = bucketKey(r.createdAt, unit, zone);
    const targets = [
      totals,
      upsert(day, key, { label: bucketLabel(key, unit) }),
      upsert(provider, providerKey(providerOf(r.model)), { label: providerLabelOf(r.model) }),
      // The model labels the row and its vendor subtitles it, so two models
      // from different vendors never read as one undifferentiated line item.
      upsert(model, r.model, { label: r.model, sub: providerLabelOf(r.model) }),
      upsert(feature, r.feature, { label: featureLabel(r.feature) }),
    ];

    for (const t of targets) add(t, r);
    if (!r.priced) unpricedCalls += 1;
  }

  return {
    from: stamp(start, unit, zone),
    to: stamp(end, unit, zone),
    days: win.days,
    granularity: unit,
    rangeLabel: win.label,
    totals: toTotals(totals),
    daily: collect(day).sort((a, b) => a.key.localeCompare(b.key)),
    byProvider: collect(provider).sort(byCostDesc),
    byModel: collect(model).sort(byCostDesc),
    byFeature: collect(feature).sort(byCostDesc),
    unpricedCalls,
    rates: rateCard(multipliers),
  };
}
