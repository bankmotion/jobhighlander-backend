import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';

export interface DiscardStatus {
  jobId: number;
  discardedAt: Date;
  discardedBy: string;
}

export type DiscardStatusMap = Record<number, DiscardStatus>;

export class DiscardError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DiscardError';
  }
}

export const discardService = {
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
    if (!profile) throw new DiscardError('Profile not found', 404);
    if (!job) throw new DiscardError('Job not found', 404);

    const existing = await prisma.jobDiscard.findUnique({
      where: { profileId_jobId: { profileId, jobId } },
      select: { id: true },
    });
    if (existing) return this.get(jobId, profileId, userId);

    await prisma.jobDiscard.create({
      data: {
        profileId,
        jobId,
        jobTitle: job.title,
        jobCompany: job.company,
        discardedById: userId,
      },
    });
    return this.get(jobId, profileId, userId);
  },

  async unmark(jobId: number, profileId: number, userId: number): Promise<boolean> {
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ...usableProfileWhere(userId) },
      select: { id: true },
    });
    if (!profile) throw new DiscardError('Profile not found', 404);
    const r = await prisma.jobDiscard.deleteMany({ where: { jobId, profileId } });
    return r.count > 0;
  },

  async get(jobId: number, profileId: number, userId: number): Promise<DiscardStatus | null> {
    const row = await prisma.jobDiscard.findFirst({
      where: { jobId, profileId, profile: usableProfileWhere(userId) },
      select: { jobId: true, discardedAt: true, discardedBy: { select: { email: true } } },
    });
    return row?.jobId == null
      ? null
      : { jobId: row.jobId, discardedAt: row.discardedAt, discardedBy: row.discardedBy.email };
  },

  async statusFor(jobIds: number[], profileId: number, userId: number): Promise<DiscardStatusMap> {
    if (jobIds.length === 0) return {};
    const rows = await prisma.jobDiscard.findMany({
      where: { jobId: { in: jobIds }, profileId, profile: usableProfileWhere(userId) },
      select: { jobId: true, discardedAt: true, discardedBy: { select: { email: true } } },
    });

    const out: DiscardStatusMap = {};
    for (const r of rows) {
      // jobId is nullable (a deleted posting sets it null), so a row can come
      // back without one even though the filter asked for a set.
      if (r.jobId == null) continue;
      out[r.jobId] = {
        jobId: r.jobId,
        discardedAt: r.discardedAt,
        discardedBy: r.discardedBy.email,
      };
    }
    return out;
  },
};
