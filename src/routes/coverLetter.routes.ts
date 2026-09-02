import { Router, type Response, type NextFunction } from 'express';
import { coverLetterService, CoverLetterError } from '../services/coverLetter.service';
import { generationService } from '../services/generation.service';
import { aiEnabled } from '../lib/ai';
import {
  coverLetterRequestSchema,
  coverLetterUpdateSchema,
} from '../schemas/coverLetter.schema';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';
import { presetService } from '../services/preset.service';
import { profileIdentity } from '../services/resume.service';
import { usableProfileWhere } from '../services/profile.service';
import { renderCoverLetterHtml } from '../resume/letter';
import { renderCoverLetterDocx } from '../resume/letter-docx';
import { htmlToPdf } from '../resume/pdf';
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

// ── Downloads ────────────────────────────────────────────────────────────
// The letter is rendered from the STORED body, not regenerated: it is a record
// of what was written, including any hand edits, and re-running the model would
// quietly hand the user a different letter than the one they reviewed.
//
// 204 when no letter exists, NOT 404. The job list asks for the letter
// unconditionally rather than checking first, so "nothing written yet" is the
// ordinary case and must pass quietly. It has to stay distinguishable from a
// genuine 404 though: when these routes had no Next.js proxy in front of them,
// the framework's own 404 looked exactly like "no letter" and the caller
// swallowed it — the download silently produced one file for a day.
const downloadQuery = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
  templateKey: z.string().trim().max(64).optional(),
  pageSize: z.enum(['letter', 'a4']).default('letter'),
});

async function letterDownload(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
  format: 'pdf' | 'docx',
): Promise<void> {
  try {
    const parsed = downloadQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const { jobId, profileId, templateKey, pageSize } = parsed.data;
    const userId = req.user!.id;

    const letter = await coverLetterService.saved(jobId, profileId, userId);
    if (!letter) {
      res.status(204).end();
      return;
    }

    // Same profile scoping as the resume routes: a profile the caller may not
    // use is a 404, so the endpoint never confirms the row exists.
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ...usableProfileWhere(userId) },
      select: { firstName: true, lastName: true, email: true, phone: true, location: true, linkedin: true },
    });
    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }
    const { name, contact } = profileIdentity(profile);

    // Falls back to the profile default so the letter matches the resume it is
    // sent with, rather than always using the built-in preset.
    const preset = templateKey
      ? await presetService.get(templateKey)
      : await presetService.forProfile(profileId, userId);

    const file = `cover_${(name || 'letter').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'letter'}`;

    if (format === 'docx') {
      const docx = await renderCoverLetterDocx({ body: letter.body, name, contact, preset, pageSize });
      logger.info('Cover letter DOCX rendered', { bytes: docx.length, jobId, templateKey });
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${file}.docx"`);
      res.setHeader('Content-Length', String(docx.length));
      res.end(docx);
      return;
    }

    const html = renderCoverLetterHtml({ body: letter.body, name, contact, preset, pageSize });
    const { pdf, cached, ms } = await htmlToPdf(html, pageSize);
    logger.info('Cover letter PDF rendered', { bytes: pdf.length, cached, ms, jobId, templateKey });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  } catch (err) {
    failure(err, res, next);
  }
}

coverLetterRouter.get('/pdf', requireAuth, (req: AuthedRequest, res, next) =>
  letterDownload(req, res, next, 'pdf'),
);
coverLetterRouter.get('/docx', requireAuth, (req: AuthedRequest, res, next) =>
  letterDownload(req, res, next, 'docx'),
);
