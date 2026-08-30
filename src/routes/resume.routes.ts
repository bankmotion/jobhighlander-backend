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
import { renderResumeDocx } from '../resume/docx';
import { presetService, PARAMETER_SPACE } from '../services/preset.service';
import { usableProfileWhere } from '../services/profile.service';
import { logger } from '../services/logger.service';

export const resumeRouter = Router();

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

resumeRouter.get('/saved', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = pairingSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    res.json(await resumeService.saved(parsed.data.jobId, parsed.data.profileId, req.user!.id));
  } catch (err) {
    next(err);
  }
});

const statusQuerySchema = zod.object({
  profileId: zod.coerce.number().int().positive(),
  jobIds: zod
    .string()
    .trim()
    .min(1)
    .transform((s) => s.split(',').map((v) => Number(v.trim())))
    .pipe(zod.array(zod.number().int().positive()).min(1).max(100)),
});

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

resumeRouter.post('/docx', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = pdfBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const resume = tailoredResumeSchema.safeParse(parsed.data.resume);
    if (!resume.success) {
      return res.status(400).json({ error: 'Resume does not match the expected shape' });
    }

    const { profileId, templateKey, pageSize } = parsed.data;
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ...usableProfileWhere(req.user!.id) },
      select: { firstName: true, lastName: true, email: true, phone: true, location: true, linkedin: true },
    });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    const { name, contact } = profileIdentity(profile);
    const preset = templateKey
      ? await presetService.get(templateKey)
      : await presetService.forProfile(profileId, req.user!.id);

    const started = Date.now();
    const docx = await renderResumeDocx({ resume: resume.data, name, contact, preset, pageSize });
    logger.info('Resume DOCX rendered', {
      bytes: docx.length, ms: Date.now() - started, templateKey, layout: preset?.layout, pageSize,
    });

    const file = (name || 'resume').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'resume';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${file}.docx"`);
    res.setHeader('Content-Length', String(docx.length));
    res.end(docx);
  } catch (err) {
    if (err instanceof ResumeInputError) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

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
