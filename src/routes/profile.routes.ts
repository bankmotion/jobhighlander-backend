import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { profileService } from '../services/profile.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const profileRouter = Router();

// Admins (and super admins) manage their OWN profiles.
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

/** GET /api/profiles — the current admin's profiles (summary). */
profileRouter.get('/', requireAdmin, async (req: AuthedRequest, res: Response, next: NextFunction) => {
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

/** GET /api/profiles/:id — one profile with work experience + education. */
profileRouter.get('/:id', requireAdmin, async (req: AuthedRequest, res: Response, next: NextFunction) => {
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
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
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
    if (!ok) return res.status(404).json({ error: 'Profile not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
