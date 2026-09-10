import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';

export interface RejectionStatus {
  jobId: number;
  note: string;
  rejectedAt: Date;
  rejectedBy: string;
}

export type RejectionStatusMap = Record<number, RejectionStatus>;

export class RejectionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RejectionError';
  }
}

/**
 * "They said no", recorded against one profile's application to one posting.
 *
 * Modelled on `discardService` deliberately — same shape, same ownership rules —
 * but kept apart from it, because a discard and a rejection are judgements made
 * by different people about the same job. See the `JobRejection` model.
 */
export const rejectionService = {
  /**
   * Record or update a rejection.
   *
   * An existing row is UPDATED rather than left alone, which is where this
   * differs from `discardService.mark`. A discard carries no information beyond
   * its existence, so marking twice is a no-op; a rejection carries the reason,
   * and re-submitting is how someone corrects or expands it.
   */
  async mark(jobId: number, profileId: number, userId: number, note: string) {
    const trimmed = note.trim();
    if (!trimmed) throw new RejectionError('A reason is required', 400);

    const [profile, job] = await Promise.all([
      prisma.profile.findFirst({
        where: { id: profileId, ...usableProfileWhere(userId) },
        select: { id: true },
      }),
      prisma.job.findUnique({ where: { id: jobId }, select: { title: true, company: true } }),
    ]);
    // A profile they may not use and one that does not exist are the same 404,
    // so the endpoint never confirms which profile ids are real.
    if (!profile) throw new RejectionError('Profile not found', 404);
    if (!job) throw new RejectionError('Job not found', 404);

    const existing = await prisma.jobRejection.findUnique({
      where: { profileId_jobId: { profileId, jobId } },
      select: { id: true },
    });

    if (existing) {
      // `rejectedAt` is left alone: editing the wording months later does not
      // move the date they were rejected, and overwriting it would quietly
      // rewrite the history the badge reports.
      await prisma.jobRejection.update({
        where: { id: existing.id },
        data: { note: trimmed, rejectedById: userId },
      });
    } else {
      await prisma.jobRejection.create({
        data: {
          profileId,
          jobId,
          jobTitle: job.title,
          jobCompany: job.company,
          note: trimmed,
          rejectedById: userId,
        },
      });
    }
    return this.get(jobId, profileId, userId);
  },

  async unmark(jobId: number, profileId: number, userId: number): Promise<boolean> {
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ...usableProfileWhere(userId) },
      select: { id: true },
    });
    if (!profile) throw new RejectionError('Profile not found', 404);
    const r = await prisma.jobRejection.deleteMany({ where: { jobId, profileId } });
    return r.count > 0;
  },

  async get(jobId: number, profileId: number, userId: number): Promise<RejectionStatus | null> {
    const row = await prisma.jobRejection.findFirst({
      where: { jobId, profileId, profile: usableProfileWhere(userId) },
      select: {
        jobId: true,
        note: true,
        rejectedAt: true,
        rejectedBy: { select: { email: true } },
      },
    });
    return row?.jobId == null
      ? null
      : {
          jobId: row.jobId,
          note: row.note,
          rejectedAt: row.rejectedAt,
          rejectedBy: row.rejectedBy.email,
        };
  },

  async statusFor(
    jobIds: number[],
    profileId: number,
    userId: number,
  ): Promise<RejectionStatusMap> {
    if (jobIds.length === 0) return {};
    const rows = await prisma.jobRejection.findMany({
      where: { jobId: { in: jobIds }, profileId, profile: usableProfileWhere(userId) },
      select: {
        jobId: true,
        note: true,
        rejectedAt: true,
        rejectedBy: { select: { email: true } },
      },
    });

    const out: RejectionStatusMap = {};
    for (const r of rows) {
      // jobId is nullable (a deleted posting sets it null), so a row can come
      // back without one even though the filter asked for a set.
      if (r.jobId == null) continue;
      out[r.jobId] = {
        jobId: r.jobId,
        note: r.note,
        rejectedAt: r.rejectedAt,
        rejectedBy: r.rejectedBy.email,
      };
    }
    return out;
  },
};
