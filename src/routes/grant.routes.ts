import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { FEATURES, grantService, isFeature } from '../services/grant.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const grantRouter = Router();

/**
 * What each profile is approved for.
 *
 * Super admin only, to read and to change. The things behind these grants are a
 * paid subscription and other people's activity — an admin who can create
 * bidder accounts is not thereby authorised to spend a seat or widen who sees
 * whose applications.
 */
grantRouter.get('/', requireAuth, requireRole('super_admin'), async (_req, res, next) => {
  try {
    // Every profile, not only the granted ones: "who could have this and does
    // not" is asked as often as the reverse, and a list of grants cannot answer it.
    const [profiles, grants] = await Promise.all([
      prisma.profile.findMany({
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          owner: { select: { email: true } },
        },
        orderBy: { id: 'asc' },
      }),
      grantService.list(),
    ]);

    const byProfile = new Map<number, { feature: string; grantedBy: string; createdAt: Date }[]>();
    for (const g of grants) {
      const list = byProfile.get(g.profileId) ?? [];
      list.push({ feature: g.feature, grantedBy: g.grantedBy, createdAt: g.createdAt });
      byProfile.set(g.profileId, list);
    }

    res.json({
      features: FEATURES,
      profiles: profiles.map((p) => ({
        id: p.id,
        name: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || `Profile ${p.id}`,
        email: p.email,
        owner: p.owner.email,
        granted: byProfile.get(p.id) ?? [],
      })),
    });
  } catch (err) {
    next(err);
  }
});

grantRouter.post(
  '/',
  requireAuth,
  requireRole('super_admin'),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = z
        .object({
          profileId: z.coerce.number().int().positive(),
          // Checked against the registry, never stored as free text: an unknown
          // key would be a grant that silently does nothing while looking approved.
          feature: z.string().max(64).refine(isFeature, 'Unknown feature'),
          // The desired end state, not a flip — safe to retry, where a toggle
          // would undo itself on a double submit.
          granted: z.boolean(),
        })
        .safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });

      const { profileId, feature, granted } = parsed.data;
      const profile = await prisma.profile.findUnique({
        where: { id: profileId },
        select: { id: true },
      });
      if (!profile) return res.status(404).json({ error: 'Profile not found' });

      if (granted) await grantService.grant(profileId, feature, req.user!.id);
      else await grantService.revoke(profileId, feature);

      res.json({ ok: true, profileId, feature, granted });
    } catch (err) {
      next(err);
    }
  },
);
