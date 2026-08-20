import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { invitationService } from '../services/invitation.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const invitationRouter = Router();

/**
 * The invitee's half of the invitation flow, plus the owner's overview.
 *
 * Sending and withdrawing invitations lives under /api/profiles/:id/invitations,
 * because those act on a profile the caller owns. Everything here acts on
 * invitations addressed TO the caller, which is why it is open to every role.
 */

/**
 * GET /api/invitations/sent — the caller's profiles with who each is shared
 * with. Backs the bidder-management page; admins only, since only they own
 * profiles.
 */
invitationRouter.get(
  '/sent',
  requireAuth,
  requireRole('admin', 'super_admin'),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await invitationService.listByOwner(req.user!.id));
    } catch (err) {
      next(err);
    }
  },
);

const listQuery = z.object({ status: z.enum(['pending', 'accepted', 'declined']).optional() });

/** GET /api/invitations?status= — invitations addressed to the caller. */
invitationRouter.get('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    res.json(await invitationService.listForUser(req.user!.id, parsed.data.status));
  } catch (err) {
    next(err);
  }
});

/** GET /api/invitations/pending-count — for the nav badge. */
invitationRouter.get(
  '/pending-count',
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.json({ count: await invitationService.pendingCount(req.user!.id) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/invitations/:id/respond — accept or decline.
 *
 * Accepting is what actually grants access; until then the invitation shows on
 * the invitee's page but the profile itself stays out of every scoped query.
 */
invitationRouter.post(
  '/:id/respond',
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const parsed = z.object({ status: z.enum(['accepted', 'declined']) }).safeParse(req.body);
      if (!Number.isInteger(id) || !parsed.success) {
        return res.status(400).json({ error: 'Invalid id or status' });
      }
      const ok = await invitationService.respond(id, req.user!.id, parsed.data.status);
      // Wrong id and someone else's invitation are the same 404 — the scoped
      // update cannot tell them apart, and neither should the response.
      if (!ok) return res.status(404).json({ error: 'Invitation not found' });
      res.json({ ok: true, status: parsed.data.status });
    } catch (err) {
      next(err);
    }
  },
);
