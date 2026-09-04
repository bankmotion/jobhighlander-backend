/**
 * Verify the rolling 24-hour window, and show it beside the calendar ones so
 * the difference is a number rather than an argument.
 */
import { prisma } from '../lib/prisma';
import { jobService } from '../services/job.service';
import { addZonedDays, startOfZonedDay } from '../lib/zone';

const ZONES = ['America/Los_Angeles', 'UTC', 'Europe/Warsaw', 'Asia/Dubai'];

async function main() {
  const base = { page: 1, pageSize: 1 } as const;
  const now = new Date();

  const sqlSince = (gte: Date) => prisma.job.count({ where: { postedAt: { gte } } });

  console.log(`now ${now.toISOString()}\n`);

  console.log('--- posted=24h is the SAME in every zone (it is rolling) ---');
  const expected24 = await sqlSince(new Date(now.getTime() - 24 * 3_600_000));
  for (const tz of ZONES) {
    const r = await jobService.list({ ...base, posted: '24h', tz });
    const got = r.pagination.total;
    // Tolerates rows landing between the two queries; a zone bug would be
    // hundreds out, not one or two.
    const ok = Math.abs(got - expected24) <= 5;
    console.log(`  ${tz.padEnd(22)} ${String(got).padStart(5)}  (sql ${expected24})  ${ok ? 'ok' : 'MISMATCH'}`);
  }

  console.log('\n--- posted=today DOES move with the zone (it is a calendar day) ---');
  for (const tz of ZONES) {
    const r = await jobService.list({ ...base, posted: 'today', tz });
    const expected = await sqlSince(startOfZonedDay(now, tz));
    const hours = ((now.getTime() - startOfZonedDay(now, tz).getTime()) / 3_600_000).toFixed(1);
    console.log(
      `  ${tz.padEnd(22)} ${String(r.pagination.total).padStart(5)}  (sql ${String(expected).padStart(5)})  ` +
        `${r.pagination.total === expected ? 'ok' : 'MISMATCH'}  — ${hours}h into the local day`,
    );
  }

  console.log('\n--- the whole ladder, for a Pacific viewer ---');
  const tz = 'America/Los_Angeles';
  for (const posted of ['today', '24h', '3d'] as const) {
    const r = await jobService.list({ ...base, posted, tz });
    console.log(`  ${posted.padEnd(6)} ${String(r.pagination.total).padStart(6)}`);
  }
  const all = await jobService.list({ ...base });
  console.log(`  all    ${String(all.pagination.total).padStart(6)}`);

  console.log('\n--- 24h must be a subset of 3d, and today a subset of 24h ---');
  const [t, h24, d3] = await Promise.all([
    jobService.list({ ...base, posted: 'today', tz }).then((r) => r.pagination.total),
    jobService.list({ ...base, posted: '24h', tz }).then((r) => r.pagination.total),
    jobService.list({ ...base, posted: '3d', tz }).then((r) => r.pagination.total),
  ]);
  console.log(`  today(${t}) <= 24h(${h24}): ${t <= h24 ? 'ok' : 'VIOLATED'}`);
  console.log(`  24h(${h24}) <= 3d(${d3}): ${h24 <= d3 ? 'ok' : 'VIOLATED'}`);
  console.log(`  ${addZonedDays(startOfZonedDay(now, tz), -2, tz).toISOString()} = start of the 3-day window`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
