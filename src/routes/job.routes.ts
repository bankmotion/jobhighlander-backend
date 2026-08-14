import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { jobService } from '../services/job.service';

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
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

/** GET /api/jobs — paginated, filterable list. */
jobRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }
    const { site, remote, ...rest } = parsed.data;
    const result = await jobService.list({
      ...rest,
      sites: site,
      remote: remote === '1' || remote === 'true',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** GET /api/jobs/filters — distinct sites & locations for UI dropdowns. */
jobRouter.get('/filters', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await jobService.filters());
  } catch (err) {
    next(err);
  }
});

/** GET /api/jobs/:id — single job. */
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
