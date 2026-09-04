/**
 * How many postings will read "Easy Apply" versus "Apply Now"?
 *
 * Mirrors the frontend's `applyTarget` rule exactly — registrable domain, so a
 * sub-domain like smartapply.indeed.com still counts as Indeed. Kept because it
 * is the only way to see the effect of a change to that rule before shipping it.
 */
import { prisma } from '../lib/prisma';

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
};

const registrable = (h: string) => h.split('.').slice(-2).join('.');

const sameSite = (a: string, b: string) => a === b || registrable(a) === registrable(b);

async function main() {
  const rows = await prisma.job.findMany({ select: { site: true, jobUrl: true, applyUrl: true } });

  const tally = new Map<string, { onsite: number; external: number; unknown: number }>();
  for (const r of rows) {
    const e = tally.get(r.site) ?? { onsite: 0, external: 0, unknown: 0 };
    const href = r.applyUrl || r.jobUrl;
    const ah = hostOf(href);
    const jh = hostOf(r.jobUrl);
    if (!ah || !jh) e.unknown++;
    else if (sameSite(ah, jh)) e.onsite++;
    else e.external++;
    tally.set(r.site, e);
  }

  let onsite = 0;
  let external = 0;
  let unknown = 0;
  console.log(
    `${'site'.padEnd(16)} ${'Easy Apply'.padStart(11)} ${'Apply Now'.padStart(11)} ${'no link'.padStart(9)}`,
  );
  for (const [site, e] of [...tally.entries()].sort(
    (a, b) => b[1].onsite + b[1].external - (a[1].onsite + a[1].external),
  )) {
    console.log(
      `${site.padEnd(16)} ${String(e.onsite).padStart(11)} ${String(e.external).padStart(11)} ${String(e.unknown).padStart(9)}`,
    );
    onsite += e.onsite;
    external += e.external;
    unknown += e.unknown;
  }
  const total = onsite + external + unknown;
  console.log(
    `\ntotal: ${onsite} Easy Apply (${((100 * onsite) / total).toFixed(1)}%), ` +
      `${external} Apply Now (${((100 * external) / total).toFixed(1)}%), ${unknown} with no usable link`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
