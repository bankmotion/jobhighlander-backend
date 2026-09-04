import { prisma } from '../lib/prisma';

async function main() {
  const total = await prisma.job.count();
  const withPosted = await prisma.job.count({ where: { postedAt: { not: null } } });
  console.log(`jobs ${total} | postedAt set on ${withPosted} (${((100 * withPosted) / Math.max(total, 1)).toFixed(1)}%)`);

  const rows = await prisma.$queryRawUnsafe<
    { site: string; c: bigint; p: bigint | null; mx: Date | null }[]
  >('SELECT site, COUNT(*) c, SUM(posted_at IS NOT NULL) p, MAX(posted_at) mx FROM jobs GROUP BY site ORDER BY c DESC');
  for (const r of rows) {
    console.log(
      `  ${String(r.site).padEnd(12)} total ${String(r.c).padStart(6)}  posted ${String(r.p ?? 0).padStart(6)}  latest ${r.mx?.toISOString() ?? '-'}`,
    );
  }

  const recent = await prisma.$queryRawUnsafe<{ d: string; c: bigint }[]>(
    "SELECT DATE(posted_at) d, COUNT(*) c FROM jobs WHERE posted_at IS NOT NULL GROUP BY d ORDER BY d DESC LIMIT 8",
  );
  console.log('\nmost recent posted_at days:');
  for (const r of recent) console.log(`  ${r.d}  ${r.c}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
