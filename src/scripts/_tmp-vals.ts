import { prisma } from '../lib/prisma';
prisma.scraperSetting
  .findMany({ where: { key: { contains: 'linkedin' } }, orderBy: { key: 'asc' } })
  .then((rs) => rs.forEach((r) => console.log(`${r.key} = ${r.value}`)))
  .finally(() => prisma.$disconnect());
