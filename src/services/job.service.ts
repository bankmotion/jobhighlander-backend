import { Prisma, JobSite } from '@prisma/client';
import { prisma } from '../lib/prisma';

const JOB_SITES = new Set<string>(Object.values(JobSite));

/** Which side of the applied line to keep. `all` applies no filter. */
export type AppliedFilter = 'all' | 'applied' | 'unapplied';

/** Which side of the discarded line to keep. `all` applies no filter. */
export type DiscardedFilter = 'all' | 'discarded' | 'undiscarded';

export interface ListJobsParams {
  /** Filter to these sites (OR). Empty/undefined = all sites. */
  sites?: string[];
  /** When true, only remote jobs. */
  remote?: boolean;
  location?: string;
  /** Free-text search across title/description/location. */
  q?: string;
  /**
   * Keep only jobs this profile has (or has not) been marked applied to.
   *
   * Applied is per PROFILE, so it needs one: without `profileId` the filter is
   * meaningless and is ignored rather than guessed at.
   */
  applied?: AppliedFilter;
  /**
   * Keep only jobs this profile has (or has not) discarded.
   *
   * Per PROFILE for the same reason `applied` is, and ignored without one.
   * Independent of `applied`: "not discarded and not applied" is the shortlist
   * someone actually works from, so the two filters compose rather than
   * collapsing into one three-state control.
   */
  discarded?: DiscardedFilter;
  profileId?: number;
  page: number;
  pageSize: number;
}

/**
 * Read model for jobs. All query building lives here so routes stay thin.
 */
export const jobService = {
  async list(params: ListJobsParams) {
    const { sites, remote, location, q, applied, discarded, profileId, page, pageSize } = params;

    const validSites = (sites ?? []).filter((s) => JOB_SITES.has(s)) as JobSite[];

    /**
     * Applied is filtered in SQL, not after the fact.
     *
     * Trimming the page in JavaScript would leave `total` counting rows the
     * user cannot see: page 3 of "applied only" would report hundreds of
     * results and render four, and the last pages would be empty. The filter
     * has to reach the same query the count does.
     *
     * Ignored without a profile, since there is nothing to be applied AS.
     */
    const appliedWhere: Prisma.JobWhereInput =
      !profileId || !applied || applied === 'all'
        ? {}
        : applied === 'applied'
          ? { applications: { some: { profileId } } }
          : { applications: { none: { profileId } } };

    /**
     * Discarded is filtered in SQL for the same reason applied is: trimming the
     * page in JavaScript would leave `total` counting rows the user cannot see.
     */
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
