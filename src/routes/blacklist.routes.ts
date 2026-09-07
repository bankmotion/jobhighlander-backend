import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { blacklistService, BlacklistError } from '../services/blacklist.service';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

/**
 * Company blacklist — every signed-in user, not just admins.
 *
 * It is the bidders' own list: they are the ones who learn an employer is not
 * worth bidding, and routing that through an admin would mean the knowledge
 * sits with whoever cannot act on it.
 */
export const blacklistRouter = Router();

function failure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof BlacklistError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

const listQuery = z.object({
  profileId: z.coerce.number().int().positive().optional(),
});

/**
 * `scope` is either the literal 'all' or a list of profile ids, mirroring the
 * picker. 'all' means every profile the CALLER can use — owned plus shared —
 * and the service expands it into one row each; it is not a system-wide rule.
 */
const scopeSchema = z.union([z.literal('all'), z.array(z.coerce.number().int().positive()).min(1)]);

const createBody = z.object({
  company: z.string().trim().min(1).max(255),
  scope: scopeSchema,
});

const updateBody = z
  .object({
    company: z.string().trim().min(1).max(255).optional(),
    // Moves the entry to that profile. Absent leaves it where it is.
    profileId: z.coerce.number().int().positive().optional(),
  })
  .refine((b) => b.company !== undefined || b.profileId !== undefined, {
    message: 'Nothing to update',
  });

blacklistRouter.get('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    res.json({ items: await blacklistService.list(req.user!.id, parsed.data.profileId) });
  } catch (err) {
    failure(err, res, next);
  }
});

blacklistRouter.post('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const { company, scope } = parsed.data;
    res.json(await blacklistService.create(req.user!.id, company, scope));
  } catch (err) {
    failure(err, res, next);
  }
});

blacklistRouter.patch('/:id', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    res.json(await blacklistService.update(id, req.user!.id, parsed.data));
  } catch (err) {
    failure(err, res, next);
  }
});

blacklistRouter.delete('/:id', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    res.json(await blacklistService.remove(id, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});
