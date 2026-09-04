/**
 * What does the sources filter actually offer, and why?
 *
 * The list is derived from the rows that exist, so a source with no jobs is
 * absent by construction. This says which case we are in.
 */
import { prisma } from '../lib/prisma';
import { jobService } from '../services/job.service';

async function main() {
  const { sites } = await jobService.filters();
  console.log('sources the filter offers:', sites.join(', '));
  console.log(`  ("other" present: ${sites.includes('other')})\n`);

  const counts = await prisma.job.groupBy({
    by: ['site'],
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
  });
  console.log('rows per site:');
  for (const c of counts) console.log(`  ${String(c.site).padEnd(16)} ${c._count._all}`);

  try {
    const manual = await prisma.job.count({ where: { site: 'other' } });
    console.log(`\nmanual jobs (site='other'): ${manual}`);
    if (manual === 0) {
      console.log(
        'None exist yet, so the data-derived list cannot offer "other" — there is\n' +
          'nothing for it to have been derived from.',
      );
    }
  } catch (e) {
    console.log('\ncounting site=other FAILED:', String(e).slice(0, 140));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
