import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';

/** Where the process as a whole stands. */
export type InterviewStatus =
  | 'active'
  | 'offer'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'ghosted'
  | 'on_hold';

/** How one step went. `pending` covers both "upcoming" and "no news yet". */
export type StepResult = 'pending' | 'passed' | 'failed' | 'cancelled';

export interface StageBadge {
  id: number;
  key: string;
  name: string;
  color: string;
  /** Archived types still render on steps that already wear them. */
  archived: boolean;
}

export interface PanelRow {
  id: number;
  title: string | null;
  note: string | null;
  meetingUrl: string | null;
  /** UTC instant, or null when nothing is scheduled yet. */
  scheduledAt: Date | null;
  /** IANA zone the invitation was written in; pairs with `scheduledAt`. */
  timezone: string | null;
  durationMin: number | null;
  sortOrder: number;
}

export interface StepRow {
  id: number;
  title: string | null;
  result: StepResult;
  sortOrder: number;
  stages: StageBadge[];
  panels: PanelRow[];
  /**
   * The marker on the rail: the earliest `scheduledAt` among this step's
   * panels, or null when none of them has a time yet.
   *
   * Derived here rather than stored, and derived HERE rather than in the
   * component, so the rail and any future agenda view can never disagree about
   * when a step happened.
   */
  date: Date | null;
}

export interface InterviewDetail {
  id: number;
  profileId: number;
  jobId: number | null;
  jobTitle: string;
  jobCompany: string | null;
  status: InterviewStatus;
  lastActivityAt: Date;
  openedBy: string;
  steps: StepRow[];
}

/** One upcoming sitting, across every process the caller can see. */
export interface UpcomingPanel {
  panelId: number;
  interviewId: number;
  jobId: number | null;
  jobTitle: string;
  jobCompany: string | null;
  stepTitle: string | null;
  stages: StageBadge[];
  scheduledAt: Date;
  timezone: string | null;
  durationMin: number | null;
  meetingUrl: string | null;
}

/** Raised for a rejected write; the route turns it into a status code. */
export class InterviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'InterviewError';
  }
}

/** Nested select for a whole timeline, used by every read below. */
const detailSelect = {
  id: true,
  profileId: true,
  jobId: true,
  jobTitle: true,
  jobCompany: true,
  status: true,
  lastActivityAt: true,
  openedBy: { select: { email: true } },
  steps: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      title: true,
      result: true,
      sortOrder: true,
      stages: {
        orderBy: { sortOrder: 'asc' as const },
        select: {
          stageType: {
            select: { id: true, key: true, name: true, color: true, archived: true },
          },
        },
      },
      panels: {
        orderBy: { sortOrder: 'asc' as const },
        select: {
          id: true,
          title: true,
          note: true,
          meetingUrl: true,
          scheduledAt: true,
          timezone: true,
          durationMin: true,
          sortOrder: true,
        },
      },
    },
  },
};

type RawInterview = {
  id: number;
  profileId: number;
  jobId: number | null;
  jobTitle: string;
  jobCompany: string | null;
  status: string;
  lastActivityAt: Date;
  openedBy: { email: string };
  steps: {
    id: number;
    title: string | null;
    result: string;
    sortOrder: number;
    stages: { stageType: StageBadge }[];
    panels: PanelRow[];
  }[];
};

/** Flatten the join rows and derive each step's date. */
function shape(row: RawInterview): InterviewDetail {
  return {
    id: row.id,
    profileId: row.profileId,
    jobId: row.jobId,
    jobTitle: row.jobTitle,
    jobCompany: row.jobCompany,
    status: row.status as InterviewStatus,
    lastActivityAt: row.lastActivityAt,
    openedBy: row.openedBy.email,
    steps: row.steps.map((s) => {
      const times = s.panels
        .map((p) => p.scheduledAt)
        .filter((d): d is Date => d != null)
        .map((d) => d.getTime());
      return {
        id: s.id,
        title: s.title,
        result: s.result as StepResult,
        sortOrder: s.sortOrder,
        stages: s.stages.map((x) => x.stageType),
        panels: s.panels,
        date: times.length ? new Date(Math.min(...times)) : null,
      };
    }),
  };
}

/**
 * Interview timelines.
 *
 * Every method is scoped through `usableProfileWhere`, exactly like
 * `applicationService`: a user reaches a timeline through a profile they own OR
 * one they were invited to. A shared profile's whole team works one process
 * together, so this is not an ownership check but a "may you use this profile"
 * check — the same rule that governs marking applied and generating a resume.
 */
export const interviewService = {
  /**
   * Open a timeline for a job this profile has applied to.
   *
   * Requires the `JobApplication` to exist. That is the ONLY place the
   * applied-first rule is enforced — `interviews` has no foreign key to
   * `job_applications`, deliberately, so that undoing an applied mark cannot
   * cascade a whole interview history into nothing.
   *
   * Idempotent: opening twice returns the existing timeline rather than
   * failing, so a double-click or a stale tab does not surface an error.
   */
  async open(jobId: number, profileId: number, userId: number): Promise<InterviewDetail> {
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ...usableProfileWhere(userId) },
      select: { id: true },
    });
    // A profile they may not use and one that does not exist are the same 404,
    // so the endpoint never confirms which profile ids are real.
    if (!profile) throw new InterviewError('Profile not found', 404);

    const existing = await prisma.interview.findUnique({
      where: { profileId_jobId: { profileId, jobId } },
      select: { id: true },
    });
    if (existing) return this.get(existing.id, userId);

    const application = await prisma.jobApplication.findUnique({
      where: { profileId_jobId: { profileId, jobId } },
      select: { jobTitle: true, jobCompany: true },
    });
    if (!application) {
      throw new InterviewError('Mark this job as applied before tracking interviews', 409);
    }

    const created = await prisma.interview.create({
      data: {
        profileId,
        jobId,
        // Copied from the application, not re-read from `jobs`: the application
        // already froze the title at the moment it was sent, and that is the
        // posting this process is about even if the listing has since changed.
        jobTitle: application.jobTitle,
        jobCompany: application.jobCompany,
        openedById: userId,
      },
      select: { id: true },
    });
    return this.get(created.id, userId);
  },

  /** One timeline by id, or a 404 if the caller may not see it. */
  async get(id: number, userId: number): Promise<InterviewDetail> {
    const row = await prisma.interview.findFirst({
      where: { id, profile: usableProfileWhere(userId) },
      select: detailSelect,
    });
    if (!row) throw new InterviewError('Interview not found', 404);
    return shape(row as RawInterview);
  },

  /** The timeline for one (job, profile), or null when none has been opened. */
  async forJob(jobId: number, profileId: number, userId: number): Promise<InterviewDetail | null> {
    const row = await prisma.interview.findFirst({
      where: { jobId, profileId, profile: usableProfileWhere(userId) },
      select: detailSelect,
    });
    return row ? shape(row as RawInterview) : null;
  },

  /**
   * Which of `jobIds` this profile has a timeline for. One query for a whole
   * page, mirroring `applicationService.statusFor`, so the list can badge cards
   * without a request each.
   */
  async statusFor(
    jobIds: number[],
    profileId: number,
    userId: number,
  ): Promise<Record<number, { interviewId: number; status: InterviewStatus; steps: number }>> {
    if (jobIds.length === 0) return {};
    const rows = await prisma.interview.findMany({
      where: { jobId: { in: jobIds }, profileId, profile: usableProfileWhere(userId) },
      select: { id: true, jobId: true, status: true, _count: { select: { steps: true } } },
    });
    const out: Record<number, { interviewId: number; status: InterviewStatus; steps: number }> = {};
    for (const r of rows) {
      // jobId is nullable (a deleted posting sets it null), so a row can come
      // back without one even though the filter asked for a set.
      if (r.jobId == null) continue;
      out[r.jobId] = {
        interviewId: r.id,
        status: r.status as InterviewStatus,
        steps: r._count.steps,
      };
    }
    return out;
  },

  /** Move the whole process to a new status. */
  async setStatus(id: number, status: InterviewStatus, userId: number): Promise<InterviewDetail> {
    await assertInterview(id, userId);
    await prisma.interview.update({
      where: { id },
      data: { status, lastActivityAt: new Date() },
    });
    return this.get(id, userId);
  },

  /** Delete a timeline and everything under it. */
  async remove(id: number, userId: number): Promise<boolean> {
    await assertInterview(id, userId);
    await prisma.interview.delete({ where: { id } });
    return true;
  },

  /**
   * Insert a step at `position` (0 = before the first, n = after the last).
   *
   * The shift-then-insert is one UPDATE plus one INSERT inside a transaction,
   * which keeps `sortOrder` contiguous without rewriting rows that did not
   * move. Contiguity is what lets the UI place an insert button in every gap
   * and pass the gap's index straight through as `position`.
   */
  async addStep(
    interviewId: number,
    input: { position?: number; title?: string | null; stageTypeIds?: number[] },
    userId: number,
  ): Promise<InterviewDetail> {
    await assertInterview(interviewId, userId);
    const count = await prisma.interviewStep.count({ where: { interviewId } });
    const position = clamp(input.position ?? count, 0, count);
    const stageTypeIds = await existingStageTypeIds(input.stageTypeIds ?? []);

    await prisma.$transaction(async (tx) => {
      await tx.interviewStep.updateMany({
        where: { interviewId, sortOrder: { gte: position } },
        data: { sortOrder: { increment: 1 } },
      });
      await tx.interviewStep.create({
        data: {
          interviewId,
          title: clean(input.title),
          sortOrder: position,
          stages: {
            create: stageTypeIds.map((stageTypeId, i) => ({ stageTypeId, sortOrder: i })),
          },
        },
      });
      await tx.interview.update({
        where: { id: interviewId },
        data: { lastActivityAt: new Date() },
      });
    });
    return this.get(interviewId, userId);
  },

  /**
   * Update a step. `stageTypeIds` REPLACES the badge set when present and is
   * left alone when absent — the picker always submits the full set, so a
   * merge would make removing the last badge impossible.
   */
  async updateStep(
    stepId: number,
    input: { title?: string | null; result?: StepResult; stageTypeIds?: number[] },
    userId: number,
  ): Promise<InterviewDetail> {
    const step = await assertStep(stepId, userId);

    await prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = clean(input.title);
      if (input.result !== undefined) data.result = input.result;
      if (Object.keys(data).length > 0) {
        await tx.interviewStep.update({ where: { id: stepId }, data });
      }
      if (input.stageTypeIds !== undefined) {
        const ids = await existingStageTypeIds(input.stageTypeIds);
        await tx.interviewStepStage.deleteMany({ where: { stepId } });
        if (ids.length > 0) {
          await tx.interviewStepStage.createMany({
            data: ids.map((stageTypeId, i) => ({ stepId, stageTypeId, sortOrder: i })),
          });
        }
      }
      await tx.interview.update({
        where: { id: step.interviewId },
        data: { lastActivityAt: new Date() },
      });
    });
    return this.get(step.interviewId, userId);
  },

  /** Delete a step (and its panels), closing the gap it leaves in the order. */
  async removeStep(stepId: number, userId: number): Promise<InterviewDetail> {
    const step = await assertStep(stepId, userId);

    await prisma.$transaction(async (tx) => {
      await tx.interviewStep.delete({ where: { id: stepId } });
      await tx.interviewStep.updateMany({
        where: { interviewId: step.interviewId, sortOrder: { gt: step.sortOrder } },
        data: { sortOrder: { decrement: 1 } },
      });
      await tx.interview.update({
        where: { id: step.interviewId },
        data: { lastActivityAt: new Date() },
      });
    });
    return this.get(step.interviewId, userId);
  },

  /** Insert a panel at `position` within its step. Same shift as `addStep`. */
  async addPanel(
    stepId: number,
    input: { position?: number } & PanelInput,
    userId: number,
  ): Promise<InterviewDetail> {
    const step = await assertStep(stepId, userId);
    const count = await prisma.interviewPanel.count({ where: { stepId } });
    const position = clamp(input.position ?? count, 0, count);

    await prisma.$transaction(async (tx) => {
      await tx.interviewPanel.updateMany({
        where: { stepId, sortOrder: { gte: position } },
        data: { sortOrder: { increment: 1 } },
      });
      await tx.interviewPanel.create({
        data: { stepId, sortOrder: position, ...panelData(input) },
      });
      await tx.interview.update({
        where: { id: step.interviewId },
        data: { lastActivityAt: new Date() },
      });
    });
    return this.get(step.interviewId, userId);
  },

  /**
   * Update a panel. Only the keys present in `input` are written, so clearing
   * a field means sending it as null — an absent key leaves it untouched.
   * Every field being optional, that distinction is the whole contract here.
   */
  async updatePanel(panelId: number, input: PanelInput, userId: number): Promise<InterviewDetail> {
    const panel = await assertPanel(panelId, userId);
    const data = panelData(input);

    if (Object.keys(data).length > 0) {
      await prisma.interviewPanel.update({ where: { id: panelId }, data });
    }
    await prisma.interview.update({
      where: { id: panel.interviewId },
      data: { lastActivityAt: new Date() },
    });
    return this.get(panel.interviewId, userId);
  },

  /** Delete a panel, closing the gap in its step's order. */
  async removePanel(panelId: number, userId: number): Promise<InterviewDetail> {
    const panel = await assertPanel(panelId, userId);

    await prisma.$transaction(async (tx) => {
      await tx.interviewPanel.delete({ where: { id: panelId } });
      await tx.interviewPanel.updateMany({
        where: { stepId: panel.stepId, sortOrder: { gt: panel.sortOrder } },
        data: { sortOrder: { decrement: 1 } },
      });
      await tx.interview.update({
        where: { id: panel.interviewId },
        data: { lastActivityAt: new Date() },
      });
    });
    return this.get(panel.interviewId, userId);
  },

  /**
   * Everything scheduled in the next `days`, across every process the caller
   * can reach. Reads `interview_panels.scheduled_at` through its own index.
   *
   * Closed processes are excluded: a sitting on a withdrawn or rejected
   * application is not something to prepare for.
   */
  async upcoming(userId: number, days = 7): Promise<UpcomingPanel[]> {
    const now = new Date();
    const until = new Date(now.getTime() + days * 86_400_000);

    const rows = await prisma.interviewPanel.findMany({
      where: {
        scheduledAt: { gte: now, lte: until },
        step: {
          interview: {
            profile: usableProfileWhere(userId),
            status: { in: ['active', 'offer', 'on_hold'] },
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true,
        scheduledAt: true,
        timezone: true,
        durationMin: true,
        meetingUrl: true,
        step: {
          select: {
            title: true,
            stages: {
              orderBy: { sortOrder: 'asc' },
              select: {
                stageType: { select: { id: true, key: true, name: true, color: true, archived: true } },
              },
            },
            interview: { select: { id: true, jobId: true, jobTitle: true, jobCompany: true } },
          },
        },
      },
    });

    return rows.map((r) => ({
      panelId: r.id,
      interviewId: r.step.interview.id,
      jobId: r.step.interview.jobId,
      jobTitle: r.step.interview.jobTitle,
      jobCompany: r.step.interview.jobCompany,
      stepTitle: r.step.title,
      stages: r.step.stages.map((s) => s.stageType),
      scheduledAt: r.scheduledAt!,
      timezone: r.timezone,
      durationMin: r.durationMin,
      meetingUrl: r.meetingUrl,
    }));
  },

  /**
   * Every timeline the caller can reach, newest activity first. Backs the
   * `/interviews` index — one row per process, no steps loaded.
   */
  async list(userId: number, profileId?: number) {
    const rows = await prisma.interview.findMany({
      where: {
        profile: usableProfileWhere(userId),
        ...(profileId ? { profileId } : {}),
      },
      orderBy: { lastActivityAt: 'desc' },
      select: {
        id: true,
        profileId: true,
        jobId: true,
        jobTitle: true,
        jobCompany: true,
        status: true,
        lastActivityAt: true,
        _count: { select: { steps: true } },
        profile: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      profileId: r.profileId,
      profileName:
        [r.profile.firstName, r.profile.lastName].filter(Boolean).join(' ') ||
        r.profile.email ||
        `Profile #${r.profileId}`,
      jobId: r.jobId,
      jobTitle: r.jobTitle,
      jobCompany: r.jobCompany,
      status: r.status as InterviewStatus,
      lastActivityAt: r.lastActivityAt,
      steps: r._count.steps,
      /**
       * No movement in three weeks on a live process. Not a status the user
       * set — a hint the UI shows so a silently-dropped application surfaces
       * instead of sitting in the list looking healthy forever.
       */
      stale:
        r.status === 'active' && Date.now() - r.lastActivityAt.getTime() > 21 * 86_400_000,
    }));
  },
};

/** The writable panel fields. Absent = leave alone; null = clear. */
export interface PanelInput {
  title?: string | null;
  note?: string | null;
  meetingUrl?: string | null;
  scheduledAt?: Date | null;
  timezone?: string | null;
  durationMin?: number | null;
}

/** Build a Prisma `data` object containing only the keys actually supplied. */
function panelData(input: PanelInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = clean(input.title);
  if (input.note !== undefined) data.note = clean(input.note);
  if (input.meetingUrl !== undefined) data.meetingUrl = clean(input.meetingUrl);
  if (input.scheduledAt !== undefined) data.scheduledAt = input.scheduledAt;
  if (input.timezone !== undefined) data.timezone = clean(input.timezone);
  if (input.durationMin !== undefined) data.durationMin = input.durationMin;
  return data;
}

/**
 * Trim, and treat an emptied box as cleared rather than as the empty string.
 *
 * Both read as "nothing" in the UI, but only null sorts and counts as absent —
 * an empty string would make `note IS NOT NULL` true for a card with no note.
 */
function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Drop ids that no longer exist, so a stale picker cannot fail the whole write. */
async function existingStageTypeIds(ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const found = await prisma.interviewStageType.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  const ok = new Set(found.map((f) => f.id));
  return unique.filter((id) => ok.has(id));
}

/** 404 unless the caller may use the profile this timeline belongs to. */
async function assertInterview(id: number, userId: number): Promise<{ id: number }> {
  const row = await prisma.interview.findFirst({
    where: { id, profile: usableProfileWhere(userId) },
    select: { id: true },
  });
  if (!row) throw new InterviewError('Interview not found', 404);
  return row;
}

/** Same check one level down, returning what the reorder needs. */
async function assertStep(
  stepId: number,
  userId: number,
): Promise<{ id: number; interviewId: number; sortOrder: number }> {
  const row = await prisma.interviewStep.findFirst({
    where: { id: stepId, interview: { profile: usableProfileWhere(userId) } },
    select: { id: true, interviewId: true, sortOrder: true },
  });
  if (!row) throw new InterviewError('Step not found', 404);
  return row;
}

/** Same check two levels down. */
async function assertPanel(
  panelId: number,
  userId: number,
): Promise<{ id: number; stepId: number; interviewId: number; sortOrder: number }> {
  const row = await prisma.interviewPanel.findFirst({
    where: { id: panelId, step: { interview: { profile: usableProfileWhere(userId) } } },
    select: { id: true, stepId: true, sortOrder: true, step: { select: { interviewId: true } } },
  });
  if (!row) throw new InterviewError('Panel not found', 404);
  return {
    id: row.id,
    stepId: row.stepId,
    interviewId: row.step.interviewId,
    sortOrder: row.sortOrder,
  };
}
