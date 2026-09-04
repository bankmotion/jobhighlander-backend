/**
 * Does the running app still work against the current database?
 *
 * The Prisma client now declares `created_by_id` and `site = 'other'`. Until the
 * migration runs, the column does not exist — and Prisma selects every scalar
 * by default, so an ordinary job query would fail. This says plainly whether
 * that is the case.
 */
import { prisma } from '../lib/prisma';

async function main() {
  let migrated = true;

  try {
    await prisma.job.findFirst({ select: { id: true } });
    console.log('narrow select            ok');
  } catch (e) {
    console.log('narrow select            FAILED:', String(e).slice(0, 160));
  }

  try {
    const j = await prisma.job.findFirst();
    console.log(`full select (all columns) ok  (job #${j?.id})`);
  } catch (e) {
    migrated = false;
    const msg = String(e);
    const line = msg.split('\n').find((l) => /Unknown column|does not exist/i.test(l)) ?? msg.slice(0, 160);
    console.log('full select (all columns) FAILED:', line.trim());
  }

  try {
    const n = await prisma.job.count({ where: { site: 'other' } });
    console.log(`count(site='other')       ok  (${n} manual jobs)`);
  } catch (e) {
    migrated = false;
    const msg = String(e);
    const line = msg.split('\n').find((l) => /Data truncated|Unknown|Invalid/i.test(l)) ?? msg.slice(0, 160);
    console.log("count(site='other')       FAILED:", line.trim());
  }

  console.log(
    migrated
      ? '\nMigration is applied — manual jobs are ready to use.'
      : '\nMigration 20260904090000_manual_jobs has NOT been applied.\nRun: npx prisma migrate deploy',
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
