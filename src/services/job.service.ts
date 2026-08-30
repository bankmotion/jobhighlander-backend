import { Prisma, JobSite } from '@prisma/client';
import { prisma } from '../lib/prisma';

const JOB_SITES = new Set<string>(Object.values(JobSite));

export type AppliedFilter = 'all' | 'applied' | 'unapplied';

export type DiscardedFilter = 'all' | 'discarded' | 'undiscarded';

export interface ListJobsParams {
  sites?: string[];
  remote?: boolean;
  location?: string;
  q?: string;
  applied?: AppliedFilter;
  discarded?: DiscardedFilter;
  profileId?: number;
  page: number;
  pageSize: number;
}

export const jobService = {
  async list(params: ListJobsParams) {
    const { sites, remote, location, q, applied, discarded, profileId, page, pageSize } = params;

    const validSites = (sites ?? []).filter((s) => JOB_SITES.has(s)) as JobSite[];

    const appliedWhere: Prisma.JobWhereInput =
      !profileId || !applied || applied === 'all'
        ? {}
        : applied === 'applied'
          ? { applications: { some: { profileId } } }
          : { applications: { none: { profileId } } };

    const discardedWhere: Prisma.JobWhereInput =
      !profileId || !discarded || discarded === 'all'
        ? {}
        : discarded === 'discarded'
          ? { discards: { some: { profileId } } }
          : { discards: { none: { profileId } } };

    const where: Prisma.JobWhereInput = {
      ...(validSites.length ? { site: { in: validSites } } : {}),
      ...(remote ? { remote: true } : {}),
      ...(location ? { location: { contains: location } } : {}),
      ...appliedWhere,
      ...discardedWhere,
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { description: { contains: q } },
              { location: { contains: q } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  },

  async getById(id: number) {
    return prisma.job.findUnique({ where: { id } });
  },

  async filters() {
    const [sites, locations] = await Promise.all([
      prisma.job.findMany({ distinct: ['site'], select: { site: true }, orderBy: { site: 'asc' } }),
      prisma.job.findMany({
        distinct: ['location'],
        select: { location: true },
        where: { location: { not: null } },
        orderBy: { location: 'asc' },
      }),
    ]);
    return {
      sites: sites.map((s) => s.site),
      locations: locations.map((l) => l.location).filter((l): l is string => Boolean(l)),
    };
  },
};
