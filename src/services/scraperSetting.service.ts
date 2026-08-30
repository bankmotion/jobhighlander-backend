import { prisma } from '../lib/prisma';

export const scraperSettingService = {
  list() {
    return prisma.scraperSetting.findMany({ orderBy: { key: 'asc' } });
  },

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
