/**
 * Company-level discard history, against real rows.
 *
 * The interesting cases are the ones easy to get wrong: a company must not be
 * its own history, and the applied and discard versions must agree on what
 * counts as the same employer.
 */
import { prisma } from '../lib/prisma';
import { discardService } from '../services/discard.service';
import { applicationService } from '../services/application.service';
import { normaliseCompany } from '../lib/company-history';

async function main() {
  let failures = 0;
  const check = (label: string, ok: boolean, detail = '') => {
    if (!ok) failures++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`);
  };

  // A profile that has actually discarded things, so this exercises real data.
  const busiest = await prisma.jobDiscard.groupBy({
    by: ['profileId'],
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
    take: 1,
  });
  if (busiest.length === 0) {
    console.log('no discards in the database — nothing to check');
    return;
  }
  const profileId = busiest[0].profileId;
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { ownerId: true, email: true },
  });
  if (!profile) throw new Error('profile vanished');
  console.log(`profile #${profileId} (${profile.email}) — ${busiest[0]._count._all} discards\n`);

  // Pick jobs at companies this profile HAS discarded before, which is the
  // case the badge exists for.
  const discards = await prisma.jobDiscard.findMany({
    where: { profileId, NOT: { jobCompany: null } },
    select: { jobId: true, jobCompany: true, discardedAt: true },
    orderBy: { discardedAt: 'desc' },
    take: 40,
  });
  const companies = [...new Set(discards.map((d) => d.jobCompany!))].slice(0, 10);

  const candidates = await prisma.job.findMany({
    where: { company: { in: companies } },
    select: { id: true, company: true },
    take: 60,
  });
  const jobIds = candidates.map((j) => j.id);
  console.log(`checking ${jobIds.length} postings at ${companies.length} previously-discarded companies`);

  const history = await discardService.companyHistoryFor(jobIds, profileId, profile.ownerId);
  const hits = Object.keys(history).length;
  console.log(`  ${hits} of them show the badge\n`);
  check('at least one posting has discard history', hits > 0);

  // The rule that matters: a posting is never its own history.
  let selfReferential = 0;
  for (const [jobIdStr, h] of Object.entries(history)) {
    if (h.jobId === Number(jobIdStr)) selfReferential++;
  }
  check('no posting is its own history', selfReferential === 0, `${selfReferential} self-referential`);

  // Every entry must match on the normalised company name.
  const byId = new Map(candidates.map((j) => [j.id, j.company]));
  let mismatched = 0;
  for (const [jobIdStr, h] of Object.entries(history)) {
    const jobCompany = normaliseCompany(byId.get(Number(jobIdStr)));
    if (jobCompany !== normaliseCompany(h.company)) mismatched++;
  }
  check('every entry matches its job company', mismatched === 0, `${mismatched} mismatched`);

  // Counts must be positive and the date must be real.
  const badCount = Object.values(history).filter((h) => h.count < 1).length;
  check('every count is at least 1', badCount === 0);
  const badDate = Object.values(history).filter((h) => !(h.discardedAt instanceof Date)).length;
  check('discardedAt is a Date', badDate === 0);

  // The applied version, over the same jobs, must use the same matching rule.
  const applied = await applicationService.companyHistoryFor(jobIds, profileId, profile.ownerId);
  let ruleDisagreement = 0;
  for (const [jobIdStr, a] of Object.entries(applied)) {
    const jobCompany = normaliseCompany(byId.get(Number(jobIdStr)));
    if (jobCompany !== normaliseCompany(a.company)) ruleDisagreement++;
  }
  check('applied history uses the same matching rule', ruleDisagreement === 0);
  console.log(`  (applied history covers ${Object.keys(applied).length} of the same postings)`);

  // Empty input must not query anything.
  const empty = await discardService.companyHistoryFor([], profileId, profile.ownerId);
  check('empty jobIds returns {}', Object.keys(empty).length === 0);

  // A profile the caller cannot use must yield nothing.
  const stranger = await prisma.user.findFirst({
    where: { id: { not: profile.ownerId } },
    select: { id: true },
  });
  if (stranger) {
    const leaked = await discardService.companyHistoryFor(jobIds, profileId, stranger.id);
    check(
      "another user's request for this profile returns nothing",
      Object.keys(leaked).length === 0,
      `${Object.keys(leaked).length} leaked`,
    );
  }

  const sample = Object.entries(history).slice(0, 3);
  if (sample.length) {
    console.log('\nsample:');
    for (const [jobId, h] of sample) {
      console.log(
        `  job #${jobId}: previously discarded at ${h.company} on ${h.discardedAt.toISOString().slice(0, 10)} — "${h.jobTitle.slice(0, 40)}" (${h.count} prior)`,
      );
    }
  }

  console.log(failures === 0 ? '\nall cases pass' : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
