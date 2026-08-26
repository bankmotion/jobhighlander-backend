import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { jobQueryService } from '../services/jobQuery.service';
import { ResumeInputError } from '../services/resume.service';
import { MissingPromptError } from '../services/prompt.service';
import { aiEnabled } from '../lib/anthropic';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

export const jobQueryRouter = Router();

/**
 * "Ask AI about this job" — free-form questions against one posting.
 *
 * Open to every signed-in role, like the other per-profile features: the
 * service scopes each call to profiles the caller may use, and bidders are who
 * actually work the postings.
 */

const idParam = z.coerce.number().int().positive();

/**
 * Question length cap, in CHARACTERS.
 *
 * The column is MySQL `TEXT` — 65,535 BYTES, not characters — and utf8mb4
 * spends up to four bytes per character, so the byte-safe ceiling is ~16,383.
 * 4,000 is well under that and is already far more than a question needs; the
 * cap exists to stop someone pasting a whole posting into the box and paying
 * for it twice, since the posting already travels in the system context.
 */
const QUESTION_MAX_CHARS = 4_000;

/** Map a known error onto its status; anything else is a real 500. */
function failure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ResumeInputError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof MissingPromptError) {
    // A broken deployment, not a bad request: the prompt row is missing, and
    // saying so names the actual fix instead of blaming the question.
    res.status(503).json({ error: err.message });
    return;
  }
  next(err);
}

/** POST /api/job-queries — ask a question and store the answer. */
jobQueryRouter.post('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    // Checked before anything else so a server with no key says so, rather than
    // failing deep inside the call with a stack trace.
    if (!aiEnabled()) {
      return res.status(503).json({ error: 'AI is not configured on this server' });
    }
    const parsed = z
      .object({
        jobId: idParam,
        profileId: idParam,
        question: z.string().trim().min(1).max(QUESTION_MAX_CHARS),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid request',
      });
    }
    const { jobId, profileId, question } = parsed.data;
    res.json(await jobQueryService.ask(jobId, profileId, question, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/** GET /api/job-queries?jobId=&profileId= — the log, newest first. */
jobQueryRouter.get('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ jobId: idParam, profileId: idParam }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { jobId, profileId } = parsed.data;
    res.json(await jobQueryService.list(jobId, profileId, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/**
 * GET /api/job-queries/counts?profileId=&jobIds=1,2,3 — keyed by job id.
 *
 * Bounded at 100 to match the `pageSize` ceiling on GET /api/jobs; without a
 * cap this is an unbounded `IN (...)` driven straight from the query string.
 * Registered before `/:id` so Express cannot read "counts" as an id.
 */
jobQueryRouter.get('/counts', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
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
    res.json(await jobQueryService.countsFor(jobIds, profileId, req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/** DELETE /api/job-queries/:id — remove one entry from the log. */
jobQueryRouter.delete('/:id', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id' });
    const removed = await jobQueryService.remove(id.data, req.user!.id);
    // Not-found is reported rather than 404'd: the caller asked for it to be
    // gone and it is, which is a success by any useful reading.
    res.json({ ok: true, removed });
  } catch (err) {
    failure(err, res, next);
  }
});
