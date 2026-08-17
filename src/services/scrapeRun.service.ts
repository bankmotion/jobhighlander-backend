import { prisma } from '../lib/prisma';

/** Read model for scraper run logs (surfaced on the super-admin dashboard). */
export const scrapeRunService = {
  /** Most recent runs, newest first. */
  list(limit = 100) {
    return prisma.scrapeRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  },
};
