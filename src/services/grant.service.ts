import type { JobSite } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Everything a super admin can grant a profile.
 *
 * The registry is the source of truth: the approvals screen renders a column
 * per entry, the API validates against it, and an unknown key is rejected
 * rather than stored — a grant that silently does nothing is worse than an
 * error, because it looks approved.
 *
 * To add a gated feature: add an entry, read it with `has()` at the point it
 * takes effect. No migration, no new table, no new endpoint.
 */
export interface FeatureDef {
  key: string;
  label: string;
  /** Shown under the column head, so the admin knows what they are granting. */
  description: string;
  /** Present for a job source, and the enum value it gates. */
  site?: JobSite;
}

export const FEATURES: readonly FeatureDef[] = [
  {
    key: 'site:remoterocketship',
    label: 'Remote Rocketship',
    description:
      'A paid subscription. Its postings are hidden from unapproved profiles everywhere — the list, the new-jobs count, and by direct link.',
    site: 'remoterocketship',
  },
  {
    key: 'applied_count',
    label: 'Applied-by count',
    description:
      'The "N profiles applied" badge and its filter. Counts across the whole board, including profiles this reader cannot otherwise see. Applies to everyone — a super admin needs the grant too.',
  },
] as const;

const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));

export const isFeature = (key: string): boolean => BY_KEY.has(key);

/** Gated job sources, derived from the registry rather than listed twice. */
export const GATED_SITES: readonly JobSite[] = FEATURES.filter((f) => f.site).map(
  (f) => f.site as JobSite,
);

export const siteFeatureKey = (site: string): string => `site:${site}`;

export const grantService = {
  /** Every feature this profile holds. Empty for a profile with none. */
  async featuresFor(profileId: number | undefined): Promise<Set<string>> {
    if (!profileId) return new Set();
    const rows = await prisma.profileGrant.findMany({
      where: { profileId },
      select: { feature: true },
    });
    return new Set(rows.map((r) => r.feature));
  },

  async has(profileId: number | undefined, feature: string): Promise<boolean> {
    if (!profileId) return false;
    const row = await prisma.profileGrant.findUnique({
      where: { profileId_feature: { profileId, feature } },
      select: { id: true },
    });
    return row !== null;
  },

  /**
   * The `where` fragment hiding gated sources this profile may not read.
   *
   * Derived from the registry, so a source added there is hidden everywhere
   * this fragment is used with no second edit to forget. Returns `{}` when
   * nothing is hidden, costing nothing on the common path.
   */
  async hiddenSitesWhere(profileId: number | undefined) {
    const held = await this.featuresFor(profileId);
    const hidden = GATED_SITES.filter((site) => !held.has(siteFeatureKey(site)));
    return hidden.length ? { site: { notIn: hidden } } : {};
  },

  async list() {
    const rows = await prisma.profileGrant.findMany({
      select: {
        profileId: true,
        feature: true,
        createdAt: true,
        grantedBy: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      profileId: r.profileId,
      feature: r.feature,
      createdAt: r.createdAt,
      grantedBy: r.grantedBy.email,
    }));
  },

  /** Grant. Idempotent — granting twice is not two grants. */
  async grant(profileId: number, feature: string, grantedById: number): Promise<void> {
    await prisma.profileGrant.upsert({
      where: { profileId_feature: { profileId, feature } },
      // Already granted; re-recording who did it would rewrite the audit trail
      // with whoever clicked last.
      update: {},
      create: { profileId, feature, grantedById },
    });
  },

  /** Revoke. Silent when there was nothing to revoke — the end state is the same. */
  async revoke(profileId: number, feature: string): Promise<void> {
    await prisma.profileGrant.deleteMany({ where: { profileId, feature } });
  },
};
