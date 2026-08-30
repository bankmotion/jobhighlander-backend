import { Router, type Response, type NextFunction } from 'express';
import { coverLetterService, CoverLetterError } from '../services/coverLetter.service';
import { generationService } from '../services/generation.service';
import { aiEnabled } from '../lib/anthropic';
import {
  coverLetterRequestSchema,
  coverLetterUpdateSchema,
} from '../schemas/coverLetter.schema';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';
import { z } from 'zod';

export const coverLetterRouter = Router();


function failure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof CoverLetterError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

const pairing = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
});

const statusQuery = z.object({
  profileId: z.coerce.number().int().positive(),
  jobIds: z
    .string()
    .trim()
    .min(1)
    .transform((v) => v.split(",").map((x) => Number(x.trim())))
    .pipe(z.array(z.number().int().positive()).min(1).max(100)),
});

coverLetterRouter.get(
  '/status',
  requireAuth,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = statusQuery.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
      const { profileId, jobIds } = parsed.data;
      res.json(await coverLetterService.statusFor(jobIds, profileId, req.user!.id));
    } catch (err) {
      failure(err, res, next);
    }
  },
);

coverLetterRouter.get('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = pairing.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { jobId, profileId } = parsed.data;
    res.json(await coverLetterService.saved(jobId, profileId, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

coverLetterRouter.post('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (!aiEnabled()) {
      return res.status(503).json({ error: 'AI is not configured on this server' });
    }
    const parsed = coverLetterRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    // Both documents come from one model call, so asking for a letter
    // regenerates the resume with it. That is the cost of a single prompt
    // governing both; the alternative was two calls that disagreed.
    const { coverLetter } = await generationService.generate(parsed.data, req.user!.id);
    res.json(coverLetter);
  } catch (err) {
    failure(err, res, next);
  }
});

coverLetterRouter.put('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = coverLetterUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const { jobId, profileId, body } = parsed.data;
    res.json(await coverLetterService.update(jobId, profileId, req.user!.id, body));
  } catch (err) {
    failure(err, res, next);
  }
});
