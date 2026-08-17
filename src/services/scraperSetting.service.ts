import { prisma } from '../lib/prisma';

/** Read/write the DB-managed scraper settings (super-admin dashboard). */
export const scraperSettingService = {
  list() {
    return prisma.scraperSetting.findMany({ orderBy: { key: 'asc' } });
  },

  /** Upsert each provided setting, then return the full list. */
  async update(entries: { key: string; value: string }[]) {
    await prisma.$transaction(
      entries.map((e) =>
        prisma.scraperSetting.upsert({
          where: { key: e.key },
          create: { key: e.key, value: e.value },
          update: { value: e.value },
        }),
      ),
    );
    return this.list();
  },
};
