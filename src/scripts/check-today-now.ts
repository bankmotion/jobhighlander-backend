/**
 * What does "Today" return right now, in every plausible zone?
 *
 * If the number on screen matches a zone other than the viewer's, the zone is
 * not reaching the query — which is a different bug from the window being wrong.
 */
import { prisma } from '../lib/prisma';
import { jobService } from '../services/job.service';
import { resolveZone, startOfZonedDay } from '../lib/zone';

const ZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'UTC',
  'Europe/London',
  'Europe/Warsaw',
  'Asia/Dubai',
];

// Things a user might have stored that are NOT valid IANA names. These all fall
// back to UTC, silently, which is exactly how a zone bug hides.
const SUSPECT = ['PDT', 'PST', 'GMT-7', 'US/Pacific', 'America/Los_Angeles'];

async function main() {
  const now = new Date();
  console.log(`now ${now.toISOString()}\n`);

  console.log('--- posted=today, by zone ---');
  for (const tz of ZONES) {
    const r = await jobService.list({ page: 1, pageSize: 1, posted: 'today', tz });
    const start = startOfZonedDay(now, tz);
    const localNow = now.toLocaleString('en-GB', { timeZone: tz, hour12: false, timeStyle: 'short' });
    console.log(
      `  ${tz.padEnd(22)} ${String(r.pagination.total).padStart(5)} jobs   local time ${localNow}   day began ${start.toISOString()}`,
    );
  }

  console.log('\n--- what a stored zone string actually resolves to ---');
  for (const raw of SUSPECT) {
    const resolved = resolveZone(raw);
    const valid = resolved === raw;
    console.log(
      `  ${raw.padEnd(22)} -> ${resolved.padEnd(22)} ${valid ? 'ok' : 'NOT A VALID ZONE, fell back to UTC'}`,
    );
  }

  console.log('\n--- the Pacific window in detail ---');
  const tz = 'America/Los_Angeles';
  const start = startOfZonedDay(now, tz);
  const rows = await prisma.job.findMany({
    where: { postedAt: { gte: start } },
    select: { id: true, site: true, postedAt: true, title: true },
    orderBy: { postedAt: 'asc' },
  });
  console.log(`  window: ${start.toISOString()} -> now`);
  console.log(`  ${rows.length} jobs\n`);
  for (const r of rows.slice(0, 12)) {
    const pt = r.postedAt?.toLocaleString('en-GB', { timeZone: tz, hour12: false });
    console.log(`    #${String(r.id).padEnd(6)} ${String(r.site).padEnd(12)} ${pt} PT  ${r.title.slice(0, 46)}`);
  }
  if (rows.length > 12) console.log(`    … and ${rows.length - 12} more`);

  // The check that matters: is anything in the result outside the window?
  const strays = rows.filter((r) => !r.postedAt || r.postedAt < start);
  console.log(`\n  rows outside the window: ${strays.length} (must be 0)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
