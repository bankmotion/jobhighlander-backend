import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';

/**
 * Bid performance — what happened to the applications this user's profiles made.
 *
 * "Bid" is this product's word for an application, so the questions are: how many
 * went out, how many came back, and from which sources. Everything is scoped
 * through `usableProfileWhere`, the same rule that decides whether the user may
 * mark an application at all, so a shared profile's numbers are visible to
 * exactly the people who work it.
 *
 * The funnel is derived from JOINED state, not from separate counts: an
 * interview only counts as a conversion when it belongs to an application that
 * is itself inside the window. Counting interviews independently would let the
 * rate exceed 100% whenever an older application progressed this month, which
 * is the classic way a funnel chart ends up lying.
 */

export type FunnelStage = 'applied' | 'interviewing' | 'offer' | 'accepted';

export interface BidPerformance {
  range: { days: number; from: string; to: string };
  totals: {
    applications: number;
    interviews: number;
    offers: number;
    accepted: number;
    rejected: number;
    discarded: number;
    companies: number;
    /** Interviews still live — not a subset of the window, this is "right now". */
    activeInterviews: number;
  };
  rates: { interview: number; offer: number; accepted: number };
  /** One row per day across the whole window, zero-filled so gaps read as gaps. */
  daily: { date: string; applications: number; interviews: number }[];
  funnel: { stage: FunnelStage; label: string; count: number }[];
  bySite: { site: string; applications: number; interviews: number; rate: number }[];
  byCompany: { company: string; applications: number; interviews: number }[];
  byProfile: { profileId: number; name: string; applications: number; interviews: number; offers: number }[];
  outcomes: { status: string; label: string; count: number }[];
}

const OUTCOME_LABELS: Record<string, string> = {
  active: 'In progress',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  ghosted: 'Ghosted',
  on_hold: 'On hold',
};

/** Statuses that mean the employer said yes at least once. */
const OFFER_STATUSES = new Set(['offer', 'accepted']);

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export const statsService = {
  async bidPerformance(
    userId: number,
    days: number,
    profileId?: number,
  ): Promise<BidPerformance> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const scope = usableProfileWhere(userId);
    const profileFilter = profileId ? { id: profileId, ...scope } : scope;

    // Resolve the profiles first: everything else keys off their ids, and it is
    // also what makes "a profile you may not use" return zeroes rather than an
    // error that would confirm the id exists.
    const profiles = await prisma.profile.findMany({
      where: profileFilter,
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const profileIds = profiles.map((p) => p.id);
    const nameOf = new Map(
      profiles.map((p) => [
        p.id,
        [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || `Profile ${p.id}`,
      ]),
    );

    if (profileIds.length === 0) {
      return emptyResult(days, from, to);
    }

    const [applications, interviews, activeInterviews, discarded] = await Promise.all([
      prisma.jobApplication.findMany({
        where: { profileId: { in: profileIds }, appliedAt: { gte: from, lte: to } },
        select: { profileId: true, jobId: true, jobCompany: true, appliedAt: true },
      }),
      prisma.interview.findMany({
        where: { profileId: { in: profileIds } },
        select: { profileId: true, jobId: true, status: true, createdAt: true },
      }),
      prisma.interview.count({
        where: { profileId: { in: profileIds }, status: 'active' },
      }),
      prisma.jobDiscard.count({
        where: { profileId: { in: profileIds }, discardedAt: { gte: from, lte: to } },
      }),
    ]);

    // Which (profile, job) pairs reached an interview. Keyed on the pair because
    // the same posting can be bid on by two profiles independently.
    const key = (p: number, j: number | null) => `${p}:${j ?? 'x'}`;
    const interviewByPair = new Map<string, (typeof interviews)[number]>();
    for (const iv of interviews) interviewByPair.set(key(iv.profileId, iv.jobId), iv);

    // Site comes off the job row, so applications whose posting was deleted fall
    // into "Unknown" rather than silently vanishing from the breakdown.
    const jobIds = [...new Set(applications.map((a) => a.jobId).filter((v): v is number => v != null))];
    const jobs = jobIds.length
      ? await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, site: true } })
      : [];
    const siteOf = new Map(jobs.map((j) => [j.id, String(j.site)]));

    let converted = 0;
    let offers = 0;
    let accepted = 0;
    let rejected = 0;
    const daily = new Map<string, { applications: number; interviews: number }>();
    const bySite = new Map<string, { applications: number; interviews: number }>();
    const byCompany = new Map<string, { company: string; applications: number; interviews: number }>();
    const byProfile = new Map<number, { applications: number; interviews: number; offers: number }>();

    for (let i = 0; i <= days; i++) {
      daily.set(dayKey(new Date(from.getTime() + i * 86400000)), { applications: 0, interviews: 0 });
    }

    for (const a of applications) {
      const iv = interviewByPair.get(key(a.profileId, a.jobId));
      const won = Boolean(iv);
      if (won) converted++;
      if (iv && OFFER_STATUSES.has(iv.status)) offers++;
      if (iv?.status === 'accepted') accepted++;
      if (iv?.status === 'rejected') rejected++;

      const d = daily.get(dayKey(a.appliedAt));
      if (d) {
        d.applications++;
        if (won) d.interviews++;
      }

      const site = (a.jobId != null ? siteOf.get(a.jobId) : undefined) ?? 'unknown';
      const s = bySite.get(site) ?? { applications: 0, interviews: 0 };
      s.applications++; if (won) s.interviews++; bySite.set(site, s);

      const label = (a.jobCompany ?? '').trim();
      if (label) {
        const norm = label.toLowerCase();
        const c = byCompany.get(norm) ?? { company: label, applications: 0, interviews: 0 };
        c.applications++; if (won) c.interviews++; byCompany.set(norm, c);
      }

      const p = byProfile.get(a.profileId) ?? { applications: 0, interviews: 0, offers: 0 };
      p.applications++;
      if (won) p.interviews++;
      if (iv && OFFER_STATUSES.has(iv.status)) p.offers++;
      byProfile.set(a.profileId, p);
    }

    const outcomeCounts = new Map<string, number>();
    for (const iv of interviews) {
      outcomeCounts.set(iv.status, (outcomeCounts.get(iv.status) ?? 0) + 1);
    }

    const applied = applications.length;
    return {
      range: { days, from: from.toISOString(), to: to.toISOString() },
      totals: {
        applications: applied,
        interviews: converted,
        offers,
        accepted,
        rejected,
        discarded,
        companies: byCompany.size,
        activeInterviews,
      },
      rates: {
        interview: pct(converted, applied),
        offer: pct(offers, applied),
        accepted: pct(accepted, applied),
      },
      daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })),
      // Monotonically decreasing by construction — each stage is a subset of the
      // one before it, which is what makes a funnel readable as a funnel.
      funnel: [
        { stage: 'applied', label: 'Applied', count: applied },
        { stage: 'interviewing', label: 'Reached interview', count: converted },
        { stage: 'offer', label: 'Offer', count: offers },
        { stage: 'accepted', label: 'Accepted', count: accepted },
      ],
      bySite: [...bySite.entries()]
        .map(([site, v]) => ({ site, ...v, rate: pct(v.interviews, v.applications) }))
        .sort((a, b) => b.applications - a.applications),
      byCompany: [...byCompany.values()]
        .sort((a, b) => b.applications - a.applications)
        .slice(0, 10),
      byProfile: [...byProfile.entries()]
        .map(([id, v]) => ({ profileId: id, name: nameOf.get(id) ?? `Profile ${id}`, ...v }))
        .sort((a, b) => b.applications - a.applications),
      outcomes: [...outcomeCounts.entries()]
        .map(([status, count]) => ({ status, label: OUTCOME_LABELS[status] ?? status, count }))
        .sort((a, b) => b.count - a.count),
    };
  },
};

function emptyResult(days: number, from: Date, to: Date): BidPerformance {
  const daily: BidPerformance['daily'] = [];
  for (let i = 0; i <= days; i++) {
    daily.push({ date: dayKey(new Date(from.getTime() + i * 86400000)), applications: 0, interviews: 0 });
  }
  return {
    range: { days, from: from.toISOString(), to: to.toISOString() },
    totals: { applications: 0, interviews: 0, offers: 0, accepted: 0, rejected: 0, discarded: 0, companies: 0, activeInterviews: 0 },
    rates: { interview: 0, offer: 0, accepted: 0 },
    daily,
    funnel: [
      { stage: 'applied', label: 'Applied', count: 0 },
      { stage: 'interviewing', label: 'Reached interview', count: 0 },
      { stage: 'offer', label: 'Offer', count: 0 },
      { stage: 'accepted', label: 'Accepted', count: 0 },
    ],
    bySite: [],
    byCompany: [],
    byProfile: [],
    outcomes: [],
  };
}
