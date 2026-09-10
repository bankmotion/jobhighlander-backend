import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { rejectionService, RejectionError } from '../services/rejection.service';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

export const rejectionRouter = Router();

const pairing = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
});

function failure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof RejectionError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

rejectionRouter.post('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = pairing
      // Required, and bounded. The reason is the point of the record — see the
      // `JobRejection` model — so an empty one is a bad request, not an
      // acceptable default.
      .extend({ note: z.string().trim().min(1).max(2000) })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A job, a profile and a reason are required' });
    }
    const { jobId, profileId, note } = parsed.data;
    res.json(await rejectionService.mark(jobId, profileId, req.user!.id, note));
  } catch (err) {
    failure(err, res, next);
  }
});

rejectionRouter.delete('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = pairing.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { jobId, profileId } = parsed.data;
    const removed = await rejectionService.unmark(jobId, profileId, req.user!.id);
    // Not-rejected is reported rather than 404'd: the caller asked for "not
    // rejected" and that is now true, which is a success by any useful reading.
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

rejectionRouter.get('/status', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = statusQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { profileId, jobIds } = parsed.data;
    res.json(await rejectionService.statusFor(jobIds, profileId, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});
