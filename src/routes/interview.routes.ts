import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  interviewService,
  InterviewError,
  type PanelInput,
} from '../services/interview.service';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

export const interviewRouter = Router();

function failure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof InterviewError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

const idParam = z.coerce.number().int().positive();

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

const meetingUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v), { message: 'Link must start with http:// or https://' });

const NOTE_MAX_CHARS = 16_000;

const panelBody = z.object({
  title: z.string().trim().max(255).nullable().optional(),
  note: z.string().max(NOTE_MAX_CHARS).nullable().optional(),
  meetingUrl: meetingUrl.nullable().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: timezone.nullable().optional(),
  durationMin: z.number().int().min(0).max(1440).nullable().optional(),
});

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

interviewRouter.get('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ profileId: idParam.optional() }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    res.json(await interviewService.list(req.user!.id, parsed.data.profileId));
  } catch (err) {
    failure(err, res, next);
  }
});

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

interviewRouter.get('/calendar', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
        profileId: idParam.optional(),
      })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });

    const from = new Date(parsed.data.from);
    const to = new Date(parsed.data.to);
    if (to <= from) return res.status(400).json({ error: '`to` must be after `from`' });
    if (to.getTime() - from.getTime() > 400 * 86_400_000) {
      return res.status(400).json({ error: 'Range must be 400 days or less' });
    }

    res.json(await interviewService.calendar(req.user!.id, from, to, parsed.data.profileId));
  } catch (err) {
    failure(err, res, next);
  }
});

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

const stepBody = z.object({
  position: z.number().int().min(0).optional(),
  title: z.string().trim().max(255).nullable().optional(),
  stageTypeIds: z.array(z.number().int().positive()).max(8).optional(),
});

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

interviewRouter.delete('/steps/:stepId', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const stepId = idParam.safeParse(req.params.stepId);
    if (!stepId.success) return res.status(400).json({ error: 'Invalid id' });
    res.json(await interviewService.removeStep(stepId.data, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

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

interviewRouter.delete('/panels/:panelId', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const panelId = idParam.safeParse(req.params.panelId);
    if (!panelId.success) return res.status(400).json({ error: 'Invalid id' });
    res.json(await interviewService.removePanel(panelId.data, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

interviewRouter.get('/:id', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id' });
    res.json(await interviewService.get(id.data, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

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

function firstIssue(parsed: z.SafeParseReturnType<unknown, unknown>): string | null {
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  return issue?.message ?? null;
}
