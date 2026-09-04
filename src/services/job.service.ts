import { Prisma, JobSite } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { addZonedDays, endOfZonedDate, resolveZone, startOfZonedDate, startOfZonedDay } from '../lib/zone';
import { randomUUID } from 'node:crypto';
import { fingerprint } from '../lib/fingerprint';

const JOB_SITES = new Set<string>(Object.values(JobSite));

export type AppliedFilter = 'all' | 'applied' | 'unapplied';

export type DiscardedFilter = 'all' | 'discarded' | 'undiscarded';

// Whether an interview timeline has been opened for the pairing. Per PROFILE,
// like applied and discarded: an interview belongs to the profile that got it.
export type InterviewFilter = 'all' | 'started' | 'notstarted';

export interface ListJobsParams {
  sites?: string[];
  remote?: boolean;
  location?: string;
  q?: string;
  /// Per-field substring matches. Independent of `q`, and AND-ed with each
  /// other: each one narrows, where `q` widens across three columns at once.
  company?: string;
  title?: string;
  description?: string;
  applied?: AppliedFilter;
  othersApplied?: OthersAppliedFilter;
  discarded?: DiscardedFilter;
  interview?: InterviewFilter;
  profileId?: number;
  posted?: PostedFilter;
  /** ISO dates (YYYY-MM-DD), inclusive, interpreted in `tz`. */
  postedFrom?: string;
  postedTo?: string;
  /** The viewer's display zone. Unknown or absent means UTC. */
  tz?: string;
  page: number;
  pageSize: number;
}

export type PostedFilter = 'all' | 'today' | '24h' | '3d' | 'custom';

/**
 * Narrow by whether SOMEONE ELSE has already applied.
 *
 * Distinct from `applied`, which is about the profile you are viewing as. This
 * one is about the rest of the board: on a shared list the useful question
 * before spending a bid is "has another candidate already gone in on this?".
 *
 * "Someone else" excludes the profile being viewed as, so a posting only you
 * have applied to counts as `none` rather than `others`. Without a profile
 * selected there is nobody to exclude, so it means "anyone at all".
 */
export type OthersAppliedFilter = 'all' | 'others' | 'none';

function othersAppliedWhere(params: ListJobsParams): Prisma.JobWhereInput {
  const { othersApplied, profileId } = params;
  if (!othersApplied || othersApplied === 'all') return {};
  // `profileId ? { not: profileId } : undefined` is what makes this "someone
  // ELSE": with a profile selected we ignore that profile's own application.
  const byAnotherProfile: Prisma.JobApplicationWhereInput = profileId
    ? { profileId: { not: profileId } }
    : {};
  return othersApplied === 'others'
    ? { applications: { some: byAnotherProfile } }
    : { applications: { none: byAnotherProfile } };
}

/**
 * Narrow to when the job was posted.
 *
 * Jobs with no `postedAt` are EXCLUDED by any active window. About 5% of rows
 * have no posting date — almost all of them Glassdoor — and there is no honest
 * way to answer "was this posted today" for them. Including them would pad
 * every window with jobs that might be months old; the alternative, saying so
 * in the UI, is what the filter's caption does.
 */
function postedWhere(params: ListJobsParams): Prisma.JobWhereInput {
  const { posted, postedFrom, postedTo, tz } = params;
  if (!posted || posted === 'all') return {};
  const zone = resolveZone(tz);

  if (posted === 'custom') {
    // A one-sided range is still a range: an open end means "everything since"
    // or "everything until", which is a reasonable thing to ask for.
    if (!postedFrom && !postedTo) return {};
    return {
      postedAt: {
        ...(postedFrom ? { gte: startOfZonedDate(postedFrom, zone) } : {}),
        ...(postedTo ? { lte: endOfZonedDate(postedTo, zone) } : {}),
      },
    };
  }

  const now = new Date();

  // The one rolling window. Zone-independent by definition — twenty-four hours
  // back from this instant is the same instant everywhere — so it is the honest
  // answer to "what is new" regardless of what time it is where the viewer is.
  if (posted === '24h') {
    return { postedAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } };
  }

  // Calendar days, counted back from today in the viewer's zone: '3d' is today
  // and the two days before it, not the last 72 hours.
  const startOfToday = startOfZonedDay(now, zone);
  const gte = posted === 'today' ? startOfToday : addZonedDays(startOfToday, -2, zone);
  return { postedAt: { gte } };
}


export interface ManualJobInput {
  title: string;
  company?: string | null;
  description: string;
  jobUrl?: string | null;
  applyUrl?: string | null;
  location?: string | null;
  jobType?: string | null;
  salary?: string | null;
  remote?: boolean;
  /** ISO date (YYYY-MM-DD) in `tz`; defaults to now. */
  postedOn?: string | null;
  tz?: string;
}

/** Thrown when the posting is already in the table, with the id of the row. */
export class DuplicateJobError extends Error {
  constructor(readonly jobId: number) {
    super('That job is already on the list');
  }
}

export const jobService = {
  /**
   * Add a job by hand, for a posting that is not on any site we scrape.
   *
   * Stored as an ordinary row with `site = 'other'`, so it is filtered, paged,
   * applied to and generated against by exactly the same code as a scraped one.
   * There is no per-profile scoping on `jobs` and none is added here: a job the
   * whole team can see is the point of putting it in the shared table.
   *
   * Fingerprinted like every other row, so adding the same posting twice — the
   * predictable outcome of two people working the same lead — is caught rather
   * than duplicated.
   */
  async addManual(userId: number, input: ManualJobInput) {
    const site = 'other' as const;
    const company = input.company?.trim() || null;
    const title = input.title.trim();
    const description = input.description.trim();

    const fp = fingerprint({ site, company, title, description });

    // Checked before inserting so the caller gets the existing job to link to,
    // rather than a unique-constraint error with nothing useful in it.
    const existing = await prisma.job.findFirst({
      where: { site, fingerprint: fp },
      select: { id: true },
    });
    if (existing) throw new DuplicateJobError(existing.id);

    const zone = resolveZone(input.tz);
    // A date with no time means the start of that day WHERE THE USER IS, not
    // 00:00 UTC — otherwise "posted today" can land on yesterday for them.
    const postedAt = input.postedOn ? startOfZonedDate(input.postedOn, zone) : new Date();

    try {
      return await prisma.job.create({
        data: {
          site,
          // Unique per row and never shown. `site_siteJobId` is a unique key, so
          // this cannot be a constant, and there is no upstream id to use.
          siteJobId: `manual-${randomUUID()}`,
          title,
          description,
          company,
          // Every scraped row has a URL and parts of the UI link to it, so an
          // empty string is stored rather than null to keep the column's shape.
          jobUrl: input.jobUrl?.trim() || '',
          applyUrl: input.applyUrl?.trim() || null,
          location: input.location?.trim() || null,
          jobType: input.jobType?.trim() || null,
          salary: input.salary?.trim() || null,
          remote: input.remote ?? false,
          postedAt,
          fingerprint: fp,
          createdById: userId,
        },
      });
    } catch (err) {
      // Lost a race with another submission of the same posting between the
      // check above and this insert.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dupe = await prisma.job.findFirst({
          where: { site, fingerprint: fp },
          select: { id: true },
        });
        if (dupe) throw new DuplicateJobError(dupe.id);
      }
      throw err;
    }
  },

  async list(params: ListJobsParams) {
    const { sites, remote, location, q, company, title, description, applied, discarded, interview, profileId, page, pageSize } =
      params;

    const validSites = (sites ?? []).filter((s) => JOB_SITES.has(s)) as JobSite[];

    const appliedWhere: Prisma.JobWhereInput =
      !profileId || !applied || applied === 'all'
        ? {}
        : applied === 'applied'
          ? { applications: { some: { profileId } } }
          : { applications: { none: { profileId } } };

    const discardedWhere: Prisma.JobWhereInput =
      !profileId || !discarded || discarded === 'all'
        ? {}
        : discarded === 'discarded'
          ? { discards: { some: { profileId } } }
          : { discards: { none: { profileId } } };

    // Same shape as the two above, and ignored without a profile for the same
    // reason: there is nothing to have an interview AS.
    const interviewWhere: Prisma.JobWhereInput =
      !profileId || !interview || interview === 'all'
        ? {}
        : interview === 'started'
          ? { interviews: { some: { profileId } } }
          : { interviews: { none: { profileId } } };

    const where: Prisma.JobWhereInput = {
      ...postedWhere(params),
      ...(validSites.length ? { site: { in: validSites } } : {}),
      ...(remote ? { remote: true } : {}),
      ...(location ? { location: { contains: location } } : {}),
      ...(company ? { company: { contains: company } } : {}),
      ...(title ? { title: { contains: title } } : {}),
      ...(description ? { description: { contains: description } } : {}),
      ...appliedWhere,
      ...othersAppliedWhere(params),
      ...discardedWhere,
      ...interviewWhere,
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { description: { contains: q } },
              { location: { contains: q } },
            ],
          }
        : {}),
    };

    const [total, rows, latest] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        // How many profiles have applied to each posting, counted across ALL
        // profiles rather than the one being viewed as. That is the useful
        // signal on a shared board: "somebody already went in on this one".
        // The per-viewer "did I apply" answer is separate and already comes
        // from the applied provider.
        include: { _count: { select: { applications: true } } },
      }),
      // The newest id matching these filters, independent of the page being
      // read. Page 2's highest id is not the newest job, so polling for new
      // arrivals from it would under- or over-count depending where the reader
      // happens to be.
      prisma.job.findFirst({ where, orderBy: { id: 'desc' }, select: { id: true } }),
    ]);

    // Flatten Prisma's `_count` into a plain field so the API shape stays a
    // list of jobs rather than leaking the ORM's relation-count envelope.
    const items = rows.map(({ _count, ...job }) => ({
      ...job,
      appliedCount: _count.applications,
    }));

    return {
      items,
      latestId: latest?.id ?? 0,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  },

  // How many jobs newer than the one the client already has.
  //
  // Keyed on the highest id it holds, not on a timestamp: ids are autoincrement
  // so "newer" is exact, and it cannot drift when the browser's clock and the
  // server's disagree. The caller's filters are applied too, so the count
  // matches what pressing the button would actually add rather than the whole
  // table's growth.
  async newerCount(params: ListJobsParams & { afterId: number }) {
    const { afterId, sites, remote, location, q, company, title, description, profileId } = params;
    const validSites = (sites ?? []).filter((s) => JOB_SITES.has(s)) as JobSite[];

    const appliedWhere: Prisma.JobWhereInput =
      !profileId || !params.applied || params.applied === 'all'
        ? {}
        : params.applied === 'applied'
          ? { applications: { some: { profileId } } }
          : { applications: { none: { profileId } } };

    const discardedWhere: Prisma.JobWhereInput =
      !profileId || !params.discarded || params.discarded === 'all'
        ? {}
        : params.discarded === 'discarded'
          ? { discards: { some: { profileId } } }
          : { discards: { none: { profileId } } };

    const interviewWhere: Prisma.JobWhereInput =
      !profileId || !params.interview || params.interview === 'all'
        ? {}
        : params.interview === 'started'
          ? { interviews: { some: { profileId } } }
          : { interviews: { none: { profileId } } };

    return prisma.job.count({
      where: {
        id: { gt: afterId },
        ...(validSites.length ? { site: { in: validSites } } : {}),
        ...(remote ? { remote: true } : {}),
        ...(location ? { location: { contains: location } } : {}),
      ...(company ? { company: { contains: company } } : {}),
      ...(title ? { title: { contains: title } } : {}),
      ...(description ? { description: { contains: description } } : {}),
        ...appliedWhere,
        ...othersAppliedWhere(params),
        ...discardedWhere,
        ...interviewWhere,
        ...(q
          ? {
              OR: [
                { title: { contains: q } },
                { description: { contains: q } },
                { location: { contains: q } },
              ],
            }
          : {}),
      },
    });
  },

  async getById(id: number) {
    // Carries `appliedCount` for the same reason list() does: the standalone
    // job page shows the same badge row as the card, and a badge that appears
    // in the list then disappears when you open the posting reads as a bug.
    const row = await prisma.job.findUnique({
      where: { id },
      include: { _count: { select: { applications: true } } },
    });
    if (!row) return row;
    const { _count, ...job } = row;
    return { ...job, appliedCount: _count.applications };
  },

  async filters() {
    const [sites, locations] = await Promise.all([
      prisma.job.findMany({ distinct: ['site'], select: { site: true }, orderBy: { site: 'asc' } }),
      prisma.job.findMany({
        distinct: ['location'],
        select: { location: true },
        where: { location: { not: null } },
        orderBy: { location: 'asc' },
      }),
    ]);
    const present = sites.map((s) => s.site);

    // Every other source appears only once it has rows, which is right: a
    // scraper we do not run should not be offerable. 'other' is the exception,
    // because it is the one source the USER creates. Deriving it from the data
    // makes it a chicken-and-egg problem — you cannot filter to manually added
    // jobs until one exists, which is exactly when you want to check that
    // adding one worked. It also stops the option appearing and vanishing as
    // the last manual job is added or deleted.
    const withOther: JobSite[] = present.includes('other') ? present : [...present, 'other'];

    return {
      sites: withOther,
      locations: locations.map((l) => l.location).filter((l): l is string => Boolean(l)),
    };
  },
};
