import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { jobService } from '../services/job.service';
import { prisma } from '../lib/prisma';
import { usableProfileWhere } from '../services/profile.service';
import type { AuthedRequest } from '../middleware/auth.middleware';

export const jobRouter = Router();

const listQuerySchema = z.object({
  // `site` may repeat (?site=indeed&site=glassdoor) → array, or be a single value.
  site: z
    .preprocess(
      (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
      z.array(z.string().trim().min(1)),
    )
    .optional(),
  location: z.string().trim().min(1).optional(),
  // '1'/'true' → remote-only. Absent → no remote filter.
  remote: z.string().optional(),
  q: z.string().trim().min(1).optional(),
  applied: z.enum(['all', 'applied', 'unapplied']).default('all'),
  discarded: z.enum(['all', 'discarded', 'undiscarded']).default('all'),
  profileId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

jobRouter.get('/', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }
    const { site, remote, profileId, ...rest } = parsed.data;
    // The profile is only honoured if the caller may actually use it, so a
    // guessed id cannot reveal which jobs someone else has applied to.
    const usable =
      profileId !== undefined &&
      (await prisma.profile.findFirst({
        where: { id: profileId, ...usableProfileWhere(req.user!.id) },
        select: { id: true },
      }));
    const result = await jobService.list({
      ...rest,
      sites: site,
      remote: remote === '1' || remote === 'true',
      profileId: usable ? profileId : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

jobRouter.get('/filters', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await jobService.filters());
  } catch (err) {
    next(err);
  }
});

jobRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const job = await jobService.getById(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    next(err);
  }
});
