import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { DuplicateJobError, jobService } from '../services/job.service';
import { prisma } from '../lib/prisma';
import { usableProfileWhere } from '../services/profile.service';
import type { AuthedRequest } from '../middleware/auth.middleware';

export const jobRouter = Router();

const newerQuerySchema = z.object({
  afterId: z.coerce.number().int().nonnegative(),
});

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
  company: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(200).optional(),
  applied: z.enum(['all', 'applied', 'unapplied']).default('all'),
  discarded: z.enum(['all', 'discarded', 'undiscarded']).default('all'),
  interview: z.enum(['all', 'started', 'notstarted']).default('all'),
  profileId: z.coerce.number().int().positive().optional(),
  // When the JOB was posted, as opposed to when we scraped it. 'today' and
  // '3d' are calendar windows in the viewer's zone, not rolling hours — they
  // sit beside a date picker, so they have to mean the same kind of thing.
  posted: z.enum(['all', 'today', '3d', 'custom']).default('all'),
  postedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  postedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tz: z.string().trim().max(64).optional(),
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


/**
 * Add a job by hand.
 *
 * Open to any signed-in user, not just admins: the person who found a posting
 * elsewhere is the one who needs it on the list, and the row lands in the same
 * shared table everyone already reads.
 *
 * Registered before '/:id' — Express matches in order, and this is a POST to
 * the collection so the two cannot collide, but keeping list routes together
 * is what stops the next one from being added in the wrong place.
 */
const manualJobSchema = z.object({
  title: z.string().trim().min(2).max(512),
  company: z.string().trim().max(255).optional(),
  // Long, because this is the text the AI writes the resume against. A one-line
  // placeholder produces a one-line-quality resume.
  description: z.string().trim().min(20).max(60_000),
  jobUrl: z.string().trim().url().max(1024).optional().or(z.literal('')),
  applyUrl: z.string().trim().url().max(2048).optional().or(z.literal('')),
  location: z.string().trim().max(255).optional(),
  jobType: z.string().trim().max(64).optional(),
  salary: z.string().trim().max(255).optional(),
  remote: z.boolean().optional(),
  postedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  tz: z.string().trim().max(64).optional(),
});

jobRouter.post('/', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = manualJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid job', details: parsed.error.flatten() });
    }
    const { jobUrl, applyUrl, postedOn, ...rest } = parsed.data;
    const job = await jobService.addManual(req.user!.id, {
      ...rest,
      // The schema allows '' so an empty input is not a validation error; the
      // service wants absence, not an empty string.
      jobUrl: jobUrl || null,
      applyUrl: applyUrl || null,
      postedOn: postedOn || null,
    });
    res.status(201).json(job);
  } catch (err) {
    if (err instanceof DuplicateJobError) {
      // 409 with the id, so the client can offer to open the job that already
      // exists rather than just refusing.
      return res.status(409).json({ error: 'That job is already on the list', jobId: err.jobId });
    }
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

// Ahead of '/:id' deliberately: Express matches in order, and "new-count"
// would otherwise be read as a job id.
jobRouter.get('/new-count', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    const after = newerQuerySchema.safeParse(req.query);
    if (!parsed.success || !after.success) {
      return res.status(400).json({ error: 'Invalid query' });
    }
    const { site, remote, profileId, ...rest } = parsed.data;
    const usable =
      profileId !== undefined &&
      (await prisma.profile.findFirst({
        where: { id: profileId, ...usableProfileWhere(req.user!.id) },
        select: { id: true },
      }));
    const count = await jobService.newerCount({
      ...rest,
      sites: site,
      remote: remote === '1' || remote === 'true',
      profileId: usable ? profileId : undefined,
      afterId: after.data.afterId,
    });
    res.json({ count });
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
