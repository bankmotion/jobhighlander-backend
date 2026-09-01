import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';

const KEEP = 'oldest';

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const SEP = '|';

// Location is deliberately absent — see the matching note on `_fingerprint`
// in job-seeking/scraper/db.py. One requisition broadcast to every metro was
// entering the table once per city.
//
// MUST stay in lockstep with that function: the two write the same column, so
// a part added or removed here has to be added or removed there in the same
// change, or the scraper and this script will disagree about job identity.
export function fingerprint(job: {
  site: string;
  company: string | null;
  title: string;
  description: string;
}): string {
  const parts = [
    job.site,
    norm(job.company),
    norm(job.title),
    norm(job.description).slice(0, 100),
  ];
  return crypto.createHash('sha1').update(parts.join(SEP)).digest('hex');
}

async function main() {
  const apply = process.argv.includes('--apply');
  logger.info(apply ? 'APPLY — changes will be written' : 'DRY RUN — nothing will be written');

  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      site: true,
      company: true,
      title: true,
      location: true,
      description: true,
      createdAt: true,
    },
    orderBy: { id: 'asc' },
  });
  logger.info(`Scanned ${jobs.length} jobs`);

  const groups = new Map<string, { id: number; createdAt: Date; title: string }[]>();
  const fpOf = new Map<number, string>();
  for (const j of jobs) {
    const fp = fingerprint(j);
    fpOf.set(j.id, fp);
    const key = `${j.site}${SEP}${fp}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ id: j.id, createdAt: j.createdAt, title: j.title });
  }

  const dupes = [...groups.values()].filter((g) => g.length > 1);
  const losers: number[] = [];
  const merges: { keep: number; drop: number[]; title: string }[] = [];
  for (const g of dupes) {
    const sorted = [...g].sort((a, b) =>
      KEEP === 'oldest' ? a.id - b.id : b.id - a.id,
    );
    const [keep, ...drop] = sorted;
    merges.push({ keep: keep.id, drop: drop.map((d) => d.id), title: keep.title });
    losers.push(...drop.map((d) => d.id));
  }

  logger.info(`${dupes.length} duplicate groups covering ${losers.length} redundant rows`);
  for (const m of merges.slice(0, 10)) {
    logger.info(`  keep #${m.keep}  drop ${m.drop.map((d) => `#${d}`).join(' ')}  ${m.title.slice(0, 60)}`);
  }
  if (merges.length > 10) logger.info(`  … and ${merges.length - 10} more groups`);

  // What is actually at stake: dependents sitting on rows about to be removed.
  const [resumesAtRisk, appsAtRisk] = await Promise.all([
    prisma.resume.findMany({
      where: { jobId: { in: losers } },
      select: { id: true, profileId: true, jobId: true },
    }),
    prisma.jobApplication.findMany({
      where: { jobId: { in: losers } },
      select: { id: true, profileId: true, jobId: true, appliedAt: true },
    }),
  ]);
  logger.info(
    `Dependents on rows to be removed: ${resumesAtRisk.length} resume(s), ${appsAtRisk.length} applied marker(s)`,
  );

  if (!apply) {
    logger.info('Dry run complete. Re-run with --apply to write.');
    return;
  }

  // 1. Merge each group inside a transaction: move the dependents that can
  //    move, drop the ones that would collide, then delete the loser rows.
  //
  //    ORDER MATTERS. Stamping every row first used to be safe, because with
  //    location in the key each row hashed uniquely. It no longer does: the
  //    rows in a group now share one fingerprint, and `UNIQUE(site,
  //    fingerprint)` rejects the second stamp. Deleting the losers first is
  //    what makes the surviving stamp free. A run interrupted here is still
  //    re-runnable — the groups are recomputed from content each time.
  let movedResumes = 0;
  let droppedResumes = 0;
  let movedApps = 0;
  let droppedApps = 0;

  for (const m of merges) {
    await prisma.$transaction(async (tx) => {
      for (const dropId of m.drop) {
        // ── resumes ──────────────────────────────────────────────────────
        const resumes = await tx.resume.findMany({ where: { jobId: dropId } });
        for (const r of resumes) {
          const clash = await tx.resume.findFirst({
            where: { profileId: r.profileId, jobId: m.keep },
            select: { id: true, updatedAt: true },
          });
          if (!clash) {
            await tx.resume.update({ where: { id: r.id }, data: { jobId: m.keep } });
            movedResumes++;
          } else {
            // The survivor already has a resume for this profile. Keep the
            // NEWER of the two — it is the one the user last generated — and
            // discard the other rather than leaving an orphan behind.
            if (r.updatedAt > clash.updatedAt) {
              await tx.resume.delete({ where: { id: clash.id } });
              await tx.resume.update({ where: { id: r.id }, data: { jobId: m.keep } });
              movedResumes++;
            } else {
              await tx.resume.delete({ where: { id: r.id } });
            }
            droppedResumes++;
          }
        }

        // ── applied markers ──────────────────────────────────────────────
        const apps = await tx.jobApplication.findMany({ where: { jobId: dropId } });
        for (const a of apps) {
          const clash = await tx.jobApplication.findFirst({
            where: { profileId: a.profileId, jobId: m.keep },
            select: { id: true, appliedAt: true },
          });
          if (!clash) {
            await tx.jobApplication.update({ where: { id: a.id }, data: { jobId: m.keep } });
            movedApps++;
          } else {
            // Two markers for one profile on what turns out to be one job.
            // Keep the EARLIER date: it is when the application actually went
            // out, and moving it later would misreport the user's own history.
            if (a.appliedAt < clash.appliedAt) {
              await tx.jobApplication.update({
                where: { id: clash.id },
                data: { appliedAt: a.appliedAt, markedById: a.markedById },
              });
            }
            await tx.jobApplication.delete({ where: { id: a.id } });
            droppedApps++;
          }
        }

        await tx.job.delete({ where: { id: dropId } });
      }
    });
  }

  logger.info(
    `Merged: ${movedResumes} resume(s) re-pointed, ${droppedResumes} folded; ` +
      `${movedApps} applied marker(s) re-pointed, ${droppedApps} folded`,
  );

  // 2. Stamp the survivors, now that nothing collides. Rows already carrying
  //    the right value are skipped so a re-run is cheap.
  const survivors = await prisma.job.findMany({
    select: { id: true, site: true, company: true, title: true, description: true, fingerprint: true },
  });
  let stamped = 0;
  for (const j of survivors) {
    const fp = fingerprint(j);
    if (fp === j.fingerprint) continue;
    await prisma.job.update({ where: { id: j.id }, data: { fingerprint: fp } });
    stamped++;
  }
  logger.info(`Stamped ${stamped} fingerprints`);

  const remaining = await prisma.job.count();
  logger.info(`Jobs now: ${remaining} (was ${jobs.length}, removed ${jobs.length - remaining})`);

  // A TOTAL, not a delta — some of these may long pre-date this run. Reported
  // as "orphaned by this run" it reads as damage the merge just caused, which
  // sent one investigation chasing two resumes that were five days old.
  const orphanResumes = await prisma.resume.count({ where: { jobId: null } });
  const orphanApps = await prisma.jobApplication.count({ where: { jobId: null } });
  logger.info(
    `Orphans in the table now (may pre-date this run): ${orphanResumes} resume(s), ` +
      `${orphanApps} applied marker(s)`,
  );
}

main()
  .catch((e) => {
    logger.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
