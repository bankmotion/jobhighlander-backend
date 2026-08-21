import { prisma } from '../lib/prisma';
import { usableProfileWhere } from './profile.service';

/** What the list needs to render the badge, without joining the whole row. */
export interface DiscardStatus {
  jobId: number;
  discardedAt: Date;
  /** Email of whoever dismissed it — a shared profile has more than one user. */
  discardedBy: string;
}

/** Keyed by job id. A job nobody discarded is simply absent. */
export type DiscardStatusMap = Record<number, DiscardStatus>;

/** Raised for a rejected discard; the route turns it into a status code. */
export class DiscardError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DiscardError';
  }
}

/**
 * "Discarded" markers — this posting is not for this candidate.
 *
 * A deliberate twin of `applicationService`: same scoping through
 * `usableProfileWhere`, same idempotent mark/unmark pair, same batch status
 * lookup. The two record opposite judgements about the same pairing and are
 * kept structurally identical so neither drifts into a different permission
 * model than the other.
 *
 * Every method is scoped to profiles the caller may use — owned or invited —
 * because deciding a job is wrong for a candidate is exactly as much a "use"
 * of that profile as applying on its behalf.
 */
export const discardService = {
  /**
   * Discard a job for a profile. Idempotent: discarding an already-discarded
   * pairing returns the existing row untouched rather than moving
   * `discardedAt`, so a double click never rewrites when the call was made.
   */
  async mark(jobId: number, profileId: number, userId: number) {
    const [profile, job] = await Promise.all([
      prisma.profile.findFirst({
        where: { id: profileId, ...usableProfileWhere(userId) },
        select: { id: true },
      }),
      prisma.job.findUnique({ where: { id: jobId }, select: { title: true, company: true } }),
    ]);
    // A profile they may not use and one that does not exist are the same 404,
    // so the endpoint never confirms which profile ids are real.
    if (!profile) throw new DiscardError('Profile not found', 404);
    if (!job) throw new DiscardError('Job not found', 404);

    const existing = await prisma.jobDiscard.findUnique({
      where: { profileId_jobId: { profileId, jobId } },
      select: { id: true },
    });
    if (existing) return this.get(jobId, profileId, userId);

    await prisma.jobDiscard.create({
      data: {
        profileId,
        jobId,
        jobTitle: job.title,
        jobCompany: job.company,
        discardedById: userId,
      },
    });
    return this.get(jobId, profileId, userId);
  },

  /** Restore a discarded job. Returns false when there was nothing to undo. */
  async unmark(jobId: number, profileId: number, userId: number): Promise<boolean> {
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ...usableProfileWhere(userId) },
      select: { id: true },
    });
    if (!profile) throw new DiscardError('Profile not found', 404);
    const r = await prisma.jobDiscard.deleteMany({ where: { jobId, profileId } });
    return r.count > 0;
  },

  /** One marker, or null. */
  async get(jobId: number, profileId: number, userId: number): Promise<DiscardStatus | null> {
    const row = await prisma.jobDiscard.findFirst({
      where: { jobId, profileId, profile: usableProfileWhere(userId) },
      select: { jobId: true, discardedAt: true, discardedBy: { select: { email: true } } },
    });
    return row?.jobId == null
      ? null
      : { jobId: row.jobId, discardedAt: row.discardedAt, discardedBy: row.discardedBy.email };
  },

  /**
   * Which of `jobIds` this profile has discarded. One query for a whole page
   * rather than a request per card, mirroring `applicationService.statusFor`.
   */
  async statusFor(jobIds: number[], profileId: number, userId: number): Promise<DiscardStatusMap> {
    if (jobIds.length === 0) return {};
    const rows = await prisma.jobDiscard.findMany({
      where: { jobId: { in: jobIds }, profileId, profile: usableProfileWhere(userId) },
      select: { jobId: true, discardedAt: true, discardedBy: { select: { email: true } } },
    });

    const out: DiscardStatusMap = {};
    for (const r of rows) {
      // jobId is nullable (a deleted posting sets it null), so a row can come
      // back without one even though the filter asked for a set.
      if (r.jobId == null) continue;
      out[r.jobId] = {
        jobId: r.jobId,
        discardedAt: r.discardedAt,
        discardedBy: r.discardedBy.email,
      };
    }
    return out;
  },
};
