import { prisma } from '../lib/prisma';

export interface ScrapeRunFilters {
  sites?: string[];
  statuses?: string[];
}

/** Read model for scraper run logs (surfaced on the super-admin dashboard). */
export const scrapeRunService = {
  /** One page of runs, newest first, plus the totals and the filter options.
   *
   *  Filtering is done in SQL rather than in the client: the list is paginated,
   *  so filtering the fetched page would silently miss every older match.
   */
  async list(page = 1, pageSize = 25, filters: ScrapeRunFilters = {}) {
    const take = Math.min(Math.max(pageSize, 1), 100);
    const current = Math.max(page, 1);
    // `in` rather than equals — the UI is a multi-select, so several sites or
    // statuses can be active at once.
    const where: { site?: { in: string[] }; status?: { in: string[] } } = {};
    if (filters.sites?.length) where.site = { in: filters.sites };
    if (filters.statuses?.length) where.status = { in: filters.statuses };

    const [runs, total, sites] = await Promise.all([
      prisma.scrapeRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (current - 1) * take,
        take,
      }),
      prisma.scrapeRun.count({ where }),
      // Options for the dropdown — every site that has ever run.
      prisma.scrapeRun.findMany({
        distinct: ['site'],
        select: { site: true },
        orderBy: { site: 'asc' },
      }),
    ]);

    return {
      runs,
      filters: { sites: sites.map((s) => s.site) },
      pagination: {
        page: current,
        pageSize: take,
        total,
        totalPages: Math.max(Math.ceil(total / take), 1),
      },
    };
  },
};
