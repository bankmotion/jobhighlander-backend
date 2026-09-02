import { prisma } from '../lib/prisma';

function toDate(s?: string | null): Date | null {
  if (!s) return null;
  const iso = /^\d{4}$/.test(s) ? `${s}-01-01` : /^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s;
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
  datePrecision?: string | null;
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
  list.map((e, i) => {
    const datePrecision = e.datePrecision === 'year' ? 'year' : 'month';
    // A year-precision entry is stored as YYYY-01-01 even when the caller sent
    // a month. Keeping a month nothing will render and nobody can edit leaves a
    // value in the table that can only mislead whoever reads it next.
    const at = (v?: string | null) => toDate(datePrecision === 'year' ? (v ? v.slice(0, 4) : null) : v);
    return {
      university: clean(e.university),
      location: clean(e.location),
      degree: clean(e.degree),
      startDate: at(e.startDate),
      endDate: at(e.endDate),
      datePrecision,
      sortOrder: i,
    };
  });

const profileFields = (input: ProfileInput) => ({
  email: clean(input.email),
  firstName: clean(input.firstName),
  lastName: clean(input.lastName),
  phone: clean(input.phone),
  linkedin: clean(input.linkedin),
  location: clean(input.location),
});

export const usableProfileWhere = (userId: number) => ({
  OR: [
    { ownerId: userId },
    { invitations: { some: { userId, status: 'accepted' as const } } },
  ],
});

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

const withAccess = <T extends { ownerId: number }>(row: T, userId: number) => ({
  ...row,
  canEdit: row.ownerId === userId,
});

export const profileService = {
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

  async accessLevel(id: number, userId: number): Promise<'owner' | 'invitee' | 'none'> {
    const profile = await prisma.profile.findFirst({
      where: { id, ...usableProfileWhere(userId) },
      select: { ownerId: true },
    });
    if (!profile) return 'none';
    return profile.ownerId === userId ? 'owner' : 'invitee';
  },

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

  async remove(id: number, ownerId: number): Promise<boolean> {
    const r = await prisma.profile.deleteMany({ where: { id, ...ownedProfileWhere(ownerId) } });
    return r.count > 0;
  },
};

// ── Super-admin profile register ──
export interface AdminProfileRow {
  id: number;
  name: string;
  email: string | null;
  location: string | null;
  owner: { id: number; email: string; role: string };
  memberCount: number;
  aiEnabled: boolean;
  applications: number;
  resumes: number;
  createdAt: string;
  updatedAt: string;
}

export const adminProfileService = {
  // Every profile in the system, ignoring membership — the same reasoning as
  // the team bid-performance view, and gated the same way at the route.
  async list(): Promise<AdminProfileRow[]> {
    const rows = await prisma.profile.findMany({
      orderBy: [{ aiEnabled: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true, firstName: true, lastName: true, email: true, location: true,
        aiEnabled: true, createdAt: true, updatedAt: true,
        owner: { select: { id: true, email: true, role: true } },
        invitations: { where: { status: 'accepted' }, select: { id: true } },
        _count: { select: { applications: true, resumes: true } },
      },
    });

    return rows.map((p) => ({
      id: p.id,
      name: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || `Profile ${p.id}`,
      email: p.email,
      location: p.location,
      owner: { id: p.owner.id, email: p.owner.email, role: String(p.owner.role) },
      // Owner plus accepted invitees, the same definition of "member" used
      // everywhere else.
      memberCount: 1 + p.invitations.length,
      aiEnabled: p.aiEnabled,
      applications: p._count.applications,
      resumes: p._count.resumes,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
  },

  async setAiEnabled(profileId: number, enabled: boolean): Promise<boolean> {
    // updateMany rather than update: a missing id is a 404 for the caller, not
    // a thrown Prisma error to translate.
    const r = await prisma.profile.updateMany({
      where: { id: profileId },
      data: { aiEnabled: enabled },
    });
    return r.count > 0;
  },
};
