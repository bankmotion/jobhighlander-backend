import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';

export interface AppliedStatus {
  jobId: number;
  appliedAt: Date;
  markedBy: string;
}

export type AppliedStatusMap = Record<number, AppliedStatus>;

export interface CompanyHistory {
  company: string;
  appliedAt: Date;
  jobTitle: string;
  jobId: number | null;
  count: number;
}

export type CompanyHistoryMap = Record<number, CompanyHistory>;

export interface JobApplicationRow {
  profileId: number;
  profileName: string;
  appliedAt: Date;
  markedBy: string;
}

export class ApplicationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

export const applicationService = {
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

  async get(jobId: number, profileId: number, userId: number): Promise<AppliedStatus | null> {
    const row = await prisma.jobApplication.findFirst({
      where: { jobId, profileId, profile: usableProfileWhere(userId) },
      select: { jobId: true, appliedAt: true, markedBy: { select: { email: true } } },
    });
    return row?.jobId == null
      ? null
      : { jobId: row.jobId, appliedAt: row.appliedAt, markedBy: row.markedBy.email };
  },

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
