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

/** Owner-scoped CRUD for candidate/bidding profiles + their nested entries. */
export const profileService = {
  list(ownerId: number) {
    return prisma.profile.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        location: true,
        updatedAt: true,
        _count: { select: { workExperiences: true, educations: true } },
      },
    });
  },

  get(id: number, ownerId: number) {
    return prisma.profile.findFirst({
      where: { id, ownerId },
      include: {
        workExperiences: { orderBy: { sortOrder: 'asc' } },
        educations: { orderBy: { sortOrder: 'asc' } },
      },
    });
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

  async update(id: number, ownerId: number, input: ProfileInput) {
    const existing = await prisma.profile.findFirst({ where: { id, ownerId }, select: { id: true } });
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
    const r = await prisma.profile.deleteMany({ where: { id, ownerId } });
    return r.count > 0;
  },
};
