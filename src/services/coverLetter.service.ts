import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';

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

  async saved(jobId: number, profileId: number, userId: number): Promise<StoredCoverLetter | null> {
    const row = await prisma.coverLetter.findFirst({
      where: { jobId, profileId, profile: usableProfileWhere(userId) },
      select: { body: true, reviewNotes: true, edited: true, model: true, updatedAt: true },
    });
    if (!row) return null;
    return { ...row, reviewNotes: (row.reviewNotes as string[]) ?? [] };
  },

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
