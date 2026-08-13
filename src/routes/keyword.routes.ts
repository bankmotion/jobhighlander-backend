import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { keywordService } from '../services/keyword.service';
import { requireAuth, requireRole } from '../middleware/auth.middleware';

export const keywordRouter = Router();

const wordSchema = z.object({ word: z.string().trim().min(1).max(128) });
const requireSuperAdmin = [requireAuth, requireRole('super_admin')];

/** GET /api/keywords — any signed-in user (needed to highlight descriptions). */
keywordRouter.get('/', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await keywordService.list());
  } catch (err) {
    next(err);
  }
});

/** POST /api/keywords — add a word (admin). */
keywordRouter.post('/', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = wordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'A word is required' });
    const kw = await keywordService.create(parsed.data.word);
    if (!kw) return res.status(409).json({ error: 'That word already exists' });
    res.json(kw);
  } catch (err) {
    next(err);
  }
});

/** PUT /api/keywords/:id — rename a word (admin). */
keywordRouter.put('/:id', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const parsed = wordSchema.safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: 'Invalid id or word' });
    const kw = await keywordService.update(id, parsed.data.word);
    if (!kw) return res.status(409).json({ error: 'That word already exists or was not found' });
    res.json(kw);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/keywords/:id — remove a word (admin). */
keywordRouter.delete('/:id', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    await keywordService.remove(id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
