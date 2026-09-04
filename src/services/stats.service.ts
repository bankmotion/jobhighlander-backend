import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';
import { addZonedDays, zonedDayKey, zonedDaysBetween } from '../lib/zone';

export type FunnelStage = 'applied' | 'interviewing' | 'offer' | 'accepted';

// One row of the detailed applications list, shared by both dashboards.
//
// Title and company come from the APPLICATION, not the job: they are
// denormalised on the row precisely so the record still reads after the posting
// is deleted or deduplicated away. Site and location come from the job when it
// still exists, and are null when it does not — which is honest, where showing
// the job's current values would quietly rewrite history.
export interface AppliedRow {
  id: number;
  jobId: number | null;
  jobTitle: string;
  jobCompany: string | null;
  site: string | null;
  location: string | null;
  appliedAt: string;
  byUserId: number;
  byEmail: string;
  profileId: number;
  profileName: string;
}

// The list is capped so a year-long range cannot serialise the whole table into
// one response. The dashboards compare its length against `totals.applications`
// and say so when it is short, rather than presenting a truncated list as
// complete.
export const APPLIED_LIST_MAX = 2000;

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
  /// Newest first, capped at APPLIED_LIST_MAX.
  applied: AppliedRow[];
}

// ── Super-admin oversight view ──
// One member's activity ON ONE PROFILE. The same person appears once per
// profile they belong to, because "quiet on this profile, busy on that one" is
// exactly the thing this view exists to show.
export interface ProfileMemberStats {
  userId: number;
  email: string;
  role: string;
  isOwner: boolean;
  applications: number;
  interviews: number;
  offers: number;
  accepted: number;
  rejected: number;
  discarded: number;
  companies: number;
  activeInterviews: number;
  rates: { interview: number; offer: number; accepted: number };
  lastBidAt: string | null;
}

export interface ProfileBidRow {
  profileId: number;
  name: string;
  owner: { id: number; email: string };
  memberCount: number;
  activeBidders: number;
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
  lastBidAt: string | null;
  members: ProfileMemberStats[];
}

// One person across ALL profiles.
export interface TeamBidder {
  userId: number;
  email: string;
  role: string;
  profiles: number;
  applications: number;
  interviews: number;
  offers: number;
  accepted: number;
  rates: { interview: number; offer: number; accepted: number };
}

export interface TeamBidPerformance {
  range: { days: number; from: string; to: string };
  totals: {
    profiles: number;
    members: number;
    activeBidders: number;
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
  bySite: { site: string; applications: number; interviews: number; rate: number }[];
  byBidder: TeamBidder[];
  profiles: ProfileBidRow[];
  /// Every profile in the system, for the picker. Unaffected by `profileId`.
  allProfiles: { id: number; name: string }[];
  /// Which profile the figures are narrowed to, or null for all of them.
  profileId: number | null;
  /// Which bidder the figures are narrowed to, or null for everyone.
  bidder: number | null;
  /// Everyone with access to the in-scope profiles, for the bidder picker.
  bidders: { userId: number; email: string }[];
  /// Newest first, capped at APPLIED_LIST_MAX.
  applied: AppliedRow[];
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

// The zone travels WITH the window, so a caller cannot pass one and forget the
// other and end up bucketing a local range by UTC days.
export interface StatsWindow {
  from: Date;
  to: Date;
  zone: string;
}

const dayKey = (d: Date, zone: string): string => zonedDayKey(d, zone);
const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export const statsService = {
  async bidPerformance(
    userId: number,
    window: StatsWindow,
    opts: {
      profileId?: number;
      // Whose bids to count. Undefined = the caller's own, 'all' = every member
      // of the in-scope profiles, a number = that one teammate. Access is still
      // decided by profile membership, so this widens WHO is counted and never
      // WHICH profiles are visible.
      bidder?: number | 'all';
    } = {},
  ): Promise<BidPerformance> {
    const { profileId, bidder } = opts;
    const allUsers = bidder === 'all';
    const bidderId = typeof bidder === 'number' ? bidder : undefined;
    const { from, to, zone } = window;
    // Counted in LOCAL days, not elapsed milliseconds. Dividing by 86,400,000
    // and rounding turns a 21-hour "today" — which is what today is in
    // Pacific/Kiritimati at 07:00 UTC — into 2, and draws a bucket for a day
    // that has not started. This is the number of steps AFTER the first, so a
    // same-day range is 0 and yields one bucket.
    const days = zonedDaysBetween(from, to, zone) - 1;
    // Profile access is the same rule in both scopes — `allUsers` widens WHO
    // is counted, never WHICH profiles are visible.
    // Undefined bidder means "me"; a named bidder narrows to them; 'all' drops
    // the filter so every member's bids are counted.
    const markedByFilter: { markedById?: number } = allUsers
      ? {}
      : { markedById: bidderId ?? userId };

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
      return emptyResult(days, from, to, zone);
    }

    const [applications, myBidsEver, interviews, discarded, memberRows] = await Promise.all([
      prisma.jobApplication.findMany({
        where: {
          profileId: { in: profileIds },
          ...markedByFilter,
          appliedAt: { gte: from, lte: to },
        },
        select: {
          id: true, profileId: true, jobId: true, jobTitle: true, jobCompany: true,
          appliedAt: true, markedById: true,
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
          ...markedByFilter,
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
          ...(markedByFilter.markedById ? { discardedById: markedByFilter.markedById } : {}),
          discardedAt: { gte: from, lte: to },
        },
      }),
      // Option list for the bidder filter: everyone with ACCESS to the in-scope
      // profiles, which is the owner plus accepted invitees — the same rule as
      // `usableProfileWhere`.
      //
      // Membership, not activity. Deriving this from who has actually bid would
      // hide the people who have bid NOTHING, and "this teammate has sent zero
      // on this profile" is one of the more useful things to learn here. It is
      // also unwindowed and unfiltered by bidder, so selecting one does not
      // erase the others from the dropdown.
      prisma.profile.findMany({
        where: { id: { in: profileIds } },
        select: {
          owner: { select: { id: true, email: true } },
          invitations: {
            where: { status: 'accepted' },
            select: { user: { select: { id: true, email: true } } },
          },
        },
      }),
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
      ? await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, site: true, location: true } })
      : [];
    const siteOf = new Map(jobs.map((j) => [j.id, String(j.site)]));
    const jobMeta = new Map(jobs.map((j) => [j.id, { site: String(j.site), location: j.location }]));

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
      // Stepped in LOCAL days: a fixed 86,400,000ms stride drifts by an hour
      // across a daylight-saving change and starts filing rows under the
      // neighbouring day for the rest of the range.
      const at = addZonedDays(from, i, zone);
      // Exact, not `to` plus a day: the old slack was harmless while the count
      // was UTC-derived and is a second way to admit a future bucket now.
      if (at.getTime() > to.getTime()) break;
      daily.set(dayKey(at, zone), { applications: 0, interviews: 0 });
    }

    for (const a of applications) {
      const iv = interviewByPair.get(key(a.profileId, a.jobId));
      const won = Boolean(iv);
      if (won) converted++;
      if (iv && OFFER_STATUSES.has(iv.status)) offers++;
      if (iv?.status === 'accepted') accepted++;
      if (iv?.status === 'rejected') rejected++;

      const d = daily.get(dayKey(a.appliedAt, zone));
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
      // Always populated, even for a single bidder. It used to be suppressed
      // unless several people were in view, which was right when this only fed
      // a table — a one-row table says nothing. It now also feeds the "Who bid"
      // donut, and an empty array there left the chart blank on the default
      // "just me" view. Deciding what is worth SHOWING belongs to the client;
      // the service's job is to report what happened.
      byUser: [...byUser.entries()]
        .map(([id, v]) => ({ userId: id, ...v }))
        .sort((a, b) => b.applications - a.applications),
      applied: buildAppliedRows(applications, jobMeta, (id) => nameOf.get(id) ?? `Profile ${id}`),
    };
  },

  // Every profile in the system, each with its members and what each member
  // actually did. Super-admin only.
  //
  // This is NOT `bidPerformance` with a wider filter. That one answers "how am
  // I doing", starting from the profiles the caller may use and collapsing
  // everything into one set of totals. This answers "who is doing the work",
  // so the profile and the member are the axes and a member who sent nothing
  // has to appear with a zero — an aggregate would simply omit them, which is
  // the opposite of what an oversight view is for.
  async teamBidPerformance(
    window: StatsWindow,
    opts: { profileId?: number; bidder?: number } = {},
  ): Promise<TeamBidPerformance> {
    const { from, to, zone } = window;
    const { profileId, bidder } = opts;
// Counted in LOCAL days, not elapsed milliseconds. Dividing by 86,400,000
    // and rounding turns a 21-hour "today" — which is what today is in
    // Pacific/Kiritimati at 07:00 UTC — into 2, and draws a bucket for a day
    // that has not started. This is the number of steps AFTER the first, so a
    // same-day range is 0 and yields one bucket.
    const days = zonedDaysBetween(from, to, zone) - 1;

    // Narrowing to one profile is applied to EVERY query, not just the profile
    // list. Filtering only the profiles would leave the totals, the donut and
    // the daily series counting the whole organisation while the cards below
    // showed one team — the kind of disagreement a reader trusts and should
    // not.
    const only = profileId ? { profileId } : {};
    // Narrowing to one bidder filters the WORK, not the roster: the member
    // tables still list everyone with access, so a teammate who sent nothing
    // still shows a zero rather than disappearing.
    const byWho = bidder ? { markedById: bidder } : {};
    const discardedByWho = bidder ? { discardedById: bidder } : {};

    const [allProfiles, profiles, applications, bidsEver, interviews, discards] = await Promise.all([
      // Always the full set, regardless of the filter: it populates the picker,
      // which has to keep offering the other profiles once one is chosen.
      prisma.profile.findMany({
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      // No `usableProfileWhere` — that is the whole point of this view.
      prisma.profile.findMany({
        where: profileId ? { id: profileId } : {},
        select: {
          id: true, firstName: true, lastName: true, email: true, createdAt: true,
          owner: { select: { id: true, email: true, role: true } },
          invitations: {
            where: { status: 'accepted' },
            select: { user: { select: { id: true, email: true, role: true } } },
          },
        },
      }),
      prisma.jobApplication.findMany({
        where: { appliedAt: { gte: from, lte: to }, ...only, ...byWho },
        select: {
          id: true, profileId: true, jobId: true, jobTitle: true, jobCompany: true,
          appliedAt: true, markedById: true, markedBy: { select: { email: true } },
        },
      }),
      // Unwindowed, and needed for the same reason as in `bidPerformance`: an
      // interview opened today can belong to a bid sent months ago, so
      // attribution has to see the whole history, not just the window.
      prisma.jobApplication.findMany({
        where: { ...only, ...byWho },
        select: { profileId: true, jobId: true, markedById: true },
      }),
      prisma.interview.findMany({
        where: only,
        select: { profileId: true, jobId: true, status: true },
      }),
      prisma.jobDiscard.findMany({
        where: { discardedAt: { gte: from, lte: to }, ...only, ...discardedByWho },
        select: { profileId: true, discardedById: true },
      }),
    ]);

    // A bid is identified by (profile, job); an interview counts for the member
    // who SENT that bid, regardless of who later logged the call.
    const pairKey = (p: number, j: number | null) => `${p}:${j ?? 'x'}`;
    const memberKey = (p: number, u: number) => `${p}:${u}`;

    const interviewByPair = new Map<string, (typeof interviews)[number]>();
    for (const iv of interviews) interviewByPair.set(pairKey(iv.profileId, iv.jobId), iv);

    // (profile, member) -> the pairs they ever bid on. Lets a member's
    // interviews be counted without re-querying per member.
    const bidPairsByMember = new Map<string, Set<string>>();
    for (const b of bidsEver) {
      const k = memberKey(b.profileId, b.markedById);
      const set = bidPairsByMember.get(k) ?? new Set<string>();
      set.add(pairKey(b.profileId, b.jobId));
      bidPairsByMember.set(k, set);
    }

    const discardsByMember = new Map<string, number>();
    for (const d of discards) {
      if (d.discardedById == null) continue;
      const k = memberKey(d.profileId, d.discardedById);
      discardsByMember.set(k, (discardsByMember.get(k) ?? 0) + 1);
    }

    const appsByMember = new Map<string, typeof applications>();
    for (const a of applications) {
      const k = memberKey(a.profileId, a.markedById);
      const list = appsByMember.get(k) ?? [];
      list.push(a);
      appsByMember.set(k, list);
    }

    const jobIds = [...new Set(applications.map((a) => a.jobId).filter((v): v is number => v != null))];
    const jobs = jobIds.length
      ? await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, site: true, location: true } })
      : [];
    const siteOf = new Map(jobs.map((j) => [j.id, String(j.site)]));
    const jobMeta = new Map(jobs.map((j) => [j.id, { site: String(j.site), location: j.location }]));

    // Overall daily series, pre-seeded so empty days are plotted as zero rather
    // than closing the gap and implying activity that did not happen.
    const daily = new Map<string, { applications: number; interviews: number }>();
    for (let i = 0; i <= days; i++) {
      // Stepped in LOCAL days: a fixed 86,400,000ms stride drifts by an hour
      // across a daylight-saving change and starts filing rows under the
      // neighbouring day for the rest of the range.
      const at = addZonedDays(from, i, zone);
      // Exact, not `to` plus a day: the old slack was harmless while the count
      // was UTC-derived and is a second way to admit a future bucket now.
      if (at.getTime() > to.getTime()) break;
      daily.set(dayKey(at, zone), { applications: 0, interviews: 0 });
    }
    const bySiteAll = new Map<string, { applications: number; interviews: number }>();

    const profileRows: ProfileBidRow[] = profiles.map((p) => {
      const members = dedupeUsers([
        p.owner,
        ...p.invitations.map((i) => i.user),
      ]).map((m) => {
        const role =
          p.owner.id === m.userId
            ? p.owner.role
            : p.invitations.find((i) => i.user.id === m.userId)?.user.role ?? 'bidder';
        const k = memberKey(p.id, m.userId);
        const mine = appsByMember.get(k) ?? [];
        const everPairs = bidPairsByMember.get(k) ?? new Set<string>();

        let interviewsWon = 0, offers = 0, accepted = 0, rejected = 0;
        const companies = new Set<string>();
        let lastBidAt: Date | null = null;

        for (const a of mine) {
          const iv = interviewByPair.get(pairKey(a.profileId, a.jobId));
          if (iv) {
            interviewsWon++;
            if (OFFER_STATUSES.has(iv.status)) offers++;
            if (iv.status === 'accepted') accepted++;
            if (iv.status === 'rejected') rejected++;
          }
          const label = (a.jobCompany ?? '').trim();
          if (label) companies.add(label.toLowerCase());
          if (!lastBidAt || a.appliedAt > lastBidAt) lastBidAt = a.appliedAt;
        }

        // Live interviews are unwindowed: "in progress" is a statement about
        // now, not about the reporting range.
        const activeInterviews = interviews.filter(
          (iv) => iv.status === 'active' && everPairs.has(pairKey(iv.profileId, iv.jobId)),
        ).length;

        const applied = mine.length;
        return {
          userId: m.userId,
          email: m.email,
          role: String(role),
          isOwner: p.owner.id === m.userId,
          applications: applied,
          interviews: interviewsWon,
          offers,
          accepted,
          rejected,
          discarded: discardsByMember.get(k) ?? 0,
          companies: companies.size,
          activeInterviews,
          rates: {
            interview: pct(interviewsWon, applied),
            offer: pct(offers, applied),
            accepted: pct(accepted, applied),
          },
          lastBidAt: lastBidAt ? (lastBidAt as Date).toISOString() : null,
        } satisfies ProfileMemberStats;
      });

      // Profile totals come from the profile's own applications, not from
      // summing members: a bid whose author was deleted still belongs to the
      // profile, and summing members would quietly drop it.
      const profileApps = applications.filter((a) => a.profileId === p.id);
      let pInterviews = 0, pOffers = 0, pAccepted = 0, pRejected = 0;
      const pCompanies = new Set<string>();
      let pLast: Date | null = null;

      for (const a of profileApps) {
        const iv = interviewByPair.get(pairKey(a.profileId, a.jobId));
        if (iv) {
          pInterviews++;
          if (OFFER_STATUSES.has(iv.status)) pOffers++;
          if (iv.status === 'accepted') pAccepted++;
          if (iv.status === 'rejected') pRejected++;
        }
        const label = (a.jobCompany ?? '').trim();
        if (label) pCompanies.add(label.toLowerCase());
        if (!pLast || a.appliedAt > pLast) pLast = a.appliedAt;

        const d = daily.get(dayKey(a.appliedAt, zone));
        if (d) { d.applications++; if (iv) d.interviews++; }

        const site = (a.jobId != null ? siteOf.get(a.jobId) : undefined) ?? 'unknown';
        const s = bySiteAll.get(site) ?? { applications: 0, interviews: 0 };
        s.applications++; if (iv) s.interviews++; bySiteAll.set(site, s);
      }

      const applied = profileApps.length;
      return {
        profileId: p.id,
        name: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || `Profile ${p.id}`,
        owner: { id: p.owner.id, email: p.owner.email },
        memberCount: members.length,
        activeBidders: members.filter((m) => m.applications > 0).length,
        totals: {
          applications: applied,
          interviews: pInterviews,
          offers: pOffers,
          accepted: pAccepted,
          rejected: pRejected,
          discarded: discards.filter((d) => d.profileId === p.id).length,
          companies: pCompanies.size,
          activeInterviews: interviews.filter(
            (iv) => iv.profileId === p.id && iv.status === 'active',
          ).length,
        },
        rates: {
          interview: pct(pInterviews, applied),
          offer: pct(pOffers, applied),
          accepted: pct(pAccepted, applied),
        },
        lastBidAt: pLast ? (pLast as Date).toISOString() : null,
        members: members.sort((a, b) => b.applications - a.applications || a.email.localeCompare(b.email)),
      } satisfies ProfileBidRow;
    });

    // One row per person across every profile, so a bidder working three
    // profiles reads as one contributor rather than three part-timers.
    const byBidder = new Map<number, TeamBidder>();
    for (const row of profileRows) {
      for (const m of row.members) {
        const cur = byBidder.get(m.userId) ?? {
          userId: m.userId, email: m.email, role: m.role,
          profiles: 0, applications: 0, interviews: 0, offers: 0, accepted: 0,
          rates: { interview: 0, offer: 0, accepted: 0 },
        };
        cur.profiles++;
        cur.applications += m.applications;
        cur.interviews += m.interviews;
        cur.offers += m.offers;
        cur.accepted += m.accepted;
        byBidder.set(m.userId, cur);
      }
    }
    for (const b of byBidder.values()) {
      b.rates = {
        interview: pct(b.interviews, b.applications),
        offer: pct(b.offers, b.applications),
        accepted: pct(b.accepted, b.applications),
      };
    }

    const grand = profileRows.reduce(
      (acc, r) => {
        acc.applications += r.totals.applications;
        acc.interviews += r.totals.interviews;
        acc.offers += r.totals.offers;
        acc.accepted += r.totals.accepted;
        acc.rejected += r.totals.rejected;
        acc.discarded += r.totals.discarded;
        acc.activeInterviews += r.totals.activeInterviews;
        return acc;
      },
      { applications: 0, interviews: 0, offers: 0, accepted: 0, rejected: 0, discarded: 0, activeInterviews: 0 },
    );

    return {
      range: { days, from: from.toISOString(), to: to.toISOString() },
      totals: {
        ...grand,
        profiles: profileRows.length,
        members: byBidder.size,
        activeBidders: [...byBidder.values()].filter((b) => b.applications > 0).length,
        companies: new Set(
          applications.map((a) => (a.jobCompany ?? '').trim().toLowerCase()).filter(Boolean),
        ).size,
      },
      rates: {
        interview: pct(grand.interviews, grand.applications),
        offer: pct(grand.offers, grand.applications),
        accepted: pct(grand.accepted, grand.applications),
      },
      daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })),
      bySite: [...bySiteAll.entries()]
        .map(([site, v]) => ({ site, ...v, rate: pct(v.interviews, v.applications) }))
        .sort((a, b) => b.applications - a.applications),
      byBidder: [...byBidder.values()].sort(
        (a, b) => b.applications - a.applications || a.email.localeCompare(b.email),
      ),
      profiles: profileRows.sort(
        (a, b) => b.totals.applications - a.totals.applications || a.name.localeCompare(b.name),
      ),
      allProfiles: allProfiles
        .map((p) => ({
          id: p.id,
          name: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || `Profile ${p.id}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      profileId: profileId ?? null,
      bidder: bidder ?? null,
      // Membership, not activity, and unaffected by the bidder filter — the
      // picker has to keep offering the others once one is chosen.
      bidders: dedupeUsers(
        profiles.flatMap((p) => [p.owner, ...p.invitations.map((i) => i.user)]),
      ),
      applied: buildAppliedRows(
        applications,
        jobMeta,
        (id) => profileRows.find((r) => r.profileId === id)?.name ?? `Profile ${id}`,
      ),
    };
  },
};

// Built once and used by both dashboards, so the two lists cannot disagree
// about what a row means or how it is ordered.
function buildAppliedRows(
  applications: {
    id: number; profileId: number; jobId: number | null; jobTitle: string;
    jobCompany: string | null; appliedAt: Date; markedById: number;
    markedBy: { email: string } | null;
  }[],
  jobMeta: Map<number, { site: string; location: string | null }>,
  profileName: (id: number) => string,
): AppliedRow[] {
  return applications
    // Newest first: the list is read as "what has been sent lately", and a
    // stable secondary key on id keeps same-second rows from reordering
    // between requests.
    .slice()
    .sort((a, b) => b.appliedAt.getTime() - a.appliedAt.getTime() || b.id - a.id)
    .slice(0, APPLIED_LIST_MAX)
    .map((a) => {
      const meta = a.jobId != null ? jobMeta.get(a.jobId) : undefined;
      return {
        id: a.id,
        jobId: a.jobId,
        jobTitle: a.jobTitle,
        jobCompany: a.jobCompany,
        site: meta?.site ?? null,
        location: meta?.location ?? null,
        appliedAt: a.appliedAt.toISOString(),
        byUserId: a.markedById,
        byEmail: a.markedBy?.email ?? `User ${a.markedById}`,
        profileId: a.profileId,
        profileName: profileName(a.profileId),
      } satisfies AppliedRow;
    });
}

function dedupeUsers(
  rows: { id: number; email: string }[],
): { userId: number; email: string }[] {
  const byId = new Map<number, string>();
  for (const r of rows) if (r) byId.set(r.id, r.email);
  return [...byId.entries()]
    .map(([userId, email]) => ({ userId, email }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

function emptyResult(days: number, from: Date, to: Date, zone: string): BidPerformance {
  const daily: BidPerformance['daily'] = [];
  for (let i = 0; i <= days; i++) {
    daily.push({ date: dayKey(addZonedDays(from, i, zone), zone), applications: 0, interviews: 0 });
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
    applied: [],
  };
}
