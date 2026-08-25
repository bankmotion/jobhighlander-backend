import { prisma } from '../lib/prisma';
import { presetService } from './preset.service';
import { usableProfileWhere } from './profile.service';
import { logger } from '../services/logger.service';
import type { TailoredResume } from '../schemas/resume.schema';

/** Thrown for conditions the caller can fix; the route maps these to 4xx. */
export class ResumeInputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * The shipped default lives in prompt.service.ts alongside every other editable
 * instruction, and `promptService.text` falls back to it when no row exists or
 * a super admin has cleared the box. Read per generation rather than cached in
 * a module constant, so an edit takes effect on the next request instead of the
 * next restart.
 */

/** Name + contact line as they appear on the resume. Read from the profile,
 *  never from the request body — these identify a real person and the client
 *  has no business asserting them. */
export function profileIdentity(p: {
  firstName: string | null; lastName: string | null; email: string | null;
  phone: string | null; location: string | null; linkedin: string | null;
}): { name: string; contact: string } {
  return {
    name: [p.firstName, p.lastName].filter(Boolean).join(' '),
    contact: [p.email, p.phone, p.location, p.linkedin].filter(Boolean).join(' | '),
  };
}

export function periodOf(start: Date | null, end: Date | null): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (!start && !end) return '';
  return `${start ? fmt(start) : '?'} – ${end ? fmt(end) : 'Present'}`;
}

/**
 * A period at YEAR granularity, for education.
 *
 * Degrees are awarded by year, not by month — "Sep 2018 – May 2022" claims a
 * precision nobody puts on a resume and that the profile no longer collects.
 * Work experience keeps months, where the exact span does matter.
 *
 * Reads the stored DATE in UTC. Education dates are written as YYYY-01-01, and
 * `getFullYear()` on a local timezone west of UTC would render that as the
 * previous year.
 */
export function yearsOf(start: Date | null, end: Date | null): string {
  if (!start && !end) return '';
  const y = (d: Date) => String(d.getUTCFullYear());
  // A single-year entry reads as one year, not "2022 – 2022".
  if (start && end && start.getUTCFullYear() === end.getUTCFullYear()) return y(start);
  return `${start ? y(start) : '?'} – ${end ? y(end) : 'Present'}`;
}




/** What the job list needs to know about a resume without downloading it. */
export interface ResumeStatus {
  jobId: number;
  templateKey: string;
  model: string;
  updatedAt: Date;
  headline: string;
  /** Bullets, skills and titles the model drafted rather than read from notes. */
  inferredCount: number;
  reviewNoteCount: number;
}

/** Total items flagged `inferred` across skills, titles and bullets. */
function countInferred(d: Partial<TailoredResume> | null): number {
  if (!d) return 0;
  const skills = d.skills?.filter((s) => s.inferred).length ?? 0;
  const experience =
    d.experience?.reduce(
      (n, e) => n + (e.titleInferred ? 1 : 0) + (e.bullets?.filter((b) => b.inferred).length ?? 0),
      0,
    ) ?? 0;
  return skills + experience;
}

/**
 * Save one generated resume for a (profile, job).
 *
 * Upsert, not insert: the pairing is unique, so regenerating rewrites the text
 * in place rather than accumulating drafts. The template is deliberately absent
 * from the update — rewriting the words must not discard the design the user
 * applied to this application.
 */
export async function saveResume(input: {
  profileId: number;
  jobId: number;
  userId: number;
  job: { title: string; company: string | null };
  data: object;
  model: string;
}): Promise<boolean> {
  const { profileId, jobId, userId, job, data, model } = input;

  try {
    await prisma.resume.upsert({
      where: { profileId_jobId: { profileId, jobId } },
      create: {
        profileId, jobId, jobTitle: job.title, jobCompany: job.company,
        data: data as never, model,
        templateKey: (await presetService.forProfile(profileId, userId)).key,
      },
      update: {
        data: data as never, model,
        jobTitle: job.title, jobCompany: job.company,
      },
    });
    return true;
  } catch (err) {
    // The generation itself succeeded and is already in the response, so this
    // must not throw — but the caller has to KNOW, or a client that trusts the
    // 200 will show a resume the database never accepted and offer to open a
    // row that does not exist.
    logger.error('Could not save generated resume', { jobId, profileId, err: String(err) });
    return false;
  }
}

export const resumeService = {
  /**
   * The saved resume for this (profile, job), or null. Exactly one can exist.
   *
   * Having none is a normal state rather than an error — the caller renders the
   * generate prompt instead.
   */
  async saved(jobId: number, profileId: number, userId: number) {
    const row = await prisma.resume.findFirst({
      where: { jobId, profileId, profile: usableProfileWhere(userId) },
      select: { id: true, data: true, templateKey: true, model: true, updatedAt: true },
    });
    if (!row) return null;
    // A preset can be archived or renamed after it was applied; `get` falls back
    // for an unknown key, so a mismatch means the stored key is dead and the
    // client should show the fallback as selected rather than a phantom option.
    const preset = await presetService.get(row.templateKey);
    return { ...row, templateKey: preset.key };
  },

  /**
   * Which of `jobIds` already have a resume for this profile.
   *
   * One query for a whole page of jobs rather than one request per card. The
   * full document is deliberately NOT returned — a page of 20 would be hundreds
   * of kilobytes to render a badge — so the counts the list needs are folded
   * down here instead.
   */
  async statusFor(jobIds: number[], profileId: number, userId: number): Promise<Record<number, ResumeStatus>> {
    if (jobIds.length === 0) return {};

    const rows = await prisma.resume.findMany({
      where: { jobId: { in: jobIds }, profileId, profile: usableProfileWhere(userId) },
      select: { jobId: true, templateKey: true, model: true, updatedAt: true, data: true },
    });

    const out: Record<number, ResumeStatus> = {};
    for (const r of rows) {
      // jobId is nullable in the schema (a deleted posting sets it null), so a
      // row can come back without one even though the filter asked for a set.
      if (r.jobId == null) continue;
      const d = r.data as Partial<TailoredResume> | null;
      out[r.jobId] = {
        jobId: r.jobId,
        templateKey: r.templateKey,
        model: r.model,
        updatedAt: r.updatedAt,
        headline: d?.headline ?? '',
        inferredCount: countInferred(d),
        reviewNoteCount: d?.reviewNotes?.length ?? 0,
      };
    }
    return out;
  },

  /**
   * Apply a template to the saved resume for this (profile, job). Scoped to
   * profiles the caller may use, and the key is checked against the catalogue
   * so a dead one cannot be stored.
   */
  async setTemplate(jobId: number, profileId: number, userId: number, key: string): Promise<boolean> {
    if ((await presetService.get(key)).key !== key) return false;
    const r = await prisma.resume.updateMany({
      where: { jobId, profileId, profile: usableProfileWhere(userId) },
      data: { templateKey: key },
    });
    return r.count > 0;
  },

  /**
   * Generate a resume tailored to one posting and save it.
   *
   * The result is upserted onto the single row for this (profile, job), so
   * regenerating replaces the text and the page survives a refresh.
   */

};
