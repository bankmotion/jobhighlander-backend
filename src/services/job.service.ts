import { Prisma, JobSite } from '@prisma/client';
import { prisma } from '../lib/prisma';

const JOB_SITES = new Set<string>(Object.values(JobSite));

export type AppliedFilter = 'all' | 'applied' | 'unapplied';

export type DiscardedFilter = 'all' | 'discarded' | 'undiscarded';

// Whether an interview timeline has been opened for the pairing. Per PROFILE,
// like applied and discarded: an interview belongs to the profile that got it.
export type InterviewFilter = 'all' | 'started' | 'notstarted';

export interface ListJobsParams {
  sites?: string[];
  remote?: boolean;
  location?: string;
  q?: string;
  applied?: AppliedFilter;
  discarded?: DiscardedFilter;
  interview?: InterviewFilter;
  profileId?: number;
  page: number;
  pageSize: number;
}

export const jobService = {
  async list(params: ListJobsParams) {
    const { sites, remote, location, q, applied, discarded, interview, profileId, page, pageSize } =
      params;

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

    // Same shape as the two above, and ignored without a profile for the same
    // reason: there is nothing to have an interview AS.
    const interviewWhere: Prisma.JobWhereInput =
      !profileId || !interview || interview === 'all'
        ? {}
        : interview === 'started'
          ? { interviews: { some: { profileId } } }
          : { interviews: { none: { profileId } } };

    const where: Prisma.JobWhereInput = {
      ...(validSites.length ? { site: { in: validSites } } : {}),
      ...(remote ? { remote: true } : {}),
      ...(location ? { location: { contains: location } } : {}),
      ...appliedWhere,
      ...discardedWhere,
      ...interviewWhere,
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

    const [total, items, latest] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      // The newest id matching these filters, independent of the page being
      // read. Page 2's highest id is not the newest job, so polling for new
      // arrivals from it would under- or over-count depending where the reader
      // happens to be.
      prisma.job.findFirst({ where, orderBy: { id: 'desc' }, select: { id: true } }),
    ]);

    return {
      items,
      latestId: latest?.id ?? 0,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  },

  // How many jobs newer than the one the client already has.
  //
  // Keyed on the highest id it holds, not on a timestamp: ids are autoincrement
  // so "newer" is exact, and it cannot drift when the browser's clock and the
  // server's disagree. The caller's filters are applied too, so the count
  // matches what pressing the button would actually add rather than the whole
  // table's growth.
  async newerCount(params: ListJobsParams & { afterId: number }) {
    const { afterId, sites, remote, location, q, profileId } = params;
    const validSites = (sites ?? []).filter((s) => JOB_SITES.has(s)) as JobSite[];

    const appliedWhere: Prisma.JobWhereInput =
      !profileId || !params.applied || params.applied === 'all'
        ? {}
        : params.applied === 'applied'
          ? { applications: { some: { profileId } } }
          : { applications: { none: { profileId } } };

    const discardedWhere: Prisma.JobWhereInput =
      !profileId || !params.discarded || params.discarded === 'all'
        ? {}
        : params.discarded === 'discarded'
          ? { discards: { some: { profileId } } }
          : { discards: { none: { profileId } } };

    const interviewWhere: Prisma.JobWhereInput =
      !profileId || !params.interview || params.interview === 'all'
        ? {}
        : params.interview === 'started'
          ? { interviews: { some: { profileId } } }
          : { interviews: { none: { profileId } } };

    return prisma.job.count({
      where: {
        id: { gt: afterId },
        ...(validSites.length ? { site: { in: validSites } } : {}),
        ...(remote ? { remote: true } : {}),
        ...(location ? { location: { contains: location } } : {}),
        ...appliedWhere,
        ...discardedWhere,
        ...interviewWhere,
        ...(q
          ? {
              OR: [
                { title: { contains: q } },
                { description: { contains: q } },
                { location: { contains: q } },
              ],
            }
          : {}),
      },
    });
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
