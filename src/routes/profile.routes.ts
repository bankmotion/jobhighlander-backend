import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { profileService } from '../services/profile.service';
import { invitationService, InvitationError } from '../services/invitation.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const profileRouter = Router();

/**
 * Reading a profile is open to every signed-in role — a bidder needs the
 * profiles they were invited to in order to generate resumes. The service
 * scopes each read to "owned or accepted invitation", so an open route is not
 * an open table.
 */
const requireUser = [requireAuth];

/** Creating and editing profiles stays with admins, and only their own. */
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

const eduSchema = z.object({
  university: z.string().max(255).nullish(),
  location: z.string().max(255).nullish(),
  degree: z.string().max(255).nullish(),
  startDate: dateStr,
  endDate: dateStr,
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

/** GET /api/profiles — profiles the caller may use (owned + accepted invites). */
profileRouter.get('/', requireUser, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await profileService.list(req.user!.id));
  } catch (err) {
    next(err);
  }
});

/** POST /api/profiles — create a profile. */
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

/**
 * Why a write was refused: 403 for a profile the caller can see but does not
 * own, 404 for one they cannot see at all.
 *
 * The 404 half is the important one — it is what stops the endpoint confirming
 * that a profile id exists to someone with no access to it. The 403 half leaks
 * nothing extra, since the caller can already GET that same profile, and it is
 * the only thing that explains an invitee's save doing nothing.
 */
async function refusal(id: number, userId: number, res: Response): Promise<Response> {
  const access = await profileService.accessLevel(id, userId);
  if (access === 'invitee') {
    return res
      .status(403)
      .json({ error: 'You can view this profile, but only its owner can edit it' });
  }
  return res.status(404).json({ error: 'Profile not found' });
}

/**
 * GET /api/profiles/:id — one profile with work experience + education.
 *
 * Carries `canEdit` so the client can render the read-only view for an invitee
 * without a second request (the PUT is refused regardless).
 */
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

/** PUT /api/profiles/:id — update a profile (replaces nested entries). */
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

/** DELETE /api/profiles/:id — remove a profile. */
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

/** Map an InvitationError onto its status; anything else is a real 500. */
function invitationFailure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof InvitationError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

/** GET /api/profiles/:id/invitations — who this profile is shared with. */
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

/**
 * POST /api/profiles/:id/invitations — invite a user to use this profile.
 *
 * Addressed by email: no endpoint lists accounts to an admin, so inviting
 * cannot double as a way to read the user table.
 */
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

/** DELETE /api/profiles/:id/invitations/:userId — withdraw it / revoke access. */
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
