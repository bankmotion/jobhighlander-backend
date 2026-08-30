import { prisma } from '../lib/prisma';

export const keywordService = {
  list() {
    return prisma.keyword.findMany({ orderBy: { word: 'asc' } });
  },

  async create(wordRaw: string) {
    const word = wordRaw.trim();
    if (!word) return null;
    try {
      return await prisma.keyword.create({ data: { word } });
    } catch {
      return null; // unique-constraint violation
    }
  },

  async update(id: number, wordRaw: string) {
    const word = wordRaw.trim();
    if (!word) return null;
    try {
      return await prisma.keyword.update({ where: { id }, data: { word } });
    } catch {
      return null;
    }
  },

  async remove(id: number): Promise<boolean> {
    try {
      await prisma.keyword.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  },
};
