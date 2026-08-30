import { prisma } from '../lib/prisma';

const DEFAULT_STAGE_TYPES: { key: string; name: string; color: string }[] = [
  { key: 'intro', name: 'Intro', color: '#8b5cf6' },
  { key: 'recruiter_screen', name: 'Recruiter Screen', color: '#a855f7' },
  { key: 'hiring_manager', name: 'Hiring Manager', color: '#6366f1' },
  { key: 'online_assessment', name: 'Online Assessment', color: '#0ea5e9' },
  { key: 'take_home', name: 'Take-home', color: '#06b6d4' },
  { key: 'tech', name: 'Tech', color: '#3b82f6' },
  { key: 'live_coding', name: 'Live Coding', color: '#14b8a6' },
  { key: 'system_design', name: 'System Design', color: '#10b981' },
  { key: 'culture', name: 'Culture Fit', color: '#f59e0b' },
  { key: 'panel', name: 'Panel / Onsite', color: '#f97316' },
  { key: 'client', name: 'Client Interview', color: '#ec4899' },
  { key: 'reference', name: 'Reference Check', color: '#64748b' },
  { key: 'offer', name: 'Offer', color: '#22c55e' },
];

export type RemoveOutcome = { ok: true; deleted: boolean } | { ok: false; reason: 'not_found' };

const HEX = /^#[0-9a-fA-F]{6}$/;

export const stageTypeService = {
  list({ includeArchived = false } = {}) {
    return prisma.interviewStageType.findMany({
      where: includeArchived ? {} : { archived: false },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  },

  async seed(): Promise<number> {
    const existing = new Set(
      (await prisma.interviewStageType.findMany({ select: { key: true } })).map((t) => t.key),
    );
    const missing = DEFAULT_STAGE_TYPES.filter((t) => !existing.has(t.key));
    if (missing.length === 0) return 0;

    // Continue the existing ordering rather than restarting at 0, so seeding
    // after a manual addition does not interleave the new rows into it.
    const max = await prisma.interviewStageType.aggregate({ _max: { sortOrder: true } });
    const base = (max._max.sortOrder ?? -1) + 1;

    await prisma.interviewStageType.createMany({
      data: missing.map((t, i) => ({ ...t, sortOrder: base + i })),
    });
    return missing.length;
  },

  async create(input: { name: string; color?: string; sortOrder?: number }) {
    const name = input.name.trim();
    if (!name) return null;
    const color = input.color && HEX.test(input.color) ? input.color : '#6c5cff';

    // The key is derived from the name and only ever generated here: it is an
    // internal handle, so letting an admin type one would invite collisions
    // with the seeded keys for no gain.
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 56) || 'stage';

    const max = await prisma.interviewStageType.aggregate({ _max: { sortOrder: true } });
    const sortOrder = input.sortOrder ?? (max._max.sortOrder ?? -1) + 1;

    // Two admins can pick the same name; suffix until the unique key lands
    // rather than failing a create the user has no way to fix.
    for (let n = 0; n < 50; n++) {
      const key = n === 0 ? base : `${base}_${n + 1}`;
      try {
        return await prisma.interviewStageType.create({ data: { key, name, color, sortOrder } });
      } catch {
        continue;
      }
    }
    return null;
  },

  async update(
    id: number,
    input: { name?: string; color?: string; sortOrder?: number; archived?: boolean },
  ) {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) return null;
      data.name = name;
    }
    // A malformed colour is dropped, not stored: it would render as no colour
    // at all and look like the badge itself was broken.
    if (input.color !== undefined && HEX.test(input.color)) data.color = input.color;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.archived !== undefined) data.archived = input.archived;
    if (Object.keys(data).length === 0) return prisma.interviewStageType.findUnique({ where: { id } });

    try {
      return await prisma.interviewStageType.update({ where: { id }, data });
    } catch {
      return null;
    }
  },

  async remove(id: number): Promise<RemoveOutcome> {
    const type = await prisma.interviewStageType.findUnique({ where: { id }, select: { id: true } });
    if (!type) return { ok: false, reason: 'not_found' };

    const inUse = await prisma.interviewStepStage.count({ where: { stageTypeId: id } });
    if (inUse > 0) {
      await prisma.interviewStageType.update({ where: { id }, data: { archived: true } });
      return { ok: true, deleted: false };
    }
    await prisma.interviewStageType.delete({ where: { id } });
    return { ok: true, deleted: true };
  },

  async usageCounts(): Promise<Record<number, number>> {
    const rows = await prisma.interviewStepStage.groupBy({
      by: ['stageTypeId'],
      _count: { stageTypeId: true },
    });
    const out: Record<number, number> = {};
    for (const r of rows) out[r.stageTypeId] = r._count.stageTypeId;
    return out;
  },
};
