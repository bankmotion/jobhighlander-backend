import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';

/**
 * Backfill `jobs.fingerprint` and merge the duplicate rows it exposes.
 *
 *   npx tsx src/scripts/dedupe-jobs.ts            dry run — reports, changes nothing
 *   npx tsx src/scripts/dedupe-jobs.ts --apply    write it
 *
 * Duplicates exist because `(site, siteJobId)` identifies a LISTING, not a JOB.
 * The Muse regenerates the hash in its URL slug on every render, and Glassdoor
 * issues several listing ids for one posting, so the same job entered five
 * times. See `Job.fingerprint` in schema.prisma.
 *
 * THE DANGEROUS PART is not deleting job rows — it is that `resumes.job_id` and
 * `job_applications.job_id` point at rows that are about to disappear. Both
 * carry a unique (profile_id, job_id), so re-pointing a dependent onto the
 * survivor can collide with one already there. Every merge below resolves that
 * explicitly; nothing is left to ON DELETE, which would silently null the job
 * off a resume the user paid model tokens for.
 */

/** Oldest row wins: it is the one any existing resume or application points at. */
const KEEP = 'oldest';

/**
 * Normalise for identity comparison.
 *
 * NFKD + accent-strip + lower-case + collapse every run of non-alphanumerics to
 * a single space. The last step is what does the real work: two captures of the
 * same posting differed by one character of whitespace, which an exact hash
 * would have treated as two different jobs.
 */
function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Field separator between fingerprint parts.
 *
 * Every part normalises to [a-z0-9 ] and `site` is an enum of lowercase words,
 * so a pipe can never occur inside a part and cannot blur the boundary between
 * two of them.
 *
 * Printable on purpose. This was briefly a raw NUL byte, which made the file
 * read as binary to grep AND silently disagreed with the Python writer, so the
 * two hashed the same job differently — precisely the drift a shared hash
 * cannot survive.
 */
const SEP = '|';

/** site + company + title + location + first 100 chars of the description. */
export function fingerprint(job: {
  site: string;
  company: string | null;
  title: string;
  location: string | null;
  description: string;
}): string {
  const parts = [
    job.site,
    norm(job.company),
    norm(job.title),
    norm(job.location),
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

  // 1. Stamp every row with its fingerprint BEFORE anything is deleted, so a
  //    run interrupted here leaves the table consistent and simply re-runnable.
  let stamped = 0;
  for (const [id, fp] of fpOf) {
    await prisma.job.update({ where: { id }, data: { fingerprint: fp } });
    stamped++;
  }
  logger.info(`Stamped ${stamped} fingerprints`);

  // 2. Merge each group inside a transaction: move the dependents that can
  //    move, drop the ones that would collide, then delete the loser rows.
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

  const remaining = await prisma.job.count();
  logger.info(`Jobs now: ${remaining} (was ${jobs.length}, removed ${jobs.length - remaining})`);

  const orphanResumes = await prisma.resume.count({ where: { jobId: null } });
  const orphanApps = await prisma.jobApplication.count({ where: { jobId: null } });
  logger.info(`Orphaned by this run: ${orphanResumes} resume(s), ${orphanApps} applied marker(s)`);
}

main()
  .catch((e) => {
    logger.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
