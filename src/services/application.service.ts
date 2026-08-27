import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';

/** What the list needs to render the badge, without joining the whole row. */
export interface AppliedStatus {
  jobId: number;
  appliedAt: Date;
  /** Email of whoever marked it — a shared profile has more than one user. */
  markedBy: string;
}

/** Keyed by job id. A job nobody applied to is simply absent. */
export type AppliedStatusMap = Record<number, AppliedStatus>;

/**
 * A prior application at the SAME company as some job on screen.
 *
 * The point is recall while scanning a list: you have dealt with this employer
 * before, here is when and for what. It is deliberately not the same thing as
 * `AppliedStatus`, which is about THIS posting.
 */
export interface CompanyHistory {
  /** The company as the job row spells it, for display. */
  company: string;
  /** When the earlier application was made — the most recent one if several. */
  appliedAt: Date;
  /** What that earlier application was for, so the badge can explain itself. */
  jobTitle: string;
  /** The job applied to then, when the posting still exists. */
  jobId: number | null;
  /** How many prior applications this profile has at that company. */
  count: number;
}

/** Keyed by the job id ON SCREEN, not by the earlier application's job id. */
export type CompanyHistoryMap = Record<number, CompanyHistory>;

/** One application on a job, named by the profile it was made for. */
export interface JobApplicationRow {
  profileId: number;
  profileName: string;
  appliedAt: Date;
  markedBy: string;
}

/** Raised for a rejected mark; the route turns it into a status code. */
export class ApplicationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

/**
 * Applied markers.
 *
 * Every method is scoped through `usableProfileWhere`, so a user can mark
 * against a profile they own OR one they were invited to — the same rule that
 * decides whether they can generate a resume from it. Marking is exactly as
 * much of a "use" of the profile as generating is.
 */
export const applicationService = {
  /**
   * Mark a job as applied for a profile. Idempotent: marking an already-marked
   * pairing returns the existing row untouched rather than moving `appliedAt`,
   * because a double click must not rewrite when you actually applied.
   */
  async mark(jobId: number, profileId: number, userId: number) {
    const [profile, job] = await Promise.all([
      prisma.profile.findFirst({
        where: { id: profileId, ...usableProfileWhere(userId) },
        select: { id: true },
      }),
      prisma.job.findUnique({ where: { id: jobId }, select: { title: true, company: true } }),
    ]);
    // A profile they may not use and one that does not exist are the same 404,
    // so the endpoint never confirms which profile ids are real.
    if (!profile) throw new ApplicationError('Profile not found', 404);
    if (!job) throw new ApplicationError('Job not found', 404);

    const existing = await prisma.jobApplication.findUnique({
      where: { profileId_jobId: { profileId, jobId } },
      select: { id: true },
    });
    if (existing) return this.get(jobId, profileId, userId);

    await prisma.jobApplication.create({
      data: {
        profileId,
        jobId,
        jobTitle: job.title,
        jobCompany: job.company,
        markedById: userId,
      },
    });
    return this.get(jobId, profileId, userId);
  },

  /**
   * Undo a mark. Returns false when there was nothing to undo.
   *
   * REFUSES while an interview timeline exists for this pairing. `interviews`
   * has no foreign key to this table — deliberately, so that a mis-click here
   * cannot cascade an entire interview history into nothing — which leaves
   * this check as the thing that keeps the two consistent. Un-applying a job
   * you are actively interviewing for is a slip in every realistic case, and
   * the timeline is the expensive half of the pair to lose.
   */
  async unmark(jobId: number, profileId: number, userId: number): Promise<boolean> {
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ...usableProfileWhere(userId) },
      select: { id: true },
    });
    if (!profile) throw new ApplicationError('Profile not found', 404);

    const interview = await prisma.interview.findUnique({
      where: { profileId_jobId: { profileId, jobId } },
      select: { id: true },
    });
    if (interview) {
      throw new ApplicationError(
        'This job has an interview timeline — delete that first to un-apply',
        409,
      );
    }

    const r = await prisma.jobApplication.deleteMany({ where: { jobId, profileId } });
    return r.count > 0;
  },

  /** One marker, or null. */
  async get(jobId: number, profileId: number, userId: number): Promise<AppliedStatus | null> {
    const row = await prisma.jobApplication.findFirst({
      where: { jobId, profileId, profile: usableProfileWhere(userId) },
      select: { jobId: true, appliedAt: true, markedBy: { select: { email: true } } },
    });
    return row?.jobId == null
      ? null
      : { jobId: row.jobId, appliedAt: row.appliedAt, markedBy: row.markedBy.email };
  },

  /**
   * Every application on ONE job, across every profile the caller may use.
   *
   * The per-profile status map answers "is this applied for the profile I have
   * selected". On a detail page reached by a bare URL the selected profile is
   * whichever came first, so that answer can be a confident "no" while another
   * of the user's own profiles already applied — which is exactly the duplicate
   * this feature exists to prevent. This answers the fuller question.
   *
   * One job and a handful of profiles, so the profile name is joined in rather
   * than resolved by a second round trip.
   */
  async forJob(jobId: number, userId: number): Promise<JobApplicationRow[]> {
    const rows = await prisma.jobApplication.findMany({
      where: { jobId, profile: usableProfileWhere(userId) },
      orderBy: { appliedAt: 'desc' },
      select: {
        profileId: true,
        appliedAt: true,
        markedBy: { select: { email: true } },
        profile: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    return rows.map((r) => ({
      profileId: r.profileId,
      profileName:
        [r.profile.firstName, r.profile.lastName].filter(Boolean).join(' ') ||
        r.profile.email ||
        `Profile #${r.profileId}`,
      appliedAt: r.appliedAt,
      markedBy: r.markedBy.email,
    }));
  },

  /**
   * Which of `jobIds` this profile has applied to. One query for a whole page
   * rather than a request per card, mirroring `resumeService.statusFor`.
   */
  async statusFor(jobIds: number[], profileId: number, userId: number): Promise<AppliedStatusMap> {
    if (jobIds.length === 0) return {};
    const rows = await prisma.jobApplication.findMany({
      where: { jobId: { in: jobIds }, profileId, profile: usableProfileWhere(userId) },
      select: { jobId: true, appliedAt: true, markedBy: { select: { email: true } } },
    });

    const out: AppliedStatusMap = {};
    for (const r of rows) {
      // jobId is nullable (a deleted posting sets it null), so a row can come
      // back without one even though the filter asked for a set.
      if (r.jobId == null) continue;
      out[r.jobId] = { jobId: r.jobId, appliedAt: r.appliedAt, markedBy: r.markedBy.email };
    }
    return out;
  },

  /**
   * For each job on screen, the profile's most recent EARLIER application at
   * the same company.
   *
   * Matching is on the company name, normalised to a trimmed, case-folded,
   * whitespace-collapsed form. That is deliberately exact rather than fuzzy:
   * scraped company names already vary enough ("Ladder" and "Ladders" are two
   * different employers in this database), and a loose match would claim you
   * had applied somewhere you had not — a worse failure than missing a badge.
   *
   * The comparison happens in JS rather than SQL so the normalisation is
   * explicit and identical for both sides, instead of depending on whatever
   * collation the column happens to carry. It costs one query over the
   * profile's own applications, which is bounded by how much a person applies.
   *
   * A job never matches its own application: the card already says "Applied"
   * for that, and "previously applied here" about itself reads as a bug.
   */
  async companyHistoryFor(
    jobIds: number[],
    profileId: number,
    userId: number,
  ): Promise<CompanyHistoryMap> {
    if (jobIds.length === 0) return {};

    const norm = (v: string | null | undefined): string =>
      (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

    const [jobs, applications] = await Promise.all([
      prisma.job.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, company: true },
      }),
      prisma.jobApplication.findMany({
        where: { profileId, profile: usableProfileWhere(userId), NOT: { jobCompany: null } },
        select: { jobId: true, jobCompany: true, jobTitle: true, appliedAt: true },
        orderBy: { appliedAt: 'desc' },
      }),
    ]);
    if (applications.length === 0) return {};

    // Newest first above, so the first entry seen for a company is the one to
    // show and the rest only contribute to the count.
    const byCompany = new Map<string, { rows: typeof applications; }>();
    for (const a of applications) {
      const key = norm(a.jobCompany);
      if (!key) continue;
      const bucket = byCompany.get(key);
      if (bucket) bucket.rows.push(a);
      else byCompany.set(key, { rows: [a] });
    }

    const out: CompanyHistoryMap = {};
    for (const job of jobs) {
      const key = norm(job.company);
      if (!key) continue;
      const bucket = byCompany.get(key);
      if (!bucket) continue;
      // Exclude this very posting, then take the most recent of what is left.
      const others = bucket.rows.filter((r) => r.jobId !== job.id);
      const latest = others[0];
      if (!latest) continue;
      out[job.id] = {
        company: job.company ?? latest.jobCompany ?? '',
        appliedAt: latest.appliedAt,
        jobTitle: latest.jobTitle,
        jobId: latest.jobId,
        count: others.length,
      };
    }
    return out;
  },
};
