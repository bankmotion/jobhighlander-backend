import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';

/**
 * Companies a profile does not want to bid.
 *
 * Deliberately NOT the scraper's `company_blocklist` setting. That one is
 * global, admin-only, and stops a posting being stored at all. This is the
 * bidders' own judgement, it is per profile, and it only FLAGS — the job stays
 * in the list and stays actionable, because "we don't bid this employer" is
 * advice to the person reading, not a reason to hide work from them.
 */
export class BlacklistError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BlacklistError';
  }
}

/**
 * Matching key for a company name: trimmed, lower-cased, internal whitespace
 * collapsed.
 *
 * Whole-name, never substring — the same call the scraper's blocklist
 * documents, and for the same reason: "Ladders" the recruiting agency must not
 * also take out "Ladder" the employer. Punctuation is deliberately KEPT, so
 * "ELLKAY, LLC" and "ELLKAY" stay distinct rather than one silently blacklisting
 * the other.
 */
export function companyKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const entrySelect = {
  id: true,
  company: true,
  companyKey: true,
  profileId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, email: true } },
  profile: { select: { id: true, firstName: true, lastName: true, email: true } },
} as const;

/** Profile ids this user may attach an entry to. */
async function usableProfileIds(userId: number): Promise<Set<number>> {
  const rows = await prisma.profile.findMany({
    where: usableProfileWhere(userId),
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export const blacklistService = {
  /**
   * Entries this user can see: the global ones plus those on profiles they own
   * or have been invited to. `profileId` narrows to one profile, still with the
   * global entries — those apply to it too, and hiding them would make the page
   * disagree with the flags on the job list.
   */
  async list(userId: number, profileId?: number) {
    const usable = await usableProfileIds(userId);
    if (profileId !== undefined && !usable.has(profileId)) {
      throw new BlacklistError('Profile not found', 404);
    }
    const scope =
      profileId !== undefined
        ? [{ profileId: null }, { profileId }]
        : [{ profileId: null }, { profileId: { in: [...usable] } }];

    const rows = await prisma.companyBlacklist.findMany({
      where: { OR: scope },
      select: entrySelect,
      // Global first, then newest — the entries that affect everything are the
      // ones you most want to notice.
      orderBy: [{ profileId: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => ({ ...r, scope: r.profileId === null ? 'all' : 'profile' }));
  },

  /**
   * Add a company for the "all" scope or for specific profiles.
   *
   * One call may create several rows (one per profile), so it reports what it
   * added AND what it skipped: adding a company that is already there is a
   * no-op rather than an error, but silently reporting success for a duplicate
   * would leave the user wondering why the list did not grow.
   */
  async create(userId: number, company: string, scope: 'all' | number[]) {
    const name = company.trim().replace(/\s+/g, ' ');
    if (!name) throw new BlacklistError('Company is required', 400);
    const key = companyKey(name);

    const targets: (number | null)[] = scope === 'all' ? [null] : [...new Set(scope)];
    if (!targets.length) throw new BlacklistError('Choose at least one profile', 400);

    if (scope !== 'all') {
      const usable = await usableProfileIds(userId);
      for (const id of targets) {
        if (id !== null && !usable.has(id)) throw new BlacklistError('Profile not found', 404);
      }
    }

    // The unique index cannot cover the global scope — MySQL treats NULLs as
    // distinct, so (NULL,'acme') could repeat — so duplicates are caught here
    // for every scope rather than only for the ones a constraint would catch.
    const existing = await prisma.companyBlacklist.findMany({
      where: { companyKey: key, profileId: { in: targets.filter((t) => t !== null) as number[] } },
      select: { profileId: true },
    });
    const taken = new Set<number | null>(existing.map((e) => e.profileId));
    if (targets.includes(null)) {
      const g = await prisma.companyBlacklist.findFirst({
        where: { companyKey: key, profileId: null },
        select: { id: true },
      });
      if (g) taken.add(null);
    }

    const fresh = targets.filter((t) => !taken.has(t));
    if (fresh.length) {
      await prisma.companyBlacklist.createMany({
        data: fresh.map((profileId) => ({
          company: name,
          companyKey: key,
          profileId,
          createdById: userId,
        })),
      });
    }
    return { added: fresh.length, skipped: targets.length - fresh.length };
  },

  /** Rename the company, or move the entry to a different scope. */
  async update(id: number, userId: number, patch: { company?: string; profileId?: number | null }) {
    const row = await this.assertUsable(id, userId);

    const data: { company?: string; companyKey?: string; profileId?: number | null } = {};
    if (patch.company !== undefined) {
      const name = patch.company.trim().replace(/\s+/g, ' ');
      if (!name) throw new BlacklistError('Company is required', 400);
      data.company = name;
      data.companyKey = companyKey(name);
    }
    if (patch.profileId !== undefined) {
      if (patch.profileId !== null) {
        const usable = await usableProfileIds(userId);
        if (!usable.has(patch.profileId)) throw new BlacklistError('Profile not found', 404);
      }
      data.profileId = patch.profileId;
    }

    // Would this edit collide with an entry that already exists?
    const nextKey = data.companyKey ?? row.companyKey;
    const nextProfile = data.profileId !== undefined ? data.profileId : row.profileId;
    const clash = await prisma.companyBlacklist.findFirst({
      where: { companyKey: nextKey, profileId: nextProfile, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw new BlacklistError('That company is already blacklisted for this scope', 409);

    await prisma.companyBlacklist.update({ where: { id }, data });
    return prisma.companyBlacklist.findUnique({ where: { id }, select: entrySelect });
  },

  async remove(id: number, userId: number) {
    await this.assertUsable(id, userId);
    await prisma.companyBlacklist.delete({ where: { id } });
    return { ok: true };
  },

  /**
   * An entry this user may change: a global one, or one on a profile they can
   * use. Not restricted to whoever created it — a shared profile is worked by
   * several people, and the same reasoning that lets any member mark a job
   * applied lets any member correct its blacklist. `createdBy` records whose
   * call it was; it does not fence the row off.
   */
  async assertUsable(id: number, userId: number) {
    const row = await prisma.companyBlacklist.findUnique({
      where: { id },
      select: { id: true, companyKey: true, profileId: true },
    });
    if (!row) throw new BlacklistError('Entry not found', 404);
    if (row.profileId !== null) {
      const usable = await usableProfileIds(userId);
      // A profile they may not use and one that does not exist are the same
      // 404, so the endpoint never confirms which ids are real.
      if (!usable.has(row.profileId)) throw new BlacklistError('Entry not found', 404);
    }
    return row;
  },

  /**
   * Which of these companies are blacklisted, for flagging a page of jobs.
   *
   * Takes the page's company names rather than scanning the table: a page is 20
   * rows, so this is one small indexed lookup instead of a join across every
   * job. Returns a map keyed by the NORMALISED name, which is what the caller
   * matches its jobs against.
   */
  async flagsFor(companies: string[], profileId?: number) {
    const keys = [...new Set(companies.filter(Boolean).map(companyKey))];
    if (!keys.length) return new Map<string, 'all' | 'profile'>();

    const rows = await prisma.companyBlacklist.findMany({
      where: {
        companyKey: { in: keys },
        // Global entries always count; a profile's own only when viewing as it.
        OR: profileId ? [{ profileId: null }, { profileId }] : [{ profileId: null }],
      },
      select: { companyKey: true, profileId: true },
    });

    const out = new Map<string, 'all' | 'profile'>();
    for (const r of rows) {
      // "all" wins over "profile": if a company is blacklisted globally that is
      // the stronger statement, and the badge should say so.
      const scope = r.profileId === null ? 'all' : 'profile';
      if (scope === 'all' || !out.has(r.companyKey)) out.set(r.companyKey, scope);
    }
    return out;
  },
};
