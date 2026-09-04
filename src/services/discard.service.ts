import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';
import { buildCompanyHistory } from '../lib/company-history';

export interface DiscardStatus {
  jobId: number;
  discardedAt: Date;
  discardedBy: string;
}

export type DiscardStatusMap = Record<number, DiscardStatus>;

/**
 * A previous dismissal at the same company.
 *
 * Worth surfacing for the same reason the applied version is: it is a judgement
 * this profile already made about this employer, and it is easy to forget you
 * made it. It is a REMINDER, never a block — the posting stays in the list and
 * stays actionable.
 */
export interface DiscardCompanyHistory {
  company: string;
  discardedAt: Date;
  jobTitle: string;
  jobId: number | null;
  count: number;
}

export type DiscardCompanyHistoryMap = Record<number, DiscardCompanyHistory>;

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

  async companyHistoryFor(
    jobIds: number[],
    profileId: number,
    userId: number,
  ): Promise<DiscardCompanyHistoryMap> {
    if (jobIds.length === 0) return {};

    const [jobs, discards] = await Promise.all([
      prisma.job.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, company: true },
      }),
      prisma.jobDiscard.findMany({
        where: { profileId, profile: usableProfileWhere(userId), NOT: { jobCompany: null } },
        select: { jobId: true, jobCompany: true, jobTitle: true, discardedAt: true },
        // Newest first: the builder shows the first entry it sees per company.
        orderBy: { discardedAt: 'desc' },
      }),
    ]);

    const built = buildCompanyHistory(
      jobs,
      discards.map((d) => ({ ...d, at: d.discardedAt })),
    );

    const out: DiscardCompanyHistoryMap = {};
    for (const [jobId, e] of Object.entries(built)) {
      out[Number(jobId)] = {
        company: e.company,
        discardedAt: e.at,
        jobTitle: e.jobTitle,
        jobId: e.jobId,
        count: e.count,
      };
    }
    return out;
  },
};
