import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { discardService, DiscardError } from '../services/discard.service';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

export const discardRouter = Router();

const pairing = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
});

function failure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof DiscardError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

discardRouter.post('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = pairing.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const { jobId, profileId } = parsed.data;
    res.json(await discardService.mark(jobId, profileId, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

discardRouter.delete('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = pairing.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { jobId, profileId } = parsed.data;
    const removed = await discardService.unmark(jobId, profileId, req.user!.id);
    // Not-discarded is reported rather than 404'd: the caller asked for "not
    // discarded" and that is now true, which is a success by any useful reading.
    res.json({ ok: true, removed });
  } catch (err) {
    failure(err, res, next);
  }
});

const statusQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  jobIds: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.split(',').map((v) => Number(v.trim())))
    .pipe(z.array(z.number().int().positive()).min(1).max(100)),
});

discardRouter.get(
  '/company-history',
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = statusQuery.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
      const { profileId, jobIds } = parsed.data;
      res.json(await discardService.companyHistoryFor(jobIds, profileId, req.user!.id));
    } catch (err) {
      failure(err, res, next);
    }
  },
);

discardRouter.get(
  '/status',
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = statusQuery.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
      const { profileId, jobIds } = parsed.data;
      res.json(await discardService.statusFor(jobIds, profileId, req.user!.id));
    } catch (err) {
      failure(err, res, next);
    }
  },
);
