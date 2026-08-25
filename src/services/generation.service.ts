import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { prisma } from '../lib/prisma';
import { anthropic, MODEL } from '../lib/anthropic';
import { logger } from './logger.service';
import { promptService } from './prompt.service';
import { aiUsageService } from './aiUsage.service';
import { usableProfileWhere } from './profile.service';
import { saveResume, ResumeInputError, periodOf, yearsOf, profileIdentity } from './resume.service';
import { assembleLetter, coverLetterService, type StoredCoverLetter } from './coverLetter.service';
import { applicationDraftSchema, type ApplicationRequest } from '../schemas/generation.schema';
import type { TailoredResume } from '../schemas/resume.schema';

/**
 * Writes a whole application — resume and cover letter — in ONE model call.
 *
 * Named for the act, not the noun: `application.service.ts` is the "I applied to
 * this job" marker and is a different thing entirely.
 *
 * This replaces two calls that each re-sent the same candidate record and the
 * same posting. Measured on real runs, that duplication was ~2,400 input tokens
 * per application. Output is unchanged, because both documents still have to be
 * written — which is why this saves cost but very little time.
 *
 * THE COUPLING IS DELIBERATE AND HAS A COST. One call means one regeneration:
 * asking for a fresh letter necessarily rewrites the resume too, so a user who
 * hand-edited one and regenerates the other loses those edits. That is the
 * trade for a single prompt governing both documents, and it is what buys their
 * consistency — the letter is written with the finished resume in front of it
 * rather than from a separate reading of the record. Editing either document
 * after generation is unaffected; only regeneration is joint.
 */
/**
 * Anthropic errors arrive as `status: 400 invalid_request_error` for things a
 * developer must fix (no credits, bad key). The generic handler renders that as
 * "Bad request", which sends someone hunting through their own payload. Map the
 * ones that matter to messages that name the actual problem. Always throws.
 */
function mapProviderError(err: unknown): never {
  const e = err as {
    status?: number;
    error?: { error?: { type?: string; message?: string } };
    message?: string;
  };
  const msg = e.error?.error?.message ?? e.message ?? '';

  if (/credit balance is too low/i.test(msg)) {
    throw new ResumeInputError(
      'The Anthropic account has no API credits. Add credits at platform.claude.com under Billing.',
      503,
    );
  }
  if (e.status === 401) {
    throw new ResumeInputError('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.', 503);
  }
  if (e.status === 429) {
    throw new ResumeInputError('Rate limited by Anthropic. Wait a moment and try again.', 429);
  }
  logger.error('Anthropic call failed', { status: e.status, msg });
  throw new ResumeInputError('The AI service failed. Try again.', 502);
}

export interface GeneratedApplication {
  resume: TailoredResume & { saved: boolean };
  coverLetter: StoredCoverLetter;
}

export const generationService = {
  async generate(
    { jobId, profileId, notes }: ApplicationRequest,
    userId: number,
  ): Promise<GeneratedApplication> {
    const [job, profile] = await Promise.all([
      prisma.job.findUnique({
        where: { id: jobId },
        select: { id: true, title: true, company: true, location: true, description: true },
      }),
      prisma.profile.findFirst({
        where: { id: profileId, ...usableProfileWhere(userId) },
        include: {
          workExperiences: { orderBy: { sortOrder: 'asc' } },
          educations: { orderBy: { sortOrder: 'asc' } },
        },
      }),
    ]);

    if (!job) throw new ResumeInputError('Job not found', 404);
    if (!profile) throw new ResumeInputError('Profile not found', 404);

    const { name, contact } = profileIdentity(profile);

    const employment = profile.workExperiences
      .map((w) => `- ${w.company ?? '(company not recorded)'}${w.location ? `, ${w.location}` : ''} — ${periodOf(w.startDate, w.endDate)}`)
      .join('\n');
    const education = profile.educations
      .map((e) => `- ${[e.degree, e.university].filter(Boolean).join(', ')}${e.location ? ` (${e.location})` : ''} — ${e.datePrecision === 'year' ? yearsOf(e.startDate, e.endDate) : periodOf(e.startDate, e.endDate)}`)
      .join('\n');

    // Only include the notes section when there is something in it. An empty
    // quoted block reads to the model as "the candidate stated nothing, and
    // that emptiness is meaningful", which suppresses the inference we want.
    const notesBlock = notes.trim()
      ? `The candidate's own notes, which apply to BOTH documents. These OUTRANK
your inference wherever they touch — reword and reorder them, never overwrite
them:
"""
${notes.trim()}
"""`
      : `The candidate supplied no notes. Draft the titles, responsibilities and
skills yourself from the employment history above and the posting below, and
flag every one of them inferred=true.`;

    const candidateBlock = `CANDIDATE RECORD

Name: ${name || '(not recorded)'}
Contact: ${contact || '(not recorded)'}

Employment history — employers and dates are FIXED FACTS, never alter them:
${employment || '(none recorded)'}

Education — fixed facts:
${education || '(none recorded)'}

${notesBlock}`;

    const jobBlock = `JOB POSTING

Title: ${job.title}
Company: ${job.company ?? '(not stated)'}
Location: ${job.location ?? '(not stated)'}

Description:
"""
${job.description.slice(0, 24_000)}
"""

Produce the tailored resume and the cover letter paragraphs now.`;

    const res = await anthropic()
      .messages.parse({
        model: MODEL,
        // Both documents in one response, so the ceiling covers the pair.
        max_tokens: 16_000,
        // No `effort`: Haiku 4.5 rejects output_config.effort with a 400.
        // Restore `effort: 'medium'` if MODEL moves back to Opus or Sonnet.
        output_config: { format: zodOutputFormat(applicationDraftSchema) },
        // Candidate before posting, same reasoning as before — but no cache
        // breakpoint, because this prefix is well under the 4096 tokens Haiku
        // 4.5 needs before caching engages, and a breakpoint below the minimum
        // silently does nothing at all.
        system: [
          { type: 'text', text: await promptService.text('application.system') },
          { type: 'text', text: candidateBlock },
        ],
        messages: [{ role: 'user', content: jobBlock }],
      })
      .catch(mapProviderError);

    // Recorded before the refusal and parse checks: a response that arrives is
    // a response that was billed. One call, so one usage row — the split is now
    // application-level rather than per document.
    await aiUsageService.record({
      feature: 'application',
      model: MODEL,
      userId,
      profileId,
      jobId,
      usage: res.usage,
    });

    if (res.stop_reason === 'refusal') {
      logger.warn('Application generation refused', { jobId, category: res.stop_details?.category });
      throw new ResumeInputError('The model declined this request.', 422);
    }
    if (!res.parsed_output) {
      logger.error('Application generation returned no parsed output', { jobId, stop: res.stop_reason });
      throw new ResumeInputError('Generation did not return a usable application. Try again.', 502);
    }

    const { resume, coverLetter } = res.parsed_output;

    // Persist both. A save failure must not lose work the user just waited for,
    // so `saveResume` reports rather than throws and the flag travels with the
    // payload; the letter's own upsert is the authoritative copy either way.
    const saved = await saveResume({
      profileId, jobId, userId, job, data: resume as object, model: MODEL,
    });

    const stored = await coverLetterService.persist({
      profileId,
      jobId,
      job,
      body: assembleLetter({
        paragraphs: coverLetter.paragraphs,
        company: job.company,
        senderName: name,
      }),
      reviewNotes: coverLetter.reviewNotes,
      model: MODEL,
    });

    logger.info('Application generated', {
      jobId,
      profileId,
      usage: res.usage,
      gaps: resume.gaps.length,
      resumeReviewNotes: resume.reviewNotes.length,
      letterParagraphs: coverLetter.paragraphs.length,
      letterReviewNotes: coverLetter.reviewNotes.length,
    });

    return { resume: { ...resume, saved }, coverLetter: stored };
  },
};
