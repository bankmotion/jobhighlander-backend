import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  interviewService,
  InterviewError,
  type PanelInput,
} from '../services/interview.service';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

export const interviewRouter = Router();

/**
 * Interview timelines, keyed by (profile, job).
 *
 * Open to every signed-in role, like `applicationRouter`: the service scopes
 * each call to profiles the caller may use, and bidders are who actually sit
 * the interviews.
 */

/** Map an InterviewError onto its status; anything else is a real 500. */
function failure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof InterviewError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

const idParam = z.coerce.number().int().positive();

/**
 * A real IANA zone name.
 *
 * Checked here rather than trusted, because the value is fed straight to
 * `Intl.DateTimeFormat({ timeZone })` in the browser, which THROWS on an
 * unknown zone. An unvalidated string would therefore not render a wrong time —
 * it would crash the card that displays it.
 */
const timezone = z
  .string()
  .trim()
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Unknown time zone' },
  );

/**
 * An http(s) URL, and nothing else.
 *
 * The panel card renders this as an `href`. Without the protocol check a
 * `javascript:` value stored here would execute in the reader's session on
 * click — and on a SHARED profile the reader is a colleague, not the person who
 * typed it. `z.string().url()` alone accepts `javascript:` quite happily.
 */
const meetingUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v), { message: 'Link must start with http:// or https://' });

const panelBody = z.object({
  title: z.string().trim().max(255).nullable().optional(),
  note: z.string().max(20_000).nullable().optional(),
  meetingUrl: meetingUrl.nullable().optional(),
  /** ISO-8601 with an offset; the service stores the instant as UTC. */
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: timezone.nullable().optional(),
  durationMin: z.number().int().min(0).max(1440).nullable().optional(),
});

/**
 * Copy only the keys the caller actually sent.
 *
 * Absent means "leave alone" and null means "clear", and every panel field is
 * optional — so collapsing the two would make it impossible to edit one field
 * without wiping the rest.
 */
function toPanelInput(b: z.infer<typeof panelBody>): PanelInput {
  const out: PanelInput = {};
  if (b.title !== undefined) out.title = b.title;
  if (b.note !== undefined) out.note = b.note;
  if (b.meetingUrl !== undefined) out.meetingUrl = b.meetingUrl;
  if (b.timezone !== undefined) out.timezone = b.timezone;
  if (b.durationMin !== undefined) out.durationMin = b.durationMin;
  if (b.scheduledAt !== undefined) {
    out.scheduledAt = b.scheduledAt === null ? null : new Date(b.scheduledAt);
  }
  return out;
}

/* ─── the process ──────────────────────────────────────────────────────── */

/** POST /api/interviews — open a timeline for an applied job. Idempotent. */
interviewRouter.post('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({ jobId: idParam, profileId: idParam })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const { jobId, profileId } = parsed.data;
    res.json(await interviewService.open(jobId, profileId, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/** GET /api/interviews?profileId= — every timeline the caller can reach. */
interviewRouter.get('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ profileId: idParam.optional() }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    res.json(await interviewService.list(req.user!.id, parsed.data.profileId));
  } catch (err) {
    failure(err, res, next);
  }
});

/**
 * GET /api/interviews/upcoming?days= — the cross-process agenda.
 *
 * Registered before `/:id`, or Express matches "upcoming" as an id. Same for
 * the two below.
 */
interviewRouter.get('/upcoming', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({ days: z.coerce.number().int().min(1).max(90).default(7) })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    res.json(await interviewService.upcoming(req.user!.id, parsed.data.days));
  } catch (err) {
    failure(err, res, next);
  }
});

/**
 * GET /api/interviews/status?profileId=&jobIds=1,2,3 — keyed by job id.
 *
 * Bounded at 100 to match the `pageSize` ceiling on GET /api/jobs; without a
 * cap this is an unbounded `IN (...)` driven from the query string.
 */
interviewRouter.get('/status', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({
        profileId: idParam,
        jobIds: z
          .string()
          .trim()
          .min(1)
          .transform((s) => s.split(',').map((v) => Number(v.trim())))
          .pipe(z.array(z.number().int().positive()).min(1).max(100)),
      })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { profileId, jobIds } = parsed.data;
    res.json(await interviewService.statusFor(jobIds, profileId, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/** GET /api/interviews/for-job?jobId=&profileId= — the timeline, or null. */
interviewRouter.get('/for-job', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ jobId: idParam, profileId: idParam }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { jobId, profileId } = parsed.data;
    res.json(await interviewService.forJob(jobId, profileId, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/* ─── steps and panels ─────────────────────────────────────────────────── */
/* Two-segment paths, so they cannot collide with `/:id` above.            */

const stepBody = z.object({
  position: z.number().int().min(0).optional(),
  title: z.string().trim().max(255).nullable().optional(),
  stageTypeIds: z.array(z.number().int().positive()).max(8).optional(),
});

/** POST /api/interviews/:id/steps — insert a step at `position`. */
interviewRouter.post('/:id/steps', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const id = idParam.safeParse(req.params.id);
    const parsed = stepBody.safeParse(req.body ?? {});
    if (!id.success || !parsed.success) return res.status(400).json({ error: 'Invalid request' });
    res.json(await interviewService.addStep(id.data, parsed.data, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/** PATCH /api/interviews/steps/:stepId — title, result and/or badge set. */
interviewRouter.patch('/steps/:stepId', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const stepId = idParam.safeParse(req.params.stepId);
    const parsed = stepBody
      .omit({ position: true })
      .extend({ result: z.enum(['pending', 'passed', 'failed', 'cancelled']).optional() })
      .safeParse(req.body ?? {});
    if (!stepId.success || !parsed.success) return res.status(400).json({ error: 'Invalid request' });
    res.json(await interviewService.updateStep(stepId.data, parsed.data, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/** DELETE /api/interviews/steps/:stepId — removes its panels with it. */
interviewRouter.delete('/steps/:stepId', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const stepId = idParam.safeParse(req.params.stepId);
    if (!stepId.success) return res.status(400).json({ error: 'Invalid id' });
    res.json(await interviewService.removeStep(stepId.data, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/** POST /api/interviews/steps/:stepId/panels — insert a panel at `position`. */
interviewRouter.post('/steps/:stepId/panels', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const stepId = idParam.safeParse(req.params.stepId);
    const parsed = panelBody
      .extend({ position: z.number().int().min(0).optional() })
      .safeParse(req.body ?? {});
    if (!stepId.success || !parsed.success) {
      return res.status(400).json({ error: firstIssue(parsed) ?? 'Invalid request' });
    }
    const { position, ...fields } = parsed.data;
    res.json(
      await interviewService.addPanel(
        stepId.data,
        { position, ...toPanelInput(fields) },
        req.user!.id,
      ),
    );
  } catch (err) {
    failure(err, res, next);
  }
});

/** PATCH /api/interviews/panels/:panelId — absent key = leave, null = clear. */
interviewRouter.patch('/panels/:panelId', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const panelId = idParam.safeParse(req.params.panelId);
    const parsed = panelBody.safeParse(req.body ?? {});
    if (!panelId.success || !parsed.success) {
      return res.status(400).json({ error: firstIssue(parsed) ?? 'Invalid request' });
    }
    res.json(await interviewService.updatePanel(panelId.data, toPanelInput(parsed.data), req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/** DELETE /api/interviews/panels/:panelId */
interviewRouter.delete('/panels/:panelId', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const panelId = idParam.safeParse(req.params.panelId);
    if (!panelId.success) return res.status(400).json({ error: 'Invalid id' });
    res.json(await interviewService.removePanel(panelId.data, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/* ─── single timeline (registered last: `/:id` is the greediest) ────────── */

/** GET /api/interviews/:id */
interviewRouter.get('/:id', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id' });
    res.json(await interviewService.get(id.data, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/** PATCH /api/interviews/:id — move the process to a new status. */
interviewRouter.patch('/:id', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const id = idParam.safeParse(req.params.id);
    const parsed = z
      .object({
        status: z.enum([
          'active',
          'offer',
          'accepted',
          'rejected',
          'withdrawn',
          'ghosted',
          'on_hold',
        ]),
      })
      .safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ error: 'Invalid request' });
    res.json(await interviewService.setStatus(id.data, parsed.data.status, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/** DELETE /api/interviews/:id — the timeline and everything under it. */
interviewRouter.delete('/:id', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id' });
    await interviewService.remove(id.data, req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    failure(err, res, next);
  }
});

/**
 * The first validation message, so a rejected link or time zone says WHY.
 *
 * Worth the few lines only for the fields a user can get wrong in a way they
 * can act on: "Link must start with http://" is fixable, "Invalid request" is
 * a guessing game.
 */
function firstIssue(parsed: z.SafeParseReturnType<unknown, unknown>): string | null {
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  return issue?.message ?? null;
}
