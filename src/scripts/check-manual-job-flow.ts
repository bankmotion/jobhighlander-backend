/**
 * End-to-end check of adding a job by hand.
 *
 * Creates a real row, exercises every path that has to see it, then deletes it.
 * The cleanup is in a `finally` so a failed assertion halfway through does not
 * leave a test posting in the shared job list.
 */
import { prisma } from '../lib/prisma';
import { DuplicateJobError, jobService } from '../services/job.service';

const MARKER = 'ZZ-SELFCHECK-DELETE-ME';

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true, email: true } });
  if (!user) throw new Error('no user to attribute the job to');

  let createdId: number | null = null;

  try {
    const before = await jobService.list({ page: 1, pageSize: 1, sites: ['other'] });
    console.log(`manual jobs before: ${before.pagination.total}`);

    const job = await jobService.addManual(user.id, {
      title: `${MARKER} Staff Platform Engineer`,
      company: 'Selfcheck Ltd',
      location: 'Remote, EU',
      remote: true,
      jobUrl: 'https://example.invalid/postings/selfcheck',
      jobType: 'Full-time',
      salary: '€100k',
      description:
        'This row was created by check-manual-job-flow.ts to verify that manually ' +
        'added jobs store, list and filter correctly. It is deleted before the ' +
        'script exits.',
      tz: 'America/Los_Angeles',
    });
    createdId = job.id;
    console.log(`created job #${job.id}  site=${job.site}  createdById=${job.createdById}`);
    console.log(`  postedAt   ${job.postedAt?.toISOString()}`);
    console.log(`  fingerprint ${job.fingerprint?.slice(0, 12)}…`);

    // 1. It is attributed.
    const check = (label: string, ok: boolean) => console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
    check('site is "other"', job.site === 'other');
    check('attributed to the creating user', job.createdById === user.id);
    check('has a fingerprint', Boolean(job.fingerprint));

    // 2. It shows up in the unfiltered list.
    const listed = await prisma.job.findUnique({ where: { id: job.id }, select: { id: true } });
    check('readable back', Boolean(listed));

    // 3. The sources filter offers it, and filtering by it finds it.
    const { sites } = await jobService.filters();
    check('"other" offered in the sources filter', sites.includes('other'));
    const onlyOther = await jobService.list({ page: 1, pageSize: 50, sites: ['other'] });
    check(
      'found when filtering to "other"',
      onlyOther.items.some((j) => j.id === job.id),
    );
    check('manual count went up by one', onlyOther.pagination.total === before.pagination.total + 1);

    // 4. It is inside the posted-date windows, since it was posted just now.
    for (const posted of ['today', '24h', '3d'] as const) {
      const r = await jobService.list({
        page: 1, pageSize: 50, posted, tz: 'America/Los_Angeles', sites: ['other'],
      });
      check(`inside posted=${posted}`, r.items.some((j) => j.id === job.id));
    }

    // 5. Adding the same posting again is refused, with the existing id.
    try {
      await jobService.addManual(user.id, {
        title: `${MARKER} Staff Platform Engineer`,
        company: 'Selfcheck Ltd',
        description:
          'This row was created by check-manual-job-flow.ts to verify that manually ' +
          'added jobs store, list and filter correctly. It is deleted before the ' +
          'script exits.',
      });
      check('duplicate rejected', false);
    } catch (e) {
      const dup = e instanceof DuplicateJobError;
      check('duplicate rejected', dup);
      if (dup) check('duplicate points at the original', (e as DuplicateJobError).jobId === job.id);
    }
  } finally {
    if (createdId != null) {
      await prisma.job.delete({ where: { id: createdId } });
      console.log(`\ncleaned up job #${createdId}`);
    }
    // Belt and braces: anything left over from an earlier interrupted run.
    const stragglers = await prisma.job.deleteMany({ where: { title: { startsWith: MARKER } } });
    if (stragglers.count) console.log(`removed ${stragglers.count} leftover test row(s)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
