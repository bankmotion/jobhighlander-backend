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
 *
 * SCOPE. Every entry belongs to exactly one profile. "All profiles" in the UI
 * means "every profile I can use" — owned plus shared with me — and is expanded
 * at creation into one row each. It is NOT system-wide: an entry added from the
 * profiles you can see must not flag jobs for people who never agreed to it,
 * and a row owned by nobody is a row anybody could delete.
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
 * "ELLKAY, LLC" and "ELLKAY" stay distinct rather than one silently
 * blacklisting the other.
 */
export function companyKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Company name as stored: trimmed, internal whitespace collapsed. */
const displayName = (name: string) => name.trim().replace(/\s+/g, ' ');

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

/** Profile ids this user owns or has been invited to. */
async function usableProfileIds(userId: number): Promise<number[]> {
  const rows = await prisma.profile.findMany({
    where: usableProfileWhere(userId),
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => r.id);
}

export const blacklistService = {
  /** Entries on the profiles this user can use. `profileId` narrows to one. */
  async list(userId: number, profileId?: number) {
    const usable = await usableProfileIds(userId);
    if (profileId !== undefined && !usable.includes(profileId)) {
      throw new BlacklistError('Profile not found', 404);
    }
    const rows = await prisma.companyBlacklist.findMany({
      where: { profileId: profileId !== undefined ? profileId : { in: usable } },
      select: entrySelect,
      orderBy: [{ company: 'asc' }, { profileId: 'asc' }],
    });
    return rows;
  },

  /**
   * Add a company for specific profiles, or for every profile the user can use.
   *
   * 'all' is expanded HERE rather than stored as a wildcard, so the scope is
   * explicit in the data. The consequence is worth stating: it covers the
   * profiles usable AT THE TIME, so a profile invited later is not retroactively
   * included — which is the honest reading of a decision someone made about the
   * profiles they had.
   *
   * Reports what it added AND what it skipped: adding a company that is already
   * there is a no-op rather than an error, but a silent success on a duplicate
   * would leave the user wondering why the list did not grow.
   */
  async create(userId: number, company: string, scope: 'all' | number[]) {
    const name = displayName(company);
    if (!name) throw new BlacklistError('Company is required', 400);
    const key = companyKey(name);

    const usable = await usableProfileIds(userId);
    if (!usable.length) throw new BlacklistError('You have no profiles to blacklist for', 400);

    let targets: number[];
    if (scope === 'all') {
      targets = usable;
    } else {
      targets = [...new Set(scope)];
      if (!targets.length) throw new BlacklistError('Choose at least one profile', 400);
      for (const id of targets) {
        // A profile they may not use and one that does not exist are the same
        // 404, so the endpoint never confirms which profile ids are real.
        if (!usable.includes(id)) throw new BlacklistError('Profile not found', 404);
      }
    }

    // `skipDuplicates` leans on the (profileId, companyKey) unique index, so a
    // concurrent add cannot slip a second row past a read-then-write check.
    const res = await prisma.companyBlacklist.createMany({
      data: targets.map((profileId) => ({
        company: name,
        companyKey: key,
        profileId,
        createdById: userId,
      })),
      skipDuplicates: true,
    });
    return { added: res.count, skipped: targets.length - res.count, profiles: targets.length };
  },

  /** Rename the company, or move the entry to a different profile. */
  async update(id: number, userId: number, patch: { company?: string; profileId?: number }) {
    const row = await this.assertUsable(id, userId);

    const data: { company?: string; companyKey?: string; profileId?: number } = {};
    if (patch.company !== undefined) {
      const name = displayName(patch.company);
      if (!name) throw new BlacklistError('Company is required', 400);
      data.company = name;
      data.companyKey = companyKey(name);
    }
    if (patch.profileId !== undefined) {
      const usable = await usableProfileIds(userId);
      if (!usable.includes(patch.profileId)) throw new BlacklistError('Profile not found', 404);
      data.profileId = patch.profileId;
    }

    const nextKey = data.companyKey ?? row.companyKey;
    const nextProfile = data.profileId ?? row.profileId;
    const clash = await prisma.companyBlacklist.findFirst({
      where: { companyKey: nextKey, profileId: nextProfile, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw new BlacklistError('That company is already blacklisted for that profile', 409);

    await prisma.companyBlacklist.update({ where: { id }, data });
    return prisma.companyBlacklist.findUnique({ where: { id }, select: entrySelect });
  },

  async remove(id: number, userId: number) {
    await this.assertUsable(id, userId);
    await prisma.companyBlacklist.delete({ where: { id } });
    return { ok: true };
  },

  /**
   * Remove a company from several of the user's profiles at once — what the
   * table's Delete does on a row that stands for one company across profiles.
   */
  async removeCompany(userId: number, key: string, profileIds?: number[]) {
    const usable = await usableProfileIds(userId);
    const targets = profileIds?.length ? profileIds.filter((p) => usable.includes(p)) : usable;
    const res = await prisma.companyBlacklist.deleteMany({
      where: { companyKey: key, profileId: { in: targets } },
    });
    if (!res.count) throw new BlacklistError('Entry not found', 404);
    return { ok: true, removed: res.count };
  },

  /**
   * An entry this user may change: one on a profile they can use.
   *
   * Not restricted to whoever created it — a shared profile is worked by
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
    const usable = await usableProfileIds(userId);
    if (!usable.includes(row.profileId)) throw new BlacklistError('Entry not found', 404);
    return row;
  },

  /**
   * Which of these companies are blacklisted for the profile being viewed as.
   *
   * Takes the page's company names rather than scanning the table: a page is 20
   * rows, so this is one small indexed lookup instead of a join across every
   * job. Returns the set of NORMALISED names, which is what the caller matches
   * its jobs against.
   *
   * With no profile selected nothing is flagged — every entry belongs to a
   * profile now, so there is no list to apply.
   */
  async flagsFor(companies: string[], profileId?: number): Promise<Set<string>> {
    if (!profileId) return new Set();
    const keys = [...new Set(companies.filter(Boolean).map(companyKey))];
    if (!keys.length) return new Set();

    const rows = await prisma.companyBlacklist.findMany({
      where: { companyKey: { in: keys }, profileId },
      select: { companyKey: true },
    });
    return new Set(rows.map((r) => r.companyKey));
  },
};
