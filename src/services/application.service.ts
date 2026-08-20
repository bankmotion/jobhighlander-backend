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

  /** Undo a mark. Returns false when there was nothing to undo. */
  async unmark(jobId: number, profileId: number, userId: number): Promise<boolean> {
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ...usableProfileWhere(userId) },
      select: { id: true },
    });
    if (!profile) throw new ApplicationError('Profile not found', 404);
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
};
