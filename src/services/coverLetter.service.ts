import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { prisma } from '../lib/prisma';
import { anthropic, MODEL } from '../lib/anthropic';
import { env, isProd } from '../config/env';
import { logger } from './logger.service';
import { promptService } from './prompt.service';
import { usableProfileWhere } from './profile.service';
import { coverLetterDraftSchema, type CoverLetterRequest } from '../schemas/coverLetter.schema';
import type { TailoredResume } from '../schemas/resume.schema';

/** Raised for a rejected request; the route turns it into a status code. */
export class CoverLetterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CoverLetterError';
  }
}

export interface StoredCoverLetter {
  body: string;
  reviewNotes: string[];
  edited: boolean;
  model: string;
  updatedAt: Date;
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function periodOf(start: Date | null, end: Date | null): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (!start && !end) return '';
  return `${start ? fmt(start) : '?'} – ${end ? fmt(end) : 'Present'}`;
}

/**
 * Wrap the model's paragraphs in the letter frame.
 *
 * The frame is assembled from the job and the profile rather than generated:
 * the company name, the candidate's name and today's date are facts the app
 * already holds, and a model can only get them wrong. The date is baked in
 * here rather than rendered on read, so a letter is a record of what was
 * written instead of something that silently re-dates itself next week.
 */
export function assembleLetter(input: {
  paragraphs: string[];
  company: string | null;
  senderName: string;
  date?: Date;
}): string {
  const { paragraphs, company, senderName } = input;
  const date = input.date ?? new Date();

  // "Dear UKG Hiring Team," reads as addressed to someone; the fallback still
  // has to be a greeting, not a blank line.
  const salutation = company ? `Dear ${company} Hiring Team,` : 'Dear Hiring Team,';
  const recipient = company ? `Hiring Manager\n${company}` : 'Hiring Manager';

  return [
    fmtDate(date),
    '',
    recipient,
    '',
    salutation,
    '',
    paragraphs.map((p) => p.trim()).filter(Boolean).join('\n\n'),
    '',
    'Sincerely,',
    '',
    senderName || '',
  ].join('\n');
}

/** Canned paragraphs for AI_MOCK, shaped from the caller's real rows. */
function mockParagraphs(jobTitle: string, company: string | null, employers: string[]) {
  const at = company ? ` at ${company}` : '';
  const where = employers.slice(0, 2).join(' and ') || 'my previous roles';
  return {
    paragraphs: [
      `I am excited to apply for the ${jobTitle} role${at}, drawn by the scope of the work described in your posting and the chance to contribute to it directly.`,
      `At ${where}, I led work that maps closely to what this role asks for — building the systems, tooling and review habits that let a team ship quickly without giving up confidence in what it ships.`,
      `I would welcome the chance to talk about how that experience fits your team${at}, and what the first few months in this role would look like.`,
    ],
    reviewNotes: [
      'MOCK OUTPUT (AI_MOCK=1) — no model was called; nothing here is tailored.',
    ],
  };
}

export const coverLetterService = {
  /**
   * Which of `jobIds` already have a letter for this profile.
   *
   * One query for a whole page rather than a request per card, mirroring
   * `resumeService.statusFor`. The BODY is deliberately not returned — a page
   * of twenty letters is tens of kilobytes to render a one-word badge, and the
   * card only needs to know that one exists.
   */
  async statusFor(
    jobIds: number[],
    profileId: number,
    userId: number,
  ): Promise<Record<number, { jobId: number; edited: boolean; updatedAt: Date }>> {
    if (jobIds.length === 0) return {};
    const rows = await prisma.coverLetter.findMany({
      where: { jobId: { in: jobIds }, profileId, profile: usableProfileWhere(userId) },
      select: { jobId: true, edited: true, updatedAt: true },
    });
    const out: Record<number, { jobId: number; edited: boolean; updatedAt: Date }> = {};
    for (const r of rows) {
      // jobId is nullable (a deleted posting sets it null), so a row can come
      // back without one even though the filter asked for a set.
      if (r.jobId == null) continue;
      out[r.jobId] = { jobId: r.jobId, edited: r.edited, updatedAt: r.updatedAt };
    }
    return out;
  },

  /** The stored letter for this pairing, or null. Having none is normal. */
  async saved(jobId: number, profileId: number, userId: number): Promise<StoredCoverLetter | null> {
    const row = await prisma.coverLetter.findFirst({
      where: { jobId, profileId, profile: usableProfileWhere(userId) },
      select: { body: true, reviewNotes: true, edited: true, model: true, updatedAt: true },
    });
    if (!row) return null;
    return { ...row, reviewNotes: (row.reviewNotes as string[]) ?? [] };
  },

  /**
   * Save a hand edit.
   *
   * Sets `edited`, which is what makes the UI confirm before a regeneration
   * overwrites wording the user tuned themselves. Scoped to profiles the caller
   * may use, so a shared profile's letters are editable by the whole team.
   */
  async update(
    jobId: number,
    profileId: number,
    userId: number,
    body: string,
  ): Promise<StoredCoverLetter> {
    const existing = await prisma.coverLetter.findFirst({
      where: { jobId, profileId, profile: usableProfileWhere(userId) },
      select: { id: true },
    });
    if (!existing) throw new CoverLetterError('No cover letter to update', 404);

    const row = await prisma.coverLetter.update({
      where: { id: existing.id },
      data: { body, edited: true },
      select: { body: true, reviewNotes: true, edited: true, model: true, updatedAt: true },
    });
    return { ...row, reviewNotes: (row.reviewNotes as string[]) ?? [] };
  },

  /**
   * Generate a cover letter for one posting.
   *
   * The tailored resume is REQUIRED, not optional. Generated independently the
   * two documents drift — different role framing, different achievements led
   * with — and a hiring team reads them side by side, which is exactly where
   * that shows. Requiring it also means the letter always has concrete material
   * to draw on rather than employers and dates alone.
   */
  async generate(
    { jobId, profileId, notes }: CoverLetterRequest,
    userId: number,
  ): Promise<StoredCoverLetter> {
    const [job, profile, resumeRow] = await Promise.all([
      prisma.job.findUnique({
        where: { id: jobId },
        select: { title: true, company: true, location: true, description: true },
      }),
      prisma.profile.findFirst({
        where: { id: profileId, ...usableProfileWhere(userId) },
        include: {
          workExperiences: { orderBy: { sortOrder: 'asc' } },
          educations: { orderBy: { sortOrder: 'asc' } },
        },
      }),
      prisma.resume.findFirst({
        where: { jobId, profileId, profile: usableProfileWhere(userId) },
        select: { data: true },
      }),
    ]);

    if (!job) throw new CoverLetterError('Job not found', 404);
    if (!profile) throw new CoverLetterError('Profile not found', 404);
    // 409, not 404: the request is well formed and the caller may retry it
    // after doing the missing step. The message names that step.
    if (!resumeRow) {
      throw new CoverLetterError(
        'Generate the tailored resume for this job first — the letter is written from it.',
        409,
      );
    }

    const senderName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    const contact = [profile.email, profile.phone, profile.location, profile.linkedin]
      .filter(Boolean)
      .join(' | ');

    const employment = profile.workExperiences
      .map((w) => `- ${w.company ?? '(company not recorded)'}${w.location ? `, ${w.location}` : ''} — ${periodOf(w.startDate, w.endDate)}`)
      .join('\n');
    const education = profile.educations
      .map((e) => `- ${[e.degree, e.university].filter(Boolean).join(', ')}${e.location ? ` (${e.location})` : ''} — ${periodOf(e.startDate, e.endDate)}`)
      .join('\n');

    // Dev-only short-circuit, placed AFTER the lookups so the 404/409 paths and
    // the profile scoping are still exercised — a mock that skips them would
    // prove less than it appears to.
    if (env.AI_MOCK && !isProd) {
      logger.warn('Cover letter from MOCK (AI_MOCK=1) — no model was called', { jobId, profileId });
      const mock = mockParagraphs(
        job.title,
        job.company,
        profile.workExperiences.map((w) => w.company ?? '').filter(Boolean),
      );
      const body = assembleLetter({ paragraphs: mock.paragraphs, company: job.company, senderName });
      return this.persist({ profileId, jobId, job, body, reviewNotes: mock.reviewNotes, model: 'mock' });
    }

    const system = await promptService.text('cover-letter.system');

    // Same cache split as the resume generator: the candidate is identical on
    // every application, the posting and its tailored resume are not. Caching
    // is a prefix match, so this ordering is what keeps application #2 cheap.
    const candidateBlock = `CANDIDATE RECORD

Name: ${senderName || '(not recorded)'}
Contact: ${contact || '(not recorded)'}

Employment history — employers and dates are FIXED FACTS, never alter them:
${employment || '(none recorded)'}

Education — fixed facts:
${education || '(none recorded)'}`;

    const resume = resumeRow.data as Partial<TailoredResume>;
    const notesBlock = notes.trim()
      ? `\n\nThe candidate's instructions for this letter. These OUTRANK your own
judgement wherever they touch:\n"""\n${notes.trim()}\n"""`
      : '';

    const jobBlock = `JOB POSTING

Title: ${job.title}
Company: ${job.company ?? '(not stated)'}
Location: ${job.location ?? '(not stated)'}

Description:
"""
${job.description.slice(0, 20_000)}
"""

TAILORED RESUME ALREADY WRITTEN FOR THIS POSTING

The letter must agree with this document. Items carrying inferred=true were
drafted rather than stated by the candidate — you may use them, but each one you
use must appear in your reviewNotes.

"""
${JSON.stringify(resume).slice(0, 12_000)}
"""${notesBlock}

Write the body paragraphs now.`;

    const res = await anthropic()
      .messages.parse({
        model: MODEL,
        max_tokens: 4_000,
        output_config: { effort: 'medium', format: zodOutputFormat(coverLetterDraftSchema) },
        system: [
          { type: 'text', text: system },
          { type: 'text', text: candidateBlock, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: jobBlock }],
      })
      .catch((err) => {
        logger.error('Cover letter generation failed', { jobId, profileId, err: String(err) });
        throw new CoverLetterError('The model could not be reached. Try again.', 502);
      });

    if (res.stop_reason === 'refusal') {
      logger.warn('Cover letter generation refused', { jobId, category: res.stop_details?.category });
      throw new CoverLetterError('The model declined this request.', 422);
    }
    if (!res.parsed_output) {
      logger.error('Cover letter returned no parsed output', { jobId, stop: res.stop_reason });
      throw new CoverLetterError('Generation did not return a usable letter. Try again.', 502);
    }

    const body = assembleLetter({
      paragraphs: res.parsed_output.paragraphs,
      company: job.company,
      senderName,
    });

    logger.info('Cover letter generated', {
      jobId,
      profileId,
      usage: res.usage,
      paragraphs: res.parsed_output.paragraphs.length,
      reviewNotes: res.parsed_output.reviewNotes.length,
    });

    return this.persist({
      profileId,
      jobId,
      job,
      body,
      reviewNotes: res.parsed_output.reviewNotes,
      model: MODEL,
    });
  },

  /**
   * Upsert the single row for this pairing.
   *
   * `edited` is reset here on purpose: the text the user tuned is gone, so
   * leaving the flag set would keep warning about protecting wording that no
   * longer exists.
   */
  async persist(input: {
    profileId: number;
    jobId: number;
    job: { title: string; company: string | null };
    body: string;
    reviewNotes: string[];
    model: string;
  }): Promise<StoredCoverLetter> {
    const { profileId, jobId, job, body, reviewNotes, model } = input;
    const row = await prisma.coverLetter.upsert({
      where: { profileId_jobId: { profileId, jobId } },
      create: {
        profileId, jobId, jobTitle: job.title, jobCompany: job.company,
        body, reviewNotes: reviewNotes as never, model,
      },
      update: {
        body, reviewNotes: reviewNotes as never, model, edited: false,
        jobTitle: job.title, jobCompany: job.company,
      },
      select: { body: true, reviewNotes: true, edited: true, model: true, updatedAt: true },
    });
    return { ...row, reviewNotes: (row.reviewNotes as string[]) ?? [] };
  },
};
