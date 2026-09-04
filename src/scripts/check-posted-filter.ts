/**
 * Check the job-list posted filter against real rows, in several zones.
 *
 * Counts are compared with raw SQL over the same boundaries, so this catches a
 * where-clause that silently matches everything as well as one that matches
 * nothing.
 */
import { prisma } from '../lib/prisma';
import { jobService } from '../services/job.service';
import { addZonedDays, startOfZonedDay, startOfZonedDate, endOfZonedDate } from '../lib/zone';

const ZONES = ['UTC', 'Europe/Warsaw', 'Asia/Dubai', 'America/New_York'];

const countSince = async (gte: Date, lte?: Date): Promise<number> =>
  prisma.job.count({ where: { postedAt: { gte, ...(lte ? { lte } : {}) } } });

async function main() {
  const base = { page: 1, pageSize: 1 } as const;

  const all = await jobService.list({ ...base });
  console.log(`posted=all -> ${all.pagination.total} jobs (every row, dated or not)\n`);

  console.log('--- posted=today ---');
  for (const tz of ZONES) {
    const r = await jobService.list({ ...base, posted: 'today', tz });
    const expected = await countSince(startOfZonedDay(new Date(), tz));
    console.log(
      `  ${tz.padEnd(18)} ${String(r.pagination.total).padStart(5)}  (sql ${String(expected).padStart(5)})  ${r.pagination.total === expected ? 'ok' : 'MISMATCH'}`,
    );
  }

  console.log('\n--- posted=3d ---');
  for (const tz of ZONES) {
    const r = await jobService.list({ ...base, posted: '3d', tz });
    const expected = await countSince(addZonedDays(startOfZonedDay(new Date(), tz), -2, tz));
    console.log(
      `  ${tz.padEnd(18)} ${String(r.pagination.total).padStart(5)}  (sql ${String(expected).padStart(5)})  ${r.pagination.total === expected ? 'ok' : 'MISMATCH'}`,
    );
  }

  console.log('\n--- posted=custom 2026-09-01..2026-09-02 ---');
  for (const tz of ZONES) {
    const r = await jobService.list({
      ...base, posted: 'custom', postedFrom: '2026-09-01', postedTo: '2026-09-02', tz,
    });
    const expected = await countSince(startOfZonedDate('2026-09-01', tz), endOfZonedDate('2026-09-02', tz));
    console.log(
      `  ${tz.padEnd(18)} ${String(r.pagination.total).padStart(5)}  (sql ${String(expected).padStart(5)})  ${r.pagination.total === expected ? 'ok' : 'MISMATCH'}`,
    );
  }

  console.log('\n--- edge cases ---');
  const openEnd = await jobService.list({ ...base, posted: 'custom', postedFrom: '2026-09-03' });
  console.log(`  from only (since 09-03)      ${openEnd.pagination.total}`);
  const openStart = await jobService.list({ ...base, posted: 'custom', postedTo: '2026-08-01' });
  console.log(`  to only (until 08-01)        ${openStart.pagination.total}`);
  const empty = await jobService.list({ ...base, posted: 'custom' });
  console.log(`  custom with no dates         ${empty.pagination.total}  (expect ${all.pagination.total}, i.e. no filter)`);
  const undated = await prisma.job.count({ where: { postedAt: null } });
  console.log(`  rows with no postedAt        ${undated}  (excluded from every window above)`);

  const combined = await jobService.list({ ...base, posted: 'today', sites: ['linkedin'], tz: 'UTC' });
  console.log(`  today + site=linkedin        ${combined.pagination.total}  (must be <= today's ${(await jobService.list({ ...base, posted: 'today', tz: 'UTC' })).pagination.total})`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
