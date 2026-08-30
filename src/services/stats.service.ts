import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';

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
    activeInterviews: number;
  };
  rates: { interview: number; offer: number; accepted: number };
  daily: { date: string; applications: number; interviews: number }[];
  funnel: { stage: FunnelStage; label: string; count: number }[];
  bySite: { site: string; applications: number; interviews: number; rate: number }[];
  byCompany: { company: string; applications: number; interviews: number }[];
  byProfile: { profileId: number; name: string; applications: number; interviews: number; offers: number }[];
  outcomes: { status: string; label: string; count: number }[];
  byUser: { userId: number; email: string; applications: number; interviews: number; offers: number }[];
  bidders: { userId: number; email: string }[];
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

const OFFER_STATUSES = new Set(['offer', 'accepted']);

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export const statsService = {
  async bidPerformance(
    userId: number,
    window: { from: Date; to: Date },
    opts: {
      profileId?: number;
      allUsers?: boolean;
      userId?: number;
    } = {},
  ): Promise<BidPerformance> {
    const { profileId, allUsers = false, userId: bidderId } = opts;
    const { from, to } = window;
    // Inclusive day count, so a same-day range is one bucket rather than none.
    const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
    // Profile access is the same rule in both scopes — `allUsers` widens WHO
    // is counted, never WHICH profiles are visible.
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

    const [applications, myBidsEver, interviews, discarded, memberRows] = await Promise.all([
      prisma.jobApplication.findMany({
        where: {
          profileId: { in: profileIds },
          ...(allUsers ? (bidderId ? { markedById: bidderId } : {}) : { markedById: userId }),
          appliedAt: { gte: from, lte: to },
        },
        select: {
          profileId: true, jobId: true, jobCompany: true, appliedAt: true,
          markedById: true,
          markedBy: { select: { email: true } },
        },
      }),
      // Every bid this user ever made, ids only. Outcomes and the live count are
      // deliberately NOT windowed — an interview opened from a bid sent two
      // months ago is still this user's interview — so the join needs the whole
      // history, not just the window above.
      prisma.jobApplication.findMany({
        where: {
          profileId: { in: profileIds },
          ...(allUsers ? (bidderId ? { markedById: bidderId } : {}) : { markedById: userId }),
        },
        select: { profileId: true, jobId: true },
      }),
      prisma.interview.findMany({
        where: { profileId: { in: profileIds } },
        select: { profileId: true, jobId: true, status: true, createdAt: true },
      }),
      prisma.jobDiscard.count({
        where: {
          profileId: { in: profileIds },
          ...(allUsers ? (bidderId ? { discardedById: bidderId } : {}) : { discardedById: userId }),
          discardedAt: { gte: from, lte: to },
        },
      }),
      // Option list for the bidder filter: everyone with ACCESS to the in-scope
      // profiles, which is the owner plus accepted invitees — the same rule as
      // `usableProfileWhere`.
      //
      // Membership, not activity. Deriving this from who has actually bid would
      // hide the people who have bid NOTHING, and "this bidder has sent zero on
      // this profile" is one of the more useful things an admin can learn here.
      // It is also unwindowed and unfiltered by bidder, so selecting one does
      // not erase the others from the dropdown.
      allUsers
        ? prisma.profile.findMany({
            where: { id: { in: profileIds } },
            select: {
              owner: { select: { id: true, email: true } },
              invitations: {
                where: { status: 'accepted' },
                select: { user: { select: { id: true, email: true } } },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    // Which (profile, job) pairs reached an interview. Keyed on the pair because
    // the same posting can be bid on by two profiles independently.
    const key = (p: number, j: number | null) => `${p}:${j ?? 'x'}`;

    // Interviews are kept only where they sit on a bid this user sent. Who
    // OPENED the interview is not the test: a colleague logging the call for a
    // job you applied to still means your bid converted. What must not happen is
    // counting an interview from someone else's bid as yours.
    const myBidKeys = new Set(myBidsEver.map((b) => key(b.profileId, b.jobId)));
    const myInterviews = interviews.filter((iv) => myBidKeys.has(key(iv.profileId, iv.jobId)));

    const interviewByPair = new Map<string, (typeof interviews)[number]>();
    for (const iv of myInterviews) interviewByPair.set(key(iv.profileId, iv.jobId), iv);

    const activeInterviews = myInterviews.filter((iv) => iv.status === 'active').length;

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
    const byUser = new Map<number, { email: string; applications: number; interviews: number; offers: number }>();

    for (let i = 0; i <= days; i++) {
      const at = new Date(from.getTime() + i * 86400000);
      if (at.getTime() > to.getTime() + 86400000) break;
      daily.set(dayKey(at), { applications: 0, interviews: 0 });
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

      const u = byUser.get(a.markedById) ?? {
        email: a.markedBy?.email ?? `User ${a.markedById}`,
        applications: 0, interviews: 0, offers: 0,
      };
      u.applications++;
      if (won) u.interviews++;
      if (iv && OFFER_STATUSES.has(iv.status)) u.offers++;
      byUser.set(a.markedById, u);
    }

    const outcomeCounts = new Map<string, number>();
    for (const iv of myInterviews) {
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
      // Only meaningful when several people's bids are in scope; in the personal
      // view every row would be the caller, which is noise rather than a table.
      bidders: dedupeUsers(
        memberRows.flatMap((p) => [p.owner, ...p.invitations.map((i) => i.user)]),
      ),
      byUser: allUsers
        ? [...byUser.entries()]
            .map(([id, v]) => ({ userId: id, ...v }))
            .sort((a, b) => b.applications - a.applications)
        : [],
    };
  },
};

function dedupeUsers(
  rows: { id: number; email: string }[],
): { userId: number; email: string }[] {
  const byId = new Map<number, string>();
  for (const r of rows) if (r) byId.set(r.id, r.email);
  return [...byId.entries()]
    .map(([userId, email]) => ({ userId, email }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

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
    byUser: [],
    bidders: [],
  };
}
