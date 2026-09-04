import { prisma } from '../lib/prisma';

prisma.job
  .count({ where: { OR: [{ title: { contains: 'SELFCHECK' } }, { title: { contains: 'ROUTECHECK' } }] } })
  .then((n) => console.log('leftover test rows:', n))
  .then(() => prisma.job.count())
  .then((n) => console.log('total jobs:', n))
  .finally(() => process.exit(0));
