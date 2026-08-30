import { prisma } from '../lib/prisma';
import { anthropic, MODEL } from '../lib/anthropic';
import { logger } from './logger.service';
import { promptService } from './prompt.service';
import { aiUsageService } from './aiUsage.service';
import { usableProfileWhere } from './profile.service';
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
  ): Promise<JobQueryRow> {
    const question = questionRaw.trim();
    if (!question) throw new ResumeInputError('Ask a question first', 400);

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

    const res = await anthropic()
      .messages.create({
        model: MODEL,
        max_tokens: MAX_ANSWER_TOKENS,
        // Plain text, not a parsed schema: the answer is prose a person reads,
        // and forcing it through a JSON envelope would buy nothing and cost
        // tokens on both sides.
        //
        // No `effort` and no `cache_control`: Haiku 4.5 rejects the first and
        // needs a 4096-token prefix before caching engages, so a breakpoint
        // here would silently do nothing. See lib/anthropic.ts.
        system: [
          { type: 'text', text: await promptService.text('job.query.system') },
          { type: 'text', text: contextBlock },
        ],
        messages: [{ role: 'user', content: question }],
      })
      .catch(mapProviderError);

    // Recorded before the content checks: a response that arrives is a response
    // that was billed, whether or not it turns out to be usable.
    await aiUsageService.record({
      feature: 'job_query',
      model: MODEL,
      userId,
      profileId,
      jobId,
      usage: res.usage,
    });

    // Narrowed inline rather than with a type predicate: the SDK's union
    // includes blocks that carry no `text` at all, and a hand-written guard has
    // to match `ContentBlock` exactly to be assignable.
    const answer = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();

    if (res.stop_reason === 'refusal') {
      logger.warn('Job query refused', { jobId, profileId });
      throw new ResumeInputError('The model declined this question.', 422);
    }
    if (!answer) {
      logger.error('Job query returned no text', { jobId, stop: res.stop_reason });
      throw new ResumeInputError('The AI returned an empty answer. Try rephrasing.', 502);
    }

    const created = await prisma.jobAiQuery.create({
      data: {
        profileId,
        jobId,
        // Frozen at ask time, so the log still names its posting after a prune.
        jobTitle: job.title,
        jobCompany: job.company,
        question,
        answer,
        model: MODEL,
        context,
        askedById: userId,
      },
      select: rowSelect,
    });

    logger.info('Job query answered', {
      jobId,
      profileId,
      chars: answer.length,
      context,
      usage: res.usage,
      truncated: res.stop_reason === 'max_tokens',
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
