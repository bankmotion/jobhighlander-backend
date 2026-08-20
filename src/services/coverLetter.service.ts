import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';

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
