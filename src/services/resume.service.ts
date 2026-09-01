import { prisma } from '../lib/prisma';
import { presetService } from './preset.service';
import { usableProfileWhere } from './profile.service';
import { logger } from '../services/logger.service';
import type { TailoredResume } from '../schemas/resume.schema';

export class ResumeInputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

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

export function yearsOf(start: Date | null, end: Date | null): string {
  if (!start && !end) return '';
  const y = (d: Date) => String(d.getUTCFullYear());
  // A single-year entry reads as one year, not "2022 – 2022".
  if (start && end && start.getUTCFullYear() === end.getUTCFullYear()) return y(start);
  return `${start ? y(start) : '?'} – ${end ? y(end) : 'Present'}`;
}

export interface ResumeStatus {
  jobId: number;
  templateKey: string;
  model: string;
  updatedAt: Date;
  headline: string;
  inferredCount: number;
  reviewNoteCount: number;
}

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
    // The profile's CURRENT template. Read as the raw key rather than through
    // `forProfile`, which resolves an unset default to the fallback preset —
    // and "the profile has no default" has to stay distinguishable from "the
    // default is the fallback", or a regenerate below would restyle a resume
    // whose profile never expressed a preference.
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ...usableProfileWhere(userId) },
      select: { defaultTemplateKey: true },
    });
    const defaultKey = profile?.defaultTemplateKey ?? null;
    // Resolved once, and through `get` so an archived or renamed key lands on
    // the fallback instead of being written back as a dead reference.
    const resolvedKey = (await presetService.get(defaultKey)).key;

    await prisma.resume.upsert({
      where: { profileId_jobId: { profileId, jobId } },
      create: {
        profileId, jobId, jobTitle: job.title, jobCompany: job.company,
        data: data as never, model,
        templateKey: resolvedKey,
      },
      update: {
        data: data as never, model,
        jobTitle: job.title, jobCompany: job.company,
        // Regeneration rebuilds the document from the profile as it stands NOW,
        // so it picks up a template changed since the first run. Without this
        // the row kept the key it was CREATED with: change the profile default,
        // regenerate, and the old template came back — the row was updated
        // everywhere except here.
        //
        // Only when the profile actually has a default. Writing the fallback
        // over a resume belonging to a profile with none would silently
        // restyle it, which is a different bug in the opposite direction.
        ...(defaultKey ? { templateKey: resolvedKey } : {}),
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
