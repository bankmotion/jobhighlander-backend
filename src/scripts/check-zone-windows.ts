/**
 * Sanity-check that the stats windows actually move with the viewer's zone.
 *
 * Read-only. Run against whatever database is configured; it reports what each
 * zone sees rather than asserting a fixed number, because the right answer
 * depends on when you run it.
 */
import { aiUsageService } from '../services/aiUsage.service';
import { startOfZonedDay, endOfZonedDate, startOfZonedDate, zonedDayKey } from '../lib/zone';

const ZONES = ['UTC', 'Europe/Warsaw', 'Asia/Dubai', 'America/New_York', 'Pacific/Kiritimati'];

const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z');

async function main() {
  const now = new Date();
  console.log(`now = ${iso(now)}\n`);

  console.log('--- "Today" starts at ---');
  for (const zone of ZONES) {
    const start = startOfZonedDay(now, zone);
    const hours = ((now.getTime() - start.getTime()) / 3_600_000).toFixed(1);
    console.log(`  ${zone.padEnd(20)} ${iso(start)}  (${hours}h ago, local date ${zonedDayKey(now, zone)})`);
  }

  console.log('\n--- Custom range 2026-09-01..2026-09-01 ---');
  for (const zone of ZONES) {
    const s = startOfZonedDate('2026-09-01', zone);
    const e = endOfZonedDate('2026-09-01', zone);
    const hours = ((e.getTime() - s.getTime() + 1) / 3_600_000).toFixed(0);
    console.log(`  ${zone.padEnd(20)} ${iso(s)} -> ${iso(e)}  (${hours}h)`);
  }

  console.log('\n--- adminSummary(preset=today) per zone ---');
  for (const zone of ZONES) {
    const r = await aiUsageService.adminSummary({ preset: 'today', tz: zone });
    console.log(
      `  ${zone.padEnd(20)} calls=${String(r.totals.calls).padStart(4)}  ` +
        `cost=$${r.totals.costUsd.toFixed(4)}  ` +
        `buckets=${r.daily.length}  first=${r.daily[0]?.label ?? '-'} last=${r.daily.at(-1)?.label ?? '-'}`,
    );
  }

  console.log('\n--- adminSummary(days=7) bucket dates per zone ---');
  for (const zone of ZONES) {
    const r = await aiUsageService.adminSummary({ days: 7, tz: zone });
    console.log(`  ${zone.padEnd(20)} ${r.daily.map((d) => d.label.slice(5)).join(' ')}  calls=${r.totals.calls}`);
  }

  console.log('\n--- DST: Europe/Warsaw local day lengths ---');
  for (const date of ['2026-03-28', '2026-03-29', '2026-10-25', '2026-11-01']) {
    const s = startOfZonedDate(date, 'Europe/Warsaw');
    const e = endOfZonedDate(date, 'Europe/Warsaw');
    console.log(`  ${date}  ${((e.getTime() - s.getTime() + 1) / 3_600_000).toFixed(0)}h`);
  }

  console.log('\n--- unknown zone falls back, does not throw ---');
  const bogus = await aiUsageService.adminSummary({ preset: 'today', tz: 'Mars/Olympus_Mons' });
  const utc = await aiUsageService.adminSummary({ preset: 'today', tz: 'UTC' });
  console.log(`  bogus calls=${bogus.totals.calls}, utc calls=${utc.totals.calls}, match=${bogus.totals.calls === utc.totals.calls}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
