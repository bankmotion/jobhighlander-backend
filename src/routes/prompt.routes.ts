import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { promptService, isPromptKey } from '../services/prompt.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const promptRouter = Router();

/**
 * Model instructions, editable by super admins only.
 *
 * Deliberately NOT open to admins. A prompt decides what every generated
 * document says on every profile in the app, including profiles its editor was
 * only invited to — that is a wider blast radius than anything else an admin
 * touches, and it belongs with the roles that already own scraper config.
 */
const superAdminOnly = [requireAuth, requireRole('super_admin')];

/** GET /api/prompts — every editable prompt, stored value or shipped default. */
promptRouter.get('/', superAdminOnly, async (_req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await promptService.list());
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/prompts/:key — save an edit.
 *
 * An empty body resets to the shipped default by deleting the row, rather than
 * storing a copy of it: a stored copy would silently stop tracking later
 * changes to the shipped text.
 */
promptRouter.put('/:key', superAdminOnly, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const key = req.params.key;
    if (!isPromptKey(key)) return res.status(404).json({ error: 'Unknown prompt' });
    const parsed = z.object({ content: z.string().max(40_000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid content' });
    res.json(await promptService.save(key, parsed.data.content, req.user!.id));
  } catch (err) {
    next(err);
  }
});
