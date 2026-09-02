import { prisma } from '../lib/prisma';
import { providerOf, providerLabelOf, resolveProvider, type AiProvider } from '../lib/ai';
import { AiOutputError, structuredCall } from '../lib/generate';
import { logger } from './logger.service';
import { promptService } from './prompt.service';
import { aiUsageService } from './aiUsage.service';
import { usableProfileWhere } from './profile.service';
import { saveResume, ResumeInputError, periodOf, yearsOf, profileIdentity } from './resume.service';
import { assembleLetter, coverLetterService, type StoredCoverLetter } from './coverLetter.service';
import { applicationDraftSchema, type ApplicationRequest } from '../schemas/generation.schema';
import { sanitizeResume, sanitizeLetter, writeExperienceYears } from '../resume/sanitize';
import type { TailoredResume } from '../schemas/resume.schema';

export interface GeneratedApplication {
  resume: TailoredResume & {
    saved: boolean;
    model: string;
    provider: AiProvider | null;
    providerLabel: string;
  };
  coverLetter: StoredCoverLetter;
}

export const generationService = {
  async generate(
    { jobId, profileId, notes, provider }: ApplicationRequest,
    userId: number,
  ): Promise<GeneratedApplication> {
    // Resolved before anything is read: a provider this server cannot call is a
    // configuration problem, and saying so up front beats failing after a
    // profile lookup with a message about credentials.
    const chosen = resolveProvider(provider);

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
    // Checked here rather than only in the UI: the button being hidden does not
    // stop a repeated or crafted request, and this is the last point before a
    // billable call. 403, not 404 — the profile is theirs to see, it just may
    // not spend.
    if (!profile.aiEnabled) {
      throw new ResumeInputError(
        'AI is switched off for this profile. Ask a super admin to enable it.',
        403,
      );
    }

    const { name, contact } = profileIdentity(profile);

    const spans = profile.workExperiences.filter((w) => w.startDate);
    const earliest = spans.length ? Math.min(...spans.map((w) => w.startDate!.getTime())) : null;
    const latest = spans.length
      ? Math.max(...spans.map((w) => (w.endDate ?? new Date()).getTime()))
      : null;
    const yearsOfWork =
      earliest !== null && latest !== null && latest > earliest
        ? Math.floor((latest - earliest) / (365.25 * 24 * 60 * 60 * 1000))
        : 0;

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

Total years of work: ${yearsOfWork || '(not derivable)'}
This figure is computed from the dates above and is a FIXED FACT. State it in
the summary in digits with a trailing plus ("10+ years"), which is the one place
a plus sign belongs. Do not recompute it and do not round it up.

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

    // One call for both documents, whichever vendor answers it — so the ceiling
    // covers the pair, and the two can never disagree about the candidate.
    // Candidate block before the posting so the stable half of the prompt sits
    // in the cacheable prefix on both providers.
    const call = await structuredCall({
      provider: chosen,
      system: [await promptService.text('application.system'), candidateBlock],
      user: jobBlock,
      schema: applicationDraftSchema,
      schemaName: 'tailored_application',
      maxTokens: 16_000,
    }).catch(asInputError);

    // Recorded before the content checks: a response that arrives is a response
    // that was billed. One call, so one usage row — the split is
    // application-level rather than per document.
    await aiUsageService.record({
      feature: 'application',
      model: call.model,
      userId,
      profileId,
      jobId,
      usage: call.usage,
    });

    // Spell out "50K+" as "over 50K" before anything is persisted or rendered.
    // The prompt asks for this and the model mostly complies; this is what makes
    // it certain, and it runs before BOTH documents so the two cannot disagree.
    const { resume } = sanitizeResume(call.output);
    // The prompt asks for "10+ years"; this is what makes it certain. Applied
    // to the summary alone, because that is the one sentence that states the
    // career span — a "five years" inside a bullet is describing something else.
    resume.summary = writeExperienceYears(resume.summary, yearsOfWork);
    // The letter goes through a STRICTER pass: it is pasted into an email as
    // plain text, so it keeps no tags at all, while the resume keeps its <b>.
    const coverLetter = sanitizeLetter(call.output.coverLetter);

    // Persist both. A save failure must not lose work the user just waited for,
    // so `saveResume` reports rather than throws and the flag travels with the
    // payload; the letter's own upsert is the authoritative copy either way.
    const saved = await saveResume({
      profileId, jobId, userId, job, data: resume as object, model: call.model,
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
      model: call.model,
    });

    logger.info('Application generated', {
      jobId,
      profileId,
      provider: chosen,
      model: call.model,
      usage: call.usage,
      gaps: resume.gaps.length,
      resumeReviewNotes: resume.reviewNotes.length,
      letterParagraphs: coverLetter.paragraphs.length,
      letterReviewNotes: coverLetter.reviewNotes.length,
    });

    return {
      // The model and its vendor ride back with the draft so the page can badge
      // it immediately, instead of re-reading the row it just wrote.
      resume: {
        ...resume,
        saved,
        model: call.model,
        provider: providerOf(call.model),
        providerLabel: providerLabelOf(call.model),
      },
      coverLetter: stored,
    };
  },
};

/**
 * A refusal reproduces exactly on a retry and a malformed body does not, so the
 * two get different codes: 422 tells the caller to change the request, 502 to
 * try again.
 */
function asInputError(err: unknown): never {
  if (err instanceof AiOutputError) {
    throw new ResumeInputError(err.message, err.kind === 'refused' ? 422 : 502);
  }
  throw err;
}
