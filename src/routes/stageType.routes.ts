import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { stageTypeService } from '../services/stageType.service';
import { requireAuth, requireRole } from '../middleware/auth.middleware';

export const stageTypeRouter = Router();

const requireSuperAdmin = [requireAuth, requireRole('super_admin')];

const body = z.object({
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a 6-digit hex like #6c5cff')
    .optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  archived: z.boolean().optional(),
});

stageTypeRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeArchived = req.query.includeArchived === '1';
    const types = await stageTypeService.list({ includeArchived });
    if (!includeArchived) return res.json(types);
    // The admin screen shows usage beside Delete, so the label can say whether
    // the button will delete the row or only retire it.
    const usage = await stageTypeService.usageCounts();
    res.json(types.map((t) => ({ ...t, usage: usage[t.id] ?? 0 })));
  } catch (err) {
    next(err);
  }
});

stageTypeRouter.post('/', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    }
    const type = await stageTypeService.create(parsed.data);
    if (!type) return res.status(409).json({ error: 'Could not create that stage' });
    res.json(type);
  } catch (err) {
    next(err);
  }
});

stageTypeRouter.put('/:id', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const parsed = body.partial().safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? 'Invalid id' : parsed.error.issues[0]?.message });
    }
    const type = await stageTypeService.update(id, parsed.data);
    if (!type) return res.status(404).json({ error: 'Stage not found' });
    res.json(type);
  } catch (err) {
    next(err);
  }
});

stageTypeRouter.delete('/:id', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const out = await stageTypeService.remove(id);
    if (!out.ok) return res.status(404).json({ error: 'Stage not found' });
    res.json({ ok: true, deleted: out.deleted });
  } catch (err) {
    next(err);
  }
});

stageTypeRouter.post('/seed', requireSuperAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const added = await stageTypeService.seed();
    res.json({ ok: true, added });
  } catch (err) {
    next(err);
  }
});
