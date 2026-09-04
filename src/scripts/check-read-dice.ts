import { prisma } from '../lib/prisma';

async function main() {
  const rows = await prisma.job.findMany({ where: { site: 'dice' }, take: 3, select: { id: true, site: true, title: true } });
  console.log('read', rows.length, 'dice rows with the LOCAL client, no error');
  for (const r of rows) console.log('  #' + r.id, r.site, r.title.slice(0, 40));
  const all = await prisma.job.findMany({ take: 5, orderBy: { id: 'desc' }, select: { id: true, site: true } });
  console.log('unfiltered findMany also fine:', all.map((r) => r.site).join(', '));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', String(e).slice(0, 200)); process.exit(1); });
