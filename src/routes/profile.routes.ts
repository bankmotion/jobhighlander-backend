import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { adminProfileService, profileService } from '../services/profile.service';
import { invitationService, InvitationError } from '../services/invitation.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';
import { logger } from '../services/logger.service';

export const profileRouter = Router();

const requireUser = [requireAuth];

const requireAdmin = [requireAuth, requireRole('admin', 'super_admin')];

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'expected YYYY-MM')
  .nullish();

const workSchema = z.object({
  company: z.string().max(255).nullish(),
  location: z.string().max(255).nullish(),
  startDate: dateStr,
  endDate: dateStr,
});

const yearStr = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'expected YYYY')
  .nullish();

const eduSchema = z.object({
  university: z.string().max(255).nullish(),
  location: z.string().max(255).nullish(),
  degree: z.string().max(255).nullish(),
  startDate: yearStr,
  endDate: yearStr,
  datePrecision: z.enum(['year', 'month']).nullish(),
});

const profileSchema = z.object({
  email: z.string().max(255).nullish(),
  firstName: z.string().max(120).nullish(),
  lastName: z.string().max(120).nullish(),
  phone: z.string().max(60).nullish(),
  linkedin: z.string().max(512).nullish(),
  location: z.string().max(255).nullish(),
  workExperiences: z.array(workSchema).max(50).optional(),
  educations: z.array(eduSchema).max(50).optional(),
});

const requireSuperAdmin = [requireAuth, requireRole('super_admin')];

// The whole register, for oversight and for the AI switch. Placed above the
// '/:id' routes below, or Express would match "all" as a profile id.
profileRouter.get('/all', ...requireSuperAdmin, async (_req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await adminProfileService.list());
  } catch (err) {
    next(err);
  }
});

const aiToggleSchema = z.object({ enabled: z.boolean() });

profileRouter.post('/:id/ai', ...requireSuperAdmin, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const parsed = aiToggleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'enabled must be a boolean' });

    const ok = await adminProfileService.setAiEnabled(id, parsed.data.enabled);
    if (!ok) return res.status(404).json({ error: 'Profile not found' });
    logger.info('Profile AI switch changed', { profileId: id, enabled: parsed.data.enabled, by: req.user!.id });
    res.json({ ok: true, aiEnabled: parsed.data.enabled });
  } catch (err) {
    next(err);
  }
});

profileRouter.get('/', requireUser, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await profileService.list(req.user!.id));
  } catch (err) {
    next(err);
  }
});

profileRouter.post('/', requireAdmin, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid profile', details: parsed.error.flatten() });
    }
    res.json(await profileService.create(req.user!.id, parsed.data));
  } catch (err) {
    next(err);
  }
});

async function refusal(id: number, userId: number, res: Response): Promise<Response> {
  const access = await profileService.accessLevel(id, userId);
  if (access === 'invitee') {
    return res
      .status(403)
      .json({ error: 'You can view this profile, but only its owner can edit it' });
  }
  return res.status(404).json({ error: 'Profile not found' });
}

profileRouter.get('/:id', requireUser, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const profile = await profileService.get(id, req.user!.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

profileRouter.put('/:id', requireAdmin, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const parsed = profileSchema.safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) {
      return res.status(400).json({ error: 'Invalid id or profile' });
    }
    const profile = await profileService.update(id, req.user!.id, parsed.data);
    if (!profile) return await refusal(id, req.user!.id, res);
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

profileRouter.delete('/:id', requireAdmin, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const ok = await profileService.remove(id, req.user!.id);
    if (!ok) return await refusal(id, req.user!.id, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Invitations (owner side) ─────────────────────────────────────────────────
// Answering an invitation lives on /api/invitations instead: it belongs to the
// invitee, who by definition does not own the profile these routes are under.

const idParam = (v: string): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function invitationFailure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof InvitationError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

profileRouter.get(
  '/:id/invitations',
  requireAdmin,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const id = idParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });
    try {
      res.json(await invitationService.listForProfile(id, req.user!.id));
    } catch (err) {
      invitationFailure(err, res, next);
    }
  },
);

profileRouter.post(
  '/:id/invitations',
  requireAdmin,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const id = idParam(req.params.id);
    const parsed = z.object({ email: z.string().trim().email().max(255) }).safeParse(req.body);
    if (id === null || !parsed.success) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }
    try {
      res.json(await invitationService.invite(id, req.user!.id, parsed.data.email));
    } catch (err) {
      invitationFailure(err, res, next);
    }
  },
);

profileRouter.delete(
  '/:id/invitations/:userId',
  requireAdmin,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const id = idParam(req.params.id);
    const userId = idParam(req.params.userId);
    if (id === null || userId === null) return res.status(400).json({ error: 'Invalid id' });
    try {
      const ok = await invitationService.revoke(id, req.user!.id, userId);
      if (!ok) return res.status(404).json({ error: 'Invitation not found' });
      res.json({ ok: true });
    } catch (err) {
      invitationFailure(err, res, next);
    }
  },
);
