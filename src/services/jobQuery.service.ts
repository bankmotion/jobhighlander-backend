import { prisma } from '../lib/prisma';
import { providerOf, providerLabelOf, resolveProvider, type AiProvider } from '../lib/ai';
import { AiOutputError, textCall } from '../lib/generate';
import { logger } from './logger.service';
import { promptService } from './prompt.service';
import { aiUsageService } from './aiUsage.service';
import { usableProfileWhere } from './profile.service';
import { billingService } from './billing.service';
import { periodOf, yearsOf, profileIdentity, ResumeInputError } from './resume.service';
import type { TailoredResume } from '../schemas/resume.schema';

export type QueryContext = {
  profile: boolean;
  resume: boolean;
  coverLetter: boolean;
};

export interface JobQueryRow {
  id: number;
  jobId: number | null;
  jobTitle: string;
  jobCompany: string | null;
  question: string;
  answer: string;
  model: string;
  /** Derived from `model`, so answers written before providers existed still label. */
  provider: AiProvider | null;
  providerLabel: string;
  context: QueryContext;
  askedBy: string;
  createdAt: Date;
}

const JOB_DESCRIPTION_LIMIT = 24_000;

const MAX_ANSWER_TOKENS = 3_000;

const rowSelect = {
  id: true,
  jobId: true,
  jobTitle: true,
  jobCompany: true,
  question: true,
  answer: true,
  model: true,
  context: true,
  createdAt: true,
  askedBy: { select: { email: true } },
} as const;

type RawRow = {
  id: number;
  jobId: number | null;
  jobTitle: string;
  jobCompany: string | null;
  question: string;
  answer: string;
  model: string;
  context: unknown;
  createdAt: Date;
  askedBy: { email: string };
};

function shape(r: RawRow): JobQueryRow {
  const c = (r.context ?? {}) as Partial<QueryContext>;
  return {
    id: r.id,
    jobId: r.jobId,
    jobTitle: r.jobTitle,
    jobCompany: r.jobCompany,
    question: r.question,
    answer: r.answer,
    model: r.model,
    provider: providerOf(r.model),
    providerLabel: providerLabelOf(r.model),
    context: {
      profile: Boolean(c.profile),
      resume: Boolean(c.resume),
      coverLetter: Boolean(c.coverLetter),
    },
    askedBy: r.askedBy.email,
    createdAt: r.createdAt,
  };
}

export const jobQueryService = {
  async ask(
    jobId: number,
    profileId: number,
    questionRaw: string,
    userId: number,
    provider?: AiProvider,
  ): Promise<JobQueryRow> {
    const question = questionRaw.trim();
    if (!question) throw new ResumeInputError('Ask a question first', 400);

    // Resolved before the reads, same as generation: an unusable provider is a
    // configuration answer, not something to discover after four queries.
    const chosen = resolveProvider(provider);

    const [job, profile, resume, coverLetter] = await Promise.all([
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
      prisma.resume.findUnique({
        where: { profileId_jobId: { profileId, jobId } },
        select: { data: true },
      }),
      prisma.coverLetter.findUnique({
        where: { profileId_jobId: { profileId, jobId } },
        select: { body: true },
      }),
    ]);

    if (!job) throw new ResumeInputError('Job not found', 404);
    // A profile they may not use and one that does not exist are the same 404,
    // so the endpoint never confirms which profile ids are real.
    if (!profile) throw new ResumeInputError('Profile not found', 404);
    // Same gate as resume generation: Ask AI is a billable call too, and a
    // profile that may not spend must not spend here either.
    if (!profile.aiEnabled) {
      throw new ResumeInputError(
        'AI is switched off for this profile. Ask a super admin to enable it.',
        403,
      );
    }
    // Same gate as generation: Ask AI is a billable call and spends the same
    // balance. See generation.service.ts for why a positive balance is the bar.
    const funded = await billingService.balanceOf(userId);
    if (!funded.canSpend) {
      throw new ResumeInputError(
        `Your balance is $${funded.balanceUsd.toFixed(2)}. Top up with USDT to keep using the AI.`,
        402,
      );
    }

    const context: QueryContext = {
      profile: true,
      resume: Boolean(resume),
      coverLetter: Boolean(coverLetter),
    };

    const { name, contact } = profileIdentity(profile);

    const employment = profile.workExperiences
      .map(
        (w) =>
          `- ${w.company ?? '(company not recorded)'}${w.location ? `, ${w.location}` : ''} — ${periodOf(w.startDate, w.endDate)}`,
      )
      .join('\n');
    const education = profile.educations
      .map(
        (e) =>
          `- ${[e.degree, e.university].filter(Boolean).join(', ')}${e.location ? ` (${e.location})` : ''} — ${
            e.datePrecision === 'year' ? yearsOf(e.startDate, e.endDate) : periodOf(e.startDate, e.endDate)
          }`,
      )
      .join('\n');

    const resumeBlock = resume
      ? `TAILORED RESUME already generated for this posting (JSON):\n"""\n${JSON.stringify(
          resume.data as TailoredResume,
        ).slice(0, 20_000)}\n"""`
      : 'No tailored resume has been generated for this posting yet.';

    const letterBlock = coverLetter
      ? `COVER LETTER already generated for this posting:\n"""\n${coverLetter.body.slice(0, 8_000)}\n"""`
      : 'No cover letter has been generated for this posting yet.';

    const contextBlock = `CANDIDATE RECORD

Name: ${name || '(not recorded)'}
Contact: ${contact || '(not recorded)'}

Employment history — employers and dates are FIXED FACTS:
${employment || '(none recorded)'}

Education — fixed facts:
${education || '(none recorded)'}

${resumeBlock}

${letterBlock}

JOB POSTING

Title: ${job.title}
Company: ${job.company ?? '(not stated)'}
Location: ${job.location ?? '(not stated)'}

Description:
"""
${job.description.slice(0, JOB_DESCRIPTION_LIMIT)}
"""`;

    // Prose rather than a schema: the answer is read by a person, and forcing
    // it through a JSON envelope would buy nothing and cost tokens on both
    // sides. Prompt first, context second, question last — the only part that
    // changes between questions about one posting is the question itself.
    //
    // Cached, because that repetition is the whole shape of this feature: the
    // panel offers four suggested questions and people ask several in a row.
    // Once a resume and letter exist the prefix measures ~4.9k tokens and up to
    // ~9.8k with every field at its cap, so it clears the 4096 Haiku needs;
    // a bare posting falls short and simply does not cache. Worst case is a
    // 1.25x write on one unrepeated question — fractions of a cent — against a
    // 90% discount on every follow-up within the window.
    const call = await textCall({
      provider: chosen,
      system: [await promptService.text('job.query.system'), contextBlock],
      user: question,
      maxTokens: MAX_ANSWER_TOKENS,
      cacheSystem: true,
    }).catch((err) => {
      if (err instanceof AiOutputError) {
        if (err.kind === 'refused') logger.warn('Job query refused', { jobId, profileId });
        throw new ResumeInputError(err.message, err.kind === 'refused' ? 422 : 502);
      }
      throw err;
    });

    // Recorded before anything else: a response that arrives is a response that
    // was billed, whether or not it turns out to be usable.
    await aiUsageService.record({
      feature: 'job_query',
      model: call.model,
      userId,
      profileId,
      jobId,
      usage: call.usage,
    });

    const answer = call.output;

    const created = await prisma.jobAiQuery.create({
      data: {
        profileId,
        jobId,
        // Frozen at ask time, so the log still names its posting after a prune.
        jobTitle: job.title,
        jobCompany: job.company,
        question,
        answer,
        model: call.model,
        context,
        askedById: userId,
      },
      select: rowSelect,
    });

    logger.info('Job query answered', {
      jobId,
      profileId,
      provider: chosen,
      model: call.model,
      chars: answer.length,
      context,
      usage: call.usage,
    });

    return shape(created as RawRow);
  },

  async list(jobId: number, profileId: number, userId: number): Promise<JobQueryRow[]> {
    const rows = await prisma.jobAiQuery.findMany({
      where: { jobId, profileId, profile: usableProfileWhere(userId) },
      orderBy: { createdAt: 'desc' },
      select: rowSelect,
    });
    return rows.map((r) => shape(r as RawRow));
  },

  async countsFor(
    jobIds: number[],
    profileId: number,
    userId: number,
  ): Promise<Record<number, number>> {
    if (jobIds.length === 0) return {};
    const rows = await prisma.jobAiQuery.groupBy({
      by: ['jobId'],
      where: { jobId: { in: jobIds }, profileId, profile: usableProfileWhere(userId) },
      _count: { _all: true },
    });
    const out: Record<number, number> = {};
    for (const r of rows) {
      // jobId is nullable (a pruned posting sets it null), so a row can come
      // back without one even though the filter asked for a set.
      if (r.jobId == null) continue;
      out[r.jobId] = r._count._all;
    }
    return out;
  },

  async remove(id: number, userId: number): Promise<boolean> {
    const row = await prisma.jobAiQuery.findFirst({
      where: { id, profile: usableProfileWhere(userId) },
      select: { id: true },
    });
    if (!row) return false;
    await prisma.jobAiQuery.delete({ where: { id } });
    return true;
  },
};

