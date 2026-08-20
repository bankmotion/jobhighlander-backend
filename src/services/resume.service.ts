import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { prisma } from '../lib/prisma';
import { anthropic, MODEL } from '../lib/anthropic';
import { presetService } from './preset.service';
import { promptService } from './prompt.service';
import { aiUsageService } from './aiUsage.service';
import { usableProfileWhere } from './profile.service';
import { logger } from '../services/logger.service';
import { tailoredResumeSchema, type TailoredResume, type PreviewRequest } from '../schemas/resume.schema';

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

function periodOf(start: Date | null, end: Date | null): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (!start && !end) return '';
  return `${start ? fmt(start) : '?'} – ${end ? fmt(end) : 'Present'}`;
}


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
async function saveResume(input: {
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
  async preview(
    { jobId, profileId, notes }: PreviewRequest,
    userId: number,
  ): Promise<TailoredResume & { saved: boolean }> {
    const [job, profile] = await Promise.all([
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
    ]);

    if (!job) throw new ResumeInputError('Job not found', 404);
    // findFirst is owner-scoped, so "not found" and "not yours" are the same 404.
    if (!profile) throw new ResumeInputError('Profile not found', 404);

    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    const contact = [profile.email, profile.phone, profile.location, profile.linkedin]
      .filter(Boolean)
      .join(' | ');

    // Employment and education rows carry dates the free-text notes usually get
    // wrong, so they are stated as authoritative and the model is told to trust
    // them over anything contradictory in the notes.
    const employment = profile.workExperiences
      .map((w) => `- ${w.company ?? '(company not recorded)'}${w.location ? `, ${w.location}` : ''} — ${periodOf(w.startDate, w.endDate)}`)
      .join('\n');

    const education = profile.educations
      .map((e) => `- ${[e.degree, e.university].filter(Boolean).join(', ')}${e.location ? ` (${e.location})` : ''} — ${periodOf(e.startDate, e.endDate)}`)
      .join('\n');

    // Only include the notes section when there is something in it. An empty
    // quoted block reads to the model as "the candidate stated nothing, and
    // that emptiness is meaningful", which suppresses the inference we want.
    const notesBlock = notes.trim()
      ? `The candidate's own notes. These OUTRANK your inference wherever they
touch — reword and reorder them, never overwrite them:
"""
${notes.trim()}
"""`
      : `The candidate supplied no notes. Draft the titles, responsibilities and
skills yourself from the employment history above and the posting below, and
flag every one of them inferred=true.`;

    // Stable across every posting this candidate applies to → cached prefix.
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

Produce the tailored resume now.`;

    const res = await anthropic()
      .messages.parse({
      model: MODEL,
      max_tokens: 16_000,
      // No `effort` here: Haiku 4.5 REJECTS output_config.effort with a 400.
      // Restore `effort: 'medium'` alongside MODEL if this moves back to Opus
      // or Sonnet, where it is the main lever on output-token spend.
      output_config: { format: zodOutputFormat(tailoredResumeSchema) },
      // The candidate block still comes BEFORE the posting, because the
      // candidate is stable across applications and the posting is not — that
      // ordering is what makes a cache breakpoint possible at all.
      //
      // But there is no breakpoint here, because on Haiku 4.5 one cannot work:
      // caching needs a 4096-token prefix on this model, and system prompt plus
      // candidate block measured ~3.4k on real runs. A breakpoint below the
      // minimum caches nothing and reports nothing — it silently does nothing at
      // all, which is worse than not writing it. Restore
      // `cache_control: { type: 'ephemeral' }` on the candidate block when MODEL
      // goes back to Opus or Sonnet (512 and 1024-token minimums respectively).
      system: [
        { type: 'text', text: await promptService.text('resume.system') },
        { type: 'text', text: candidateBlock },
      ],
      messages: [{ role: 'user', content: jobBlock }],
      })
      .catch(mapProviderError);

    // Recorded HERE, before the refusal and parse checks, because a response
    // that arrives is a response that was billed. A refusal or an unparseable
    // output still consumed the prompt; accounting for spend only on the happy
    // path would quietly under-report the bill by exactly the calls that went
    // wrong. Never throws, so it cannot cost the user the resume below.
    await aiUsageService.record({
      feature: 'resume',
      model: MODEL,
      userId,
      profileId,
      jobId,
      usage: res.usage,
    });

    if (res.stop_reason === 'refusal') {
      logger.warn('Resume generation refused', { jobId, category: res.stop_details?.category });
      throw new ResumeInputError('The model declined this request.', 422);
    }
    if (!res.parsed_output) {
      logger.error('Resume generation returned no parsed output', { jobId, stop: res.stop_reason });
      throw new ResumeInputError('Generation did not return a usable resume. Try again.', 502);
    }

    // A save failure must not lose the resume the user just waited for — it is
    // already in the response — but the outcome travels with it so the caller
    // does not present an unsaved draft as stored.
    const saved = await saveResume({
      profileId, jobId, userId, job,
      data: res.parsed_output as object,
      model: MODEL,
    });

    logger.info('Resume generated', {
      jobId,
      profileId,
      usage: res.usage,
      gaps: res.parsed_output.gaps.length,
      reviewNotes: res.parsed_output.reviewNotes.length,
    });
    return { ...res.parsed_output, saved };
  },
};
