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
export type AiFeature = 'application' | 'job_query' | 'resume' | 'cover_letter';

/** Human labels, so the dashboard never has to translate a database value. */
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

/** Token counts for one bucket, accumulated in micro-dollars. */
interface Accumulator {
  calls: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

/** One bucket of the summary: a day, a model, a feature, a person, a profile. */
export interface UsageBucket {
  key: string;
  label: string;
  /**
   * Second line of context for the label — a profile's owner, a user's role.
   * Optional because the day, model and generator buckets have nothing to add,
   * and an empty string there renders as a blank line in the table.
   */
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

/** One entry of a filter picker: something the summary can be narrowed to. */
export interface FilterOption {
  id: number;
  label: string;
  sub?: string;
}

/**
 * Everything in `UsageSummary`, plus the two breakdowns that only mean anything
 * once more than one person's rows are in scope.
 */
export interface AdminUsageSummary extends UsageSummary {
  byUser: UsageBucket[];
  byProfile: UsageBucket[];
  /**
   * The filter these figures were computed under, echoed back so the page can
   * describe what it is showing from the response rather than from its own
   * state — the two drift the moment a request fails.
   */
  scope: { userId: number | null; profileId: number | null };
  /**
   * Every user and profile that spent anything in the window.
   *
   * Deliberately computed WITHOUT the active filter: derived from the filtered
   * rows, choosing a user would leave a menu holding only that user and no way
   * back to anyone else.
   */
  filters: { users: FilterOption[]; profiles: FilterOption[] };
}

/** One logged call, as the drill-down table lists it. */
export interface UsageCall {
  id: number;
  /** ISO-8601 UTC. Formatted in the browser, where the reader's zone is known. */
  at: string;
  feature: string;
  featureLabel: string;
  model: string;
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
  /** Matching rows across the whole window, not just this page. */
  total: number;
  limit: number;
  offset: number;
}

/** Longest window any query here will scan in one request. */
export const MAX_RANGE_DAYS = 365;

/** Page size cap for the call log. */
export const MAX_PAGE_SIZE = 200;

const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

const emptyAcc = (): Accumulator => ({
  calls: 0,
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  costMicroUsd: 0,
});

/** Whole UTC days, so "last 30 days" always means 30 complete buckets. */
function usageWindow(days: number): { span: number; start: Date; end: Date } {
  const span = Math.min(Math.max(Math.trunc(days) || 1, 1), MAX_RANGE_DAYS);
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (span - 1));
  return { span, start, end };
}

/**
 * How an admin view may be narrowed.
 *
 * A FILTER, not a permission. Everything is already in scope by the time these
 * are applied — the role check happens at the route.
 */
export interface UsageFilter {
  userId?: number | null;
  profileId?: number | null;
}

const filterWhere = (start: Date, filter: UsageFilter) => ({
  createdAt: { gte: start },
  ...(filter.userId != null ? { userId: filter.userId } : {}),
  ...(filter.profileId != null ? { profileId: filter.profileId } : {}),
});

/** The columns every aggregation below reads. */
const ROW_SELECT = {
  feature: true,
  model: true,
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

/** A display name, with optional context underneath it. */
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

/**
 * Display names for the users and profiles a set of rows touches.
 *
 * Every lookup here has to cope with a miss, because spend rows outlive what
 * they point at by design: deleting a user nulls `userId`, and `profileId`
 * carries no foreign key at all. A miss becomes "#id (deleted)" rather than a
 * dropped row — the money was still spent, and hiding it would leave the
 * breakdowns disagreeing with the total printed above them.
 */
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
   * `userId` is REQUIRED and lands in the WHERE clause: this is the view every
   * signed-in role can reach, so another user's rows must never be read into
   * the process at all. The unscoped view is a DIFFERENT METHOD — `adminSummary`
   * below, behind its own super-admin-only route. Widening happens by calling
   * something else, never by passing a different argument to this.
   *
   * One findMany over the window, bucketed here, rather than three grouped
   * queries plus raw SQL for the daily series. A user's window holds one row per
   * generation (hundreds at the outside), so a single scan beats three round
   * trips, and bucketing in JS keeps days in UTC instead of at the mercy of the
   * database session timezone.
   */
  async summary(days: number, userId: number): Promise<UsageSummary> {
    const { span, start, end } = usageWindow(days);

    const rows = (await prisma.aiUsage.findMany({
      where: { createdAt: { gte: start }, userId },
      select: ROW_SELECT,
      orderBy: { createdAt: 'asc' },
    })) as UsageRow[];

    return aggregate(rows, start, end, span);
  },

  /**
   * EVERY user's spend, across every profile, with per-user and per-profile
   * breakdowns on top of the usual day/model/generator ones.
   *
   * SUPER ADMIN ONLY. This method takes no caller identity and therefore checks
   * nothing itself — the route that reaches it carries `requireRole`, and a new
   * call site without one is a leak of the whole table. There is exactly one.
   *
   * Same single-scan shape as `summary`: this instance serves a handful of
   * people generating one row per application, so a year's window is thousands
   * of rows, not millions. If that stops being true, the daily series is the
   * part to push into SQL first.
   */
  async adminSummary(days: number, filter: UsageFilter = {}): Promise<AdminUsageSummary> {
    const { span, start, end } = usageWindow(days);

    // The two groupBys build the filter menus from the UNFILTERED window (see
    // `filters` on the type). They return distinct ids only — cheap next to
    // the row read, and they run alongside it.
    const [rows, userIds, profileIds] = await Promise.all([
      prisma.aiUsage.findMany({
        where: filterWhere(start, filter),
        select: ROW_SELECT,
        orderBy: { createdAt: 'asc' },
      }) as Promise<UsageRow[]>,
      prisma.aiUsage.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: start }, userId: { not: null } },
      }),
      prisma.aiUsage.groupBy({
        by: ['profileId'],
        where: { createdAt: { gte: start }, profileId: { not: null } },
      }),
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
      ...aggregate(rows, start, end, span),
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

  /**
   * The individual calls behind the figures, newest first.
   *
   * SUPER ADMIN ONLY, on the same terms as `adminSummary` — no identity in,
   * no check here, one call site that holds the role check.
   *
   * This is the level a total has to be traceable to. A month's figure nobody
   * can decompose into who spent it, on which candidate, against which job and
   * on which model is not an audit trail, it is just a number.
   */
  async calls(days: number, filter: UsageFilter = {}, limit = 50, offset = 0): Promise<UsageCallPage> {
    const { start } = usageWindow(days);
    const take = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_PAGE_SIZE);
    const skip = Math.max(Math.trunc(offset) || 0, 0);
    const where = filterWhere(start, filter);

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

/** Fold one row into an accumulator. */
function add(acc: Accumulator, r: UsageRow): void {
  acc.calls += 1;
  acc.inputTokens += r.inputTokens;
  acc.cacheWriteTokens += r.cacheWriteTokens;
  acc.cacheReadTokens += r.cacheReadTokens;
  acc.outputTokens += r.outputTokens;
  acc.costMicroUsd += r.costMicroUsd;
}

/** Get (or create) a bucket. The first label seen for a key wins. */
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
 * The day / model / generator breakdowns every summary carries, whoever is
 * asking.
 *
 * Shared by the self view and the admin view so the two can never drift into
 * computing the same total two different ways — a per-user page and an
 * all-users page that disagree about one person's month is the failure this
 * exists to prevent.
 */
function aggregate(rows: UsageRow[], start: Date, end: Date, span: number): UsageSummary {
  const day: BucketMap = new Map();
  const model: BucketMap = new Map();
  const feature: BucketMap = new Map();

  const totals = emptyAcc();
  let unpricedCalls = 0;

  // Zero-fill every day up front. A day with no generations is information,
  // and a chart that omits it silently rescales the timeline.
  for (let i = 0; i < span; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    upsert(day, utcDay(d), { label: utcDay(d) });
  }

  for (const r of rows) {
    const key = utcDay(r.createdAt);
    const targets = [
      totals,
      upsert(day, key, { label: key }),
      upsert(model, r.model, { label: r.model }),
      upsert(feature, r.feature, { label: featureLabel(r.feature) }),
    ];

    for (const t of targets) add(t, r);
    if (!r.priced) unpricedCalls += 1;
  }

  return {
    from: utcDay(start),
    to: utcDay(end),
    days: span,
    totals: toTotals(totals),
    daily: collect(day).sort((a, b) => a.key.localeCompare(b.key)),
    byModel: collect(model).sort(byCostDesc),
    byFeature: collect(feature).sort(byCostDesc),
    unpricedCalls,
    rates: rateCard(),
  };
}
