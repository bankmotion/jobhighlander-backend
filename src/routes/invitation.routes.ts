import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { invitationService } from '../services/invitation.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const invitationRouter = Router();

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

invitationRouter.get('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    res.json(await invitationService.listForUser(req.user!.id, parsed.data.status));
  } catch (err) {
    next(err);
  }
});

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
