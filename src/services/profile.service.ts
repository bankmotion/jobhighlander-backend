import { prisma } from '../lib/prisma';

/** Month-granularity date. Accepts 'YYYY-MM' or 'YYYY-MM-DD'; null = open/Present. */
function toDate(s?: string | null): Date | null {
  if (!s) return null;
  const iso = /^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const clean = (s?: string | null): string | null => {
  const t = (s ?? '').trim();
  return t ? t : null;
};

export interface WorkExpInput {
  company?: string | null;
  location?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}
export interface EduInput {
  university?: string | null;
  location?: string | null;
  degree?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}
export interface ProfileInput {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  location?: string | null;
  workExperiences?: WorkExpInput[];
  educations?: EduInput[];
}

const mapWork = (list: WorkExpInput[] = []) =>
  list.map((w, i) => ({
    company: clean(w.company),
    location: clean(w.location),
    startDate: toDate(w.startDate),
    endDate: toDate(w.endDate),
    sortOrder: i,
  }));

const mapEdu = (list: EduInput[] = []) =>
  list.map((e, i) => ({
    university: clean(e.university),
    location: clean(e.location),
    degree: clean(e.degree),
    startDate: toDate(e.startDate),
    endDate: toDate(e.endDate),
    sortOrder: i,
  }));

const profileFields = (input: ProfileInput) => ({
  email: clean(input.email),
  firstName: clean(input.firstName),
  lastName: clean(input.lastName),
  phone: clean(input.phone),
  linkedin: clean(input.linkedin),
  location: clean(input.location),
});

/**
 * Every profile this user may USE — their own, plus the ones they have accepted
 * an invitation to. "Use" means read it and generate resumes from it; it never
 * means edit it.
 *
 * Exported because the scope has to be identical everywhere a profile is served
 * (resumes, presets, PDF rendering). A second hand-written `OR` somewhere else
 * is how an invitee ends up able to read a profile but not print it — or, worse,
 * how a revoked one keeps working on the endpoint that was forgotten.
 */
export const usableProfileWhere = (userId: number) => ({
  OR: [
    { ownerId: userId },
    { invitations: { some: { userId, status: 'accepted' as const } } },
  ],
});

/** Profiles this user may EDIT or DELETE — owned only. Invitees are read-only. */
export const ownedProfileWhere = (ownerId: number) => ({ ownerId });

const summarySelect = {
  id: true,
  ownerId: true,
  email: true,
  firstName: true,
  lastName: true,
  location: true,
  updatedAt: true,
  owner: { select: { id: true, email: true } },
  _count: { select: { workExperiences: true, educations: true } },
} as const;

/** A summary plus whether THIS caller may edit it, so the UI never has to guess. */
const withAccess = <T extends { ownerId: number }>(row: T, userId: number) => ({
  ...row,
  canEdit: row.ownerId === userId,
});

/**
 * Read/use is invitation-aware; create/update/delete stay owner-only.
 *
 * Which of `usableProfileWhere` / `ownedProfileWhere` a method uses IS its
 * permission model — there is no separate check elsewhere, so changing one here
 * changes what invitees can do.
 */
export const profileService = {
  /** Profiles the user can use: owned first, then accepted invitations. */
  async list(userId: number) {
    const rows = await prisma.profile.findMany({
      where: usableProfileWhere(userId),
      orderBy: { updatedAt: 'desc' },
      select: summarySelect,
    });
    // Owned before shared, each half still newest-first: a user's own profiles
    // are what they reach for, and a busy owner's edits should not push them
    // below someone else's profile they were invited to months ago.
    return rows
      .map((r) => withAccess(r, userId))
      .sort((a, b) => Number(b.canEdit) - Number(a.canEdit));
  },

  async get(id: number, userId: number) {
    const profile = await prisma.profile.findFirst({
      where: { id, ...usableProfileWhere(userId) },
      include: {
        owner: { select: { id: true, email: true } },
        workExperiences: { orderBy: { sortOrder: 'asc' } },
        educations: { orderBy: { sortOrder: 'asc' } },
      },
    });
    return profile ? withAccess(profile, userId) : null;
  },

  create(ownerId: number, input: ProfileInput) {
    return prisma.profile.create({
      data: {
        ownerId,
        ...profileFields(input),
        workExperiences: { create: mapWork(input.workExperiences) },
        educations: { create: mapEdu(input.educations) },
      },
      include: {
        workExperiences: { orderBy: { sortOrder: 'asc' } },
        educations: { orderBy: { sortOrder: 'asc' } },
      },
    });
  },

  /**
   * What this user may do with this profile: own it, hold an accepted
   * invitation to it, or neither.
   *
   * Used only to answer a REFUSED write honestly. A caller who can already read
   * the profile learns nothing from a 403 that a 200 on GET did not already
   * tell them, and "you cannot edit a profile you were invited to" is the one
   * message that explains why their save did nothing — where a bare 404 reads
   * as data loss.
   */
  async accessLevel(id: number, userId: number): Promise<'owner' | 'invitee' | 'none'> {
    const profile = await prisma.profile.findFirst({
      where: { id, ...usableProfileWhere(userId) },
      select: { ownerId: true },
    });
    if (!profile) return 'none';
    return profile.ownerId === userId ? 'owner' : 'invitee';
  },

  /** Owner-only: an invitee may read this profile but never rewrite it. */
  async update(id: number, ownerId: number, input: ProfileInput) {
    const existing = await prisma.profile.findFirst({
      where: { id, ...ownedProfileWhere(ownerId) },
      select: { id: true },
    });
    if (!existing) return null;
    // Replace nested collections wholesale — simplest correct approach here.
    await prisma.$transaction([
      prisma.workExperience.deleteMany({ where: { profileId: id } }),
      prisma.education.deleteMany({ where: { profileId: id } }),
      prisma.profile.update({
        where: { id },
        data: {
          ...profileFields(input),
          workExperiences: { create: mapWork(input.workExperiences) },
          educations: { create: mapEdu(input.educations) },
        },
      }),
    ]);
    return this.get(id, ownerId);
  },

  /** Owner-only. Cascades take the invitations and resumes with it. */
  async remove(id: number, ownerId: number): Promise<boolean> {
    const r = await prisma.profile.deleteMany({ where: { id, ...ownedProfileWhere(ownerId) } });
    return r.count > 0;
  },
};
