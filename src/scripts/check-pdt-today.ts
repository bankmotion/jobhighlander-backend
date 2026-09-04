/**
 * What does "Today" actually cover for a viewer in Pacific time right now?
 *
 * Prints the window boundaries alongside an hour-by-hour count of `posted_at`,
 * so the difference between "today" and "the last 24 hours" is visible rather
 * than argued about.
 */
import { prisma } from '../lib/prisma';
import { addZonedDays, startOfZonedDay, zonedHourKey } from '../lib/zone';

const ZONE = 'America/Los_Angeles';

const local = (d: Date, zone = ZONE) =>
  d.toLocaleString('en-GB', { timeZone: zone, hour12: false, dateStyle: 'short', timeStyle: 'short' });

async function main() {
  const now = new Date();
  const todayStart = startOfZonedDay(now, ZONE);
  const threeDayStart = addZonedDays(todayStart, -2, ZONE);
  const rolling24 = new Date(now.getTime() - 24 * 3_600_000);
  const utcTodayStart = startOfZonedDay(now, 'UTC');

  console.log(`now            ${now.toISOString()}   = ${local(now)} PT`);
  console.log(`PT today began ${todayStart.toISOString()}   = ${local(todayStart)} PT`);
  console.log(`  → that is ${((now.getTime() - todayStart.getTime()) / 3_600_000).toFixed(1)} hours ago\n`);

  const count = (gte: Date) => prisma.job.count({ where: { postedAt: { gte } } });

  const [today, threeDay, last24, utcToday] = await Promise.all([
    count(todayStart),
    count(threeDayStart),
    count(rolling24),
    count(utcTodayStart),
  ]);

  console.log('jobs by window (filtering posted_at):');
  console.log(`  Today (PT)          ${String(today).padStart(6)}   since ${local(todayStart)} PT`);
  console.log(`  Last 24 hours       ${String(last24).padStart(6)}   since ${local(rolling24)} PT`);
  console.log(`  3 days (PT)         ${String(threeDay).padStart(6)}   since ${local(threeDayStart)} PT`);
  console.log(`  Today (UTC)         ${String(utcToday).padStart(6)}   since ${local(utcTodayStart)} PT`);

  const rows = await prisma.job.findMany({
    where: { postedAt: { gte: new Date(now.getTime() - 30 * 3_600_000) } },
    select: { postedAt: true },
  });

  const buckets = new Map<string, number>();
  for (const r of rows) {
    if (!r.postedAt) continue;
    const k = zonedHourKey(r.postedAt, ZONE);
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }

  console.log('\nposted_at by Pacific hour (last 30h):');
  const boundary = zonedHourKey(todayStart, ZONE);
  for (const k of [...buckets.keys()].sort()) {
    const isToday = k >= boundary;
    const age = ((now.getTime() - new Date().getTime()) / 1, 0);
    console.log(
      `  ${k.replace('T', ' ')}:00  ${String(buckets.get(k)).padStart(5)}  ${isToday ? '<= counted as Today' : '(yesterday in PT)'}${age ? '' : ''}`,
    );
  }

  const before = rows.filter((r) => r.postedAt && r.postedAt < todayStart).length;
  console.log(
    `\n${before} of the last 30h of postings fall BEFORE Pacific midnight, so "Today" excludes them.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
