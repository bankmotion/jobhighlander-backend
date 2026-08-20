import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { applicationService, ApplicationError } from '../services/application.service';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

export const applicationRouter = Router();

/**
 * "Applied" markers, keyed by (profile, job).
 *
 * Open to every signed-in role: the service scopes each call to profiles the
 * caller may use, so a bidder can mark against a profile shared with them —
 * which is the point, since bidders are who does the applying.
 */

const pairing = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
});

/** Map an ApplicationError onto its status; anything else is a real 500. */
function failure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ApplicationError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

/** POST /api/applications — mark a job as applied. Idempotent. */
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

/** DELETE /api/applications?jobId=&profileId= — undo a mark. */
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

/**
 * The list page asks about a whole page of jobs at once. Bounded at 100 to
 * match the `pageSize` ceiling on GET /api/jobs — without a cap this is an
 * unbounded `IN (...)` driven straight from the query string.
 */
const statusQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  jobIds: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.split(',').map((v) => Number(v.trim())))
    .pipe(z.array(z.number().int().positive()).min(1).max(100)),
});

/** GET /api/applications/status?profileId=&jobIds=1,2,3 — keyed by job id. */
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
