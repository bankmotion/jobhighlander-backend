import { Router, type Response, type NextFunction } from 'express';
import { z as zod } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';
import { aiEnabled } from '../lib/anthropic';
import { previewRequestSchema } from '../schemas/resume.schema';
import { resumeService, ResumeInputError, profileIdentity } from '../services/resume.service';
import { prisma } from '../lib/prisma';
import { tailoredResumeSchema } from '../schemas/resume.schema';
import { renderResumeHtml } from '../resume/render';
import { htmlToPdf } from '../resume/pdf';
import { TEMPLATES } from '../resume/templates/registry';
import { logger } from '../services/logger.service';

export const resumeRouter = Router();

/**
 * POST /api/resumes/preview — generate a resume tailored to one job posting.
 *
 * Nothing is persisted: this is a preview surface while the output shape is
 * still settling, so it needs no migration to change.
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

    const resume = await resumeService.preview(parsed.data, req.user!.id);
    res.json(resume);
  } catch (err) {
    if (err instanceof ResumeInputError) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/** GET /api/resumes/templates — what the picker can offer. */
resumeRouter.get('/templates', requireAuth, (_req: AuthedRequest, res: Response) => {
  res.json(
    Object.values(TEMPLATES).map((t) => ({ key: t.key, name: t.name, atsSafe: t.atsSafe })),
  );
});

const savedQuerySchema = zod.object({
  jobId: zod.coerce.number().int().positive(),
  profileId: zod.coerce.number().int().positive(),
});

/**
 * GET /api/resumes/saved?jobId=&profileId= — the previously generated draft.
 *
 * 204 rather than 404 when there is none: "you have not generated one yet" is a
 * normal state for this endpoint, not a client error, and the UI branches on it
 * every single page load.
 */
resumeRouter.get('/saved', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = savedQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const row = await resumeService.saved(parsed.data.jobId, parsed.data.profileId, req.user!.id);
    if (!row) return res.status(204).end();
    res.json(row);
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

    // Owner-scoped: someone else's profile is a 404, not a 403, so the
    // endpoint never confirms that a row exists.
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ownerId: req.user!.id },
      select: { firstName: true, lastName: true, email: true, phone: true, location: true, linkedin: true },
    });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    const { name, contact } = profileIdentity(profile);
    const html = renderResumeHtml({ resume: resume.data, name, contact, templateKey, pageSize });
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
