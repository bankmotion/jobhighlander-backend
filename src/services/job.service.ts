import { Prisma, JobSite } from '@prisma/client';
import { prisma } from '../lib/prisma';

const JOB_SITES = new Set<string>(Object.values(JobSite));

export interface ListJobsParams {
  /** Filter to these sites (OR). Empty/undefined = all sites. */
  sites?: string[];
  /** When true, only remote jobs. */
  remote?: boolean;
  location?: string;
  /** Free-text search across title/description/location. */
  q?: string;
  page: number;
  pageSize: number;
}

/**
 * Read model for jobs. All query building lives here so routes stay thin.
 */
export const jobService = {
  async list(params: ListJobsParams) {
    const { sites, remote, location, q, page, pageSize } = params;

    const validSites = (sites ?? []).filter((s) => JOB_SITES.has(s)) as JobSite[];
    const where: Prisma.JobWhereInput = {
      ...(validSites.length ? { site: { in: validSites } } : {}),
      ...(remote ? { remote: true } : {}),
      ...(location ? { location: { contains: location } } : {}),
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

  /** Distinct sites and locations, for populating filter dropdowns in the UI. */
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
