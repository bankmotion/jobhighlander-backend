import crypto from 'node:crypto';

/**
 * Content identity for a job posting.
 *
 * Extracted from `scripts/dedupe-jobs.ts` so services can use it: that script
 * runs `main()` on import, so importing the function from there would run a
 * whole dedupe pass as a side effect of adding a job.
 *
 * MUST stay in lockstep with `_fingerprint` in job-seeking/scraper/db.py: the
 * two write the same column, so a part added or removed here has to be added or
 * removed there in the same change, or the scraper and the app will disagree
 * about which postings are the same job.
 */
function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Also the group-key separator used when scanning for duplicates. */
export const SEP = '|';

// Location is deliberately absent — see the matching note in the Python
// version. One requisition broadcast to every metro was entering the table once
// per city.
export function fingerprint(job: {
  site: string;
  company: string | null;
  title: string;
  description: string;
}): string {
  const parts = [job.site, norm(job.company), norm(job.title), norm(job.description).slice(0, 100)];
  return crypto.createHash('sha1').update(parts.join(SEP)).digest('hex');
}
