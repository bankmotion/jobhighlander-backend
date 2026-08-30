import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { applicationService, ApplicationError } from '../services/application.service';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

export const applicationRouter = Router();

const pairing = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
});

function failure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ApplicationError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

applicationRouter.post('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = pairing.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const { jobId, profileId } = parsed.data;
    res.json(await applicationService.mark(jobId, profileId, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

applicationRouter.delete('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = pairing.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { jobId, profileId } = parsed.data;
    const ok = await applicationService.unmark(jobId, profileId, req.user!.id);
    // Not-marked is reported rather than 404'd: the caller asked for "not
    // applied" and that is now true, which is a success by any useful reading.
    res.json({ ok: true, removed: ok });
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

applicationRouter.get(
  '/for-job',
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = z
        .object({ jobId: z.coerce.number().int().positive() })
        .safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
      res.json(await applicationService.forJob(parsed.data.jobId, req.user!.id));
    } catch (err) {
      failure(err, res, next);
    }
  },
);

applicationRouter.get(
  '/company-history',
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = statusQuery.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
      const { profileId, jobIds } = parsed.data;
      res.json(await applicationService.companyHistoryFor(jobIds, profileId, req.user!.id));
    } catch (err) {
      failure(err, res, next);
    }
  },
);

applicationRouter.get(
  '/status',
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = statusQuery.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
      const { profileId, jobIds } = parsed.data;
      res.json(await applicationService.statusFor(jobIds, profileId, req.user!.id));
    } catch (err) {
      failure(err, res, next);
    }
  },
);
