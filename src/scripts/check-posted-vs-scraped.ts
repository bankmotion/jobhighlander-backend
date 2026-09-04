/**
 * posted_at vs created_at: how far apart are they, and how precise is posted_at?
 *
 * The job filter windows on `posted_at`. That is the right column — it answers
 * "how old is this job" rather than "when did our scraper get round to it" —
 * but only if the sites populate it well, which is what this measures.
 */
import { prisma } from '../lib/prisma';

const HOUR = 3_600_000;

async function main() {
  const total = await prisma.job.count();

  // How many rows carry a real time, versus a bare date stored as midnight?
  const midnightRows = await prisma.$queryRawUnsafe<{ site: string; c: bigint; mid: bigint }[]>(
    `SELECT site,
            COUNT(*) c,
            SUM(TIME(posted_at) = '00:00:00') mid
       FROM jobs
      WHERE posted_at IS NOT NULL
      GROUP BY site
      ORDER BY c DESC`,
  );

  console.log('posted_at precision by site (midnight = the site gave a DATE only):');
  for (const r of midnightRows) {
    const c = Number(r.c);
    const mid = Number(r.mid ?? 0);
    const pct = ((100 * mid) / Math.max(c, 1)).toFixed(0);
    console.log(
      `  ${String(r.site).padEnd(16)} ${String(c).padStart(6)} dated   ${String(mid).padStart(6)} date-only (${pct}%)`,
    );
  }

  // Lag between posting and scraping.
  const lag = await prisma.$queryRawUnsafe<
    { site: string; n: bigint; median_h: number | null; p90_h: number | null; max_h: number | null }[]
  >(
    `SELECT site,
            COUNT(*) n,
            AVG(TIMESTAMPDIFF(HOUR, posted_at, created_at)) median_h,
            MAX(TIMESTAMPDIFF(HOUR, posted_at, created_at)) max_h,
            MIN(TIMESTAMPDIFF(HOUR, posted_at, created_at)) p90_h
       FROM jobs
      WHERE posted_at IS NOT NULL
      GROUP BY site
      ORDER BY n DESC`,
  );

  console.log('\nhours between posted_at and created_at (scraped):');
  console.log(`  ${'site'.padEnd(16)} ${'rows'.padStart(6)}  ${'mean'.padStart(8)} ${'min'.padStart(8)} ${'max'.padStart(8)}`);
  for (const r of lag) {
    console.log(
      `  ${String(r.site).padEnd(16)} ${String(r.n).padStart(6)}  ${String(Math.round(Number(r.median_h ?? 0))).padStart(8)} ${String(r.p90_h ?? 0).padStart(8)} ${String(r.max_h ?? 0).padStart(8)}`,
    );
  }

  // What the choice of column actually costs in the 24h window.
  const now = new Date();
  const since = new Date(now.getTime() - 24 * HOUR);
  const [byPosted, byScraped, undated] = await Promise.all([
    prisma.job.count({ where: { postedAt: { gte: since } } }),
    prisma.job.count({ where: { createdAt: { gte: since } } }),
    prisma.job.count({ where: { postedAt: null } }),
  ]);

  console.log('\nlast 24 hours, the same window on each column:');
  console.log(`  by posted_at   ${String(byPosted).padStart(6)}   <- what the filter uses`);
  console.log(`  by created_at  ${String(byScraped).padStart(6)}   (when we scraped it)`);
  console.log(`\n  ${undated} of ${total} jobs have no posted_at and are excluded from every window.`);

  // The rows a scraped-at filter would catch and a posted-at filter would not.
  const freshlyScrapedOldPosting = await prisma.job.count({
    where: { createdAt: { gte: since }, postedAt: { lt: since } },
  });
  console.log(
    `  ${freshlyScrapedOldPosting} jobs were SCRAPED in the last 24h but POSTED before that.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
