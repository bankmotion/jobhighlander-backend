import { Router, type Response, type NextFunction } from 'express';
import { z as zod } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';
import { aiEnabled } from '../lib/anthropic';
import { previewRequestSchema } from '../schemas/resume.schema';
import { resumeService, ResumeInputError, profileIdentity } from '../services/resume.service';
import { generationService } from '../services/generation.service';
import { prisma } from '../lib/prisma';
import { tailoredResumeSchema } from '../schemas/resume.schema';
import { renderResumeHtml } from '../resume/render';
import { htmlToPdf } from '../resume/pdf';
import { presetService, PARAMETER_SPACE } from '../services/preset.service';
import { usableProfileWhere } from '../services/profile.service';
import { logger } from '../services/logger.service';

export const resumeRouter = Router();

/**
 * POST /api/resumes/preview — generate the application for one job posting.
 *
 * Despite the name this now writes BOTH documents, because they come from a
 * single model call. The response shape is unchanged so existing callers keep
 * working: the resume is returned as before, and the cover letter is saved
 * alongside it and picked up by the cover-letter endpoints. Regenerating from
 * here therefore also rewrites the letter.
 */
resumeRouter.post('/preview', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (!aiEnabled()) {
      return res.status(503).json({ error: 'AI is not configured on this server' });
    }

    const parsed = previewRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { resume } = await generationService.generate(parsed.data, req.user!.id);
    res.json(resume);
  } catch (err) {
    if (err instanceof ResumeInputError) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/** GET /api/resumes/templates — everything the picker can offer. */
resumeRouter.get('/templates', requireAuth, async (_req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ presets: await presetService.list(), parameterSpace: PARAMETER_SPACE });
  } catch (err) {
    next(err);
  }
});

const setDefaultSchema = zod.object({
  profileId: zod.coerce.number().int().positive(),
  templateKey: zod.string().trim().min(1).max(64),
});

/** POST /api/resumes/templates/default — set a profile's default preset. */
resumeRouter.post('/templates/default', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = setDefaultSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const ok = await presetService.setDefault(parsed.data.profileId, req.user!.id, parsed.data.templateKey);
    // Either the profile is not yours or the preset does not exist; both are a
    // 404 so the endpoint never confirms which.
    if (!ok) return res.status(404).json({ error: 'Profile or template not found' });
    res.json({ ok: true, templateKey: parsed.data.templateKey });
  } catch (err) {
    next(err);
  }
});

const pairingSchema = zod.object({
  jobId: zod.coerce.number().int().positive(),
  profileId: zod.coerce.number().int().positive(),
});

/**
 * GET /api/resumes/saved?jobId=&profileId= — the one resume stored for this
 * pairing, or null. Having none is the normal state before the first
 * generation, so it is a 200 with null rather than a 404.
 */
resumeRouter.get('/saved', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = pairingSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    res.json(await resumeService.saved(parsed.data.jobId, parsed.data.profileId, req.user!.id));
  } catch (err) {
    next(err);
  }
});

/**
 * The list page asks about a whole page of jobs at once. Bounded at 100 to match
 * the `pageSize` ceiling on GET /api/jobs — without a cap this is an unbounded
 * `IN (...)` driven straight from the query string.
 */
const statusQuerySchema = zod.object({
  profileId: zod.coerce.number().int().positive(),
  jobIds: zod
    .string()
    .trim()
    .min(1)
    .transform((s) => s.split(',').map((v) => Number(v.trim())))
    .pipe(zod.array(zod.number().int().positive()).min(1).max(100)),
});

/**
 * GET /api/resumes/status?profileId=&jobIds=1,2,3 — which of these jobs already
 * have a resume, keyed by job id. Jobs with none are simply absent.
 */
resumeRouter.get('/status', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = statusQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { profileId, jobIds } = parsed.data;
    res.json(await resumeService.statusFor(jobIds, profileId, req.user!.id));
  } catch (err) {
    next(err);
  }
});

const applyTemplateSchema = pairingSchema.extend({
  templateKey: zod.string().trim().min(1).max(64),
});

/**
 * POST /api/resumes/template — apply a template to the saved resume.
 *
 * Selecting a template in the UI only re-renders the preview; this is the
 * explicit Apply, and the only thing that writes the choice to the database.
 */
resumeRouter.post('/template', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = applyTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const { jobId, profileId, templateKey } = parsed.data;
    const ok = await resumeService.setTemplate(jobId, profileId, req.user!.id, templateKey);
    // Either there is no saved resume for this pairing, it is not yours, or the
    // template does not exist; all three are a 404 so nothing is confirmed.
    if (!ok) return res.status(404).json({ error: 'Resume or template not found' });
    res.json({ ok: true, templateKey });
  } catch (err) {
    next(err);
  }
});

const pdfBodySchema = zod.object({
  resume: zod.unknown(),
  profileId: zod.coerce.number().int().positive(),
  templateKey: zod.string().trim().max(64).optional(),
  pageSize: zod.enum(['letter', 'a4']).default('letter'),
});

/**
 * POST /api/resumes/pdf — render a generated resume to PDF.
 *
 * The resume travels in the body rather than being re-fetched by id because
 * nothing is persisted yet: the client already holds the object it wants
 * printed, and regenerating to print would cost a model call per download.
 */
resumeRouter.post('/pdf', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = pdfBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    // The resume itself is validated against the generation schema, so a
    // hand-rolled or stale object fails here rather than rendering a broken PDF.
    const resume = tailoredResumeSchema.safeParse(parsed.data.resume);
    if (!resume.success) {
      return res.status(400).json({ error: 'Resume does not match the expected shape' });
    }

    const { profileId, templateKey, pageSize } = parsed.data;

    // Scoped to profiles the caller may use (own or accepted invitation): one
    // they may not is a 404, not a 403, so the endpoint never confirms that a
    // row exists.
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ...usableProfileWhere(req.user!.id) },
      select: { firstName: true, lastName: true, email: true, phone: true, location: true, linkedin: true },
    });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    const { name, contact } = profileIdentity(profile);
    // An explicit key wins (the picker previewing a choice); otherwise the
    // profile's saved default; otherwise the built-in fallback.
    const preset = templateKey
      ? await presetService.get(templateKey)
      : await presetService.forProfile(profileId, req.user!.id);
    const html = renderResumeHtml({ resume: resume.data, name, contact, preset, pageSize });
    const { pdf, cached, ms } = await htmlToPdf(html, pageSize);

    logger.info('Resume PDF rendered', { bytes: pdf.length, cached, ms, templateKey, pageSize });

    const file = (name || 'resume').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'resume';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  } catch (err) {
    if (err instanceof ResumeInputError) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});
