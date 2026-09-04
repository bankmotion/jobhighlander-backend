import { prisma } from '../lib/prisma';

async function main() {
  const rows = await prisma.$queryRawUnsafe<{ mn: Date | null; mx: Date | null; c: bigint }[]>(
    "SELECT MIN(created_at) mn, MAX(created_at) mx, COUNT(*) c FROM jobs WHERE site = 'dice'",
  );
  const r = rows[0];
  console.log(
    `dice rows: ${r.c} | first ${r.mn?.toISOString() ?? '-'} | latest ${r.mx?.toISOString() ?? '-'}`,
  );

  const migs = await prisma.$queryRawUnsafe<
    { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
  >(
    'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 6',
  );
  console.log('\nmost recently started migrations:');
  for (const m of migs) {
    const state = m.rolled_back_at
      ? 'ROLLED BACK'
      : m.finished_at
        ? `finished ${m.finished_at.toISOString()}`
        : 'UNFINISHED';
    console.log(`  ${m.migration_name.padEnd(46)} ${state}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
