import { prisma } from '../lib/prisma';
import { providerOf, providerLabelOf, providerKey, type AiProvider } from '../lib/ai';
import { priceUsage, rateCard, type TokenUsage } from '../lib/pricing';
import { logger } from './logger.service';

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

const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

const emptyAcc = (): Accumulator => ({
  calls: 0,
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  costMicroUsd: 0,
});

function usageWindow(days: number): { span: number; start: Date; end: Date } {
  const span = Math.min(Math.max(Math.trunc(days) || 1, 1), MAX_RANGE_DAYS);
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (span - 1));
  return { span, start, end };
}

export interface UsageFilter {
  userId?: number | null;
  profileId?: number | null;
}

const filterWhere = (start: Date, filter: UsageFilter) => ({
  createdAt: { gte: start },
  ...(filter.userId != null ? { userId: filter.userId } : {}),
  ...(filter.profileId != null ? { profileId: filter.profileId } : {}),
});

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

  async summary(days: number, userId: number): Promise<UsageSummary> {
    const { span, start, end } = usageWindow(days);

    const rows = (await prisma.aiUsage.findMany({
      where: { createdAt: { gte: start }, userId },
      select: ROW_SELECT,
      orderBy: { createdAt: 'asc' },
    })) as UsageRow[];

    return aggregate(rows, start, end, span);
  },

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
        provider: providerOf(r.model),
        providerLabel: providerLabelOf(r.model),
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

function aggregate(rows: UsageRow[], start: Date, end: Date, span: number): UsageSummary {
  const day: BucketMap = new Map();
  const provider: BucketMap = new Map();
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
    from: utcDay(start),
    to: utcDay(end),
    days: span,
    totals: toTotals(totals),
    daily: collect(day).sort((a, b) => a.key.localeCompare(b.key)),
    byProvider: collect(provider).sort(byCostDesc),
    byModel: collect(model).sort(byCostDesc),
    byFeature: collect(feature).sort(byCostDesc),
    unpricedCalls,
    rates: rateCard(),
  };
}
