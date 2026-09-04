/**
 * Which hosts does each source's job_url and apply_url actually point at?
 *
 * The "Easy apply" label depends on knowing each site's own domain. Deriving it
 * from the data beats hard-coding a guess: jobright.ai and himalayas.app are
 * not what you would assume from the source name.
 */
import { prisma } from '../lib/prisma';

const host = (u: string | null): string => {
  if (!u) return '(none)';
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '(unparseable)';
  }
};

async function main() {
  const rows = await prisma.job.findMany({
    select: { site: true, jobUrl: true, applyUrl: true },
  });

  const bySite = new Map<string, { job: Map<string, number>; apply: Map<string, number>; n: number }>();
  for (const r of rows) {
    let e = bySite.get(r.site);
    if (!e) {
      e = { job: new Map(), apply: new Map(), n: 0 };
      bySite.set(r.site, e);
    }
    e.n++;
    const jh = host(r.jobUrl);
    const ah = host(r.applyUrl);
    e.job.set(jh, (e.job.get(jh) ?? 0) + 1);
    e.apply.set(ah, (e.apply.get(ah) ?? 0) + 1);
  }

  const top = (m: Map<string, number>, k = 3) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([h, c]) => `${h}(${c})`).join(' ');

  for (const [site, e] of [...bySite.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`${site}  — ${e.n} jobs`);
    console.log(`   job_url hosts   : ${top(e.job)}`);
    console.log(`   apply_url hosts : ${top(e.apply, 4)}`);
  }

  // How often does apply_url stay on the same host as job_url? That is the
  // proportion of postings that would read "Easy apply".
  console.log('\nsame-host share (apply_url vs job_url):');
  for (const [site] of [...bySite.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const subset = rows.filter((r) => r.site === site);
    const withApply = subset.filter((r) => r.applyUrl);
    const same = withApply.filter((r) => host(r.applyUrl) === host(r.jobUrl)).length;
    const noApply = subset.length - withApply.length;
    console.log(
      `  ${site.padEnd(15)} ${String(same).padStart(6)}/${String(withApply.length).padEnd(6)} same-host   ${noApply} have no apply_url`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
