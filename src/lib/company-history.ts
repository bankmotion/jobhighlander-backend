/**
 * "You have dealt with this company before."
 *
 * Shared by applications and discards because the two are the same computation
 * over the same denormalised columns — `job_company`, `job_title`, and a date.
 * Keeping one copy means the matching rule cannot drift between them, which
 * would be an unpleasant bug to meet: two badges on one card disagreeing about
 * whether two spellings of a company are the same employer.
 */

export interface HistoryRow {
  jobId: number | null;
  jobCompany: string | null;
  jobTitle: string;
  /** `appliedAt` or `discardedAt`, renamed by the caller. */
  at: Date;
}

export interface CompanyHistoryEntry {
  company: string;
  at: Date;
  jobTitle: string;
  jobId: number | null;
  /** How many OTHER postings at this company, excluding the one being shown. */
  count: number;
}

/**
 * Company names arrive from nine different scrapers, so they are matched on a
 * normalised form rather than exactly — "Acme  Inc." and "acme inc." are one
 * employer. Deliberately conservative: it collapses whitespace and case and
 * nothing else, because stripping suffixes like "Inc" would merge genuinely
 * different companies that share a stem.
 */
export const normaliseCompany = (v: string | null | undefined): string =>
  (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * @param jobs  the postings being displayed
 * @param rows  every prior record for this profile, NEWEST FIRST — the first
 *              entry seen for a company is the one shown, the rest only count
 */
export function buildCompanyHistory(
  jobs: { id: number; company: string | null }[],
  rows: HistoryRow[],
): Record<number, CompanyHistoryEntry> {
  const out: Record<number, CompanyHistoryEntry> = {};
  if (rows.length === 0) return out;

  const byCompany = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const key = normaliseCompany(r.jobCompany);
    if (!key) continue;
    const bucket = byCompany.get(key);
    if (bucket) bucket.push(r);
    else byCompany.set(key, [r]);
  }

  for (const job of jobs) {
    const key = normaliseCompany(job.company);
    if (!key) continue;
    const bucket = byCompany.get(key);
    if (!bucket) continue;
    // This very posting is excluded: "you applied to this company before" must
    // not be satisfied by the row for the job you are looking at.
    const others = bucket.filter((r) => r.jobId !== job.id);
    const latest = others[0];
    if (!latest) continue;
    out[job.id] = {
      company: job.company ?? latest.jobCompany ?? '',
      at: latest.at,
      jobTitle: latest.jobTitle,
      jobId: latest.jobId,
      count: others.length,
    };
  }
  return out;
}
