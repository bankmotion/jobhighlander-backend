/**
 * Are LinkedIn apply URLs distinguishable from the job page itself?
 *
 * Every LinkedIn row has an apply_url on linkedin.com, so a plain host match
 * would call all 8,343 of them "Easy apply". This looks at what those URLs
 * actually are before that label is trusted.
 */
import { prisma } from '../lib/prisma';

async function main() {
  for (const site of ['linkedin', 'himalayas', 'dice']) {
    const rows = await prisma.job.findMany({
      where: { site: site as never },
      select: { jobUrl: true, applyUrl: true },
      take: 6,
    });
    console.log(`=== ${site} ===`);
    for (const r of rows) {
      console.log(`  job   ${r.jobUrl}`);
      console.log(`  apply ${r.applyUrl}`);
      console.log(`  identical: ${r.jobUrl === r.applyUrl}`);
      console.log();
    }

    const all = await prisma.job.findMany({
      where: { site: site as never },
      select: { jobUrl: true, applyUrl: true },
    });
    const identical = all.filter((r) => r.applyUrl === r.jobUrl).length;
    console.log(`  ${identical}/${all.length} have apply_url EXACTLY equal to job_url\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
