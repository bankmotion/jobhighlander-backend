import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';


export const PROMPT_KEYS = {
  'application.system': {
    name: 'Application generation (resume + cover letter)',
    description:
      'The single system prompt behind both documents. One model call writes ' +
      'the tailored resume and the cover letter together, so this text governs ' +
      'both and the consistency between them.',
  },
  'job.query.system': {
    name: 'Ask AI about a job',
    description:
      'Governs the free-form questions a user asks about one posting. The ' +
      'model is given the candidate record, the posting, and the resume and ' +
      'cover letter when they exist — this text decides how honestly it ' +
      'handles what the record does NOT contain.',
  },
} as const;

export type PromptKey = keyof typeof PROMPT_KEYS;

export const isPromptKey = (k: string): k is PromptKey => k in PROMPT_KEYS;

export class MissingPromptError extends Error {
  constructor(readonly key: string) {
    super(
      `Prompt "${key}" is missing or empty in the database. Run the migrations ` +
        `(npm run prisma:deploy), or set it in Admin > Prompts.`,
    );
    this.name = 'MissingPromptError';
  }
}

export interface PromptView {
  key: PromptKey;
  name: string;
  description: string;
  content: string;
  updatedAt: string | null;
  updatedBy: string | null;
  present: boolean;
}

export const promptService = {
  async text(key: PromptKey): Promise<string> {
    let row: { content: string } | null;
    try {
      row = await prisma.prompt.findUnique({ where: { key }, select: { content: true } });
    } catch (err) {
      logger.error('Could not read prompt from the database', { key, err: String(err) });
      throw new MissingPromptError(key);
    }
    const stored = row?.content?.trim();
    if (!stored) {
      logger.error('Prompt row is missing or empty', { key });
      throw new MissingPromptError(key);
    }
    return stored;
  },

  async list(): Promise<PromptView[]> {
    const rows = await prisma.prompt.findMany({
      select: { key: true, content: true, updatedAt: true, updatedBy: { select: { email: true } } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));

    return (Object.keys(PROMPT_KEYS) as PromptKey[]).map((key) => {
      const meta = PROMPT_KEYS[key];
      const row = byKey.get(key);
      const content = row?.content ?? '';
      return {
        key,
        name: meta.name,
        description: meta.description,
        content,
        updatedAt: row?.updatedAt?.toISOString() ?? null,
        updatedBy: row?.updatedBy?.email ?? null,
        present: Boolean(content.trim()),
      };
    });
  },

  async pruneRetiredKeys(): Promise<number> {
    const keys = Object.keys(PROMPT_KEYS) as PromptKey[];
    const { count } = await prisma.prompt.deleteMany({ where: { key: { notIn: keys } } });
    if (count) logger.info('Pruned prompt rows for retired keys', { count });
    return count;
  },

  async save(key: PromptKey, content: string, userId: number): Promise<PromptView> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new MissingPromptError(key);
    }
    await prisma.prompt.upsert({
      where: { key },
      create: { key, content: trimmed, updatedById: userId },
      update: { content: trimmed, updatedById: userId },
    });
    logger.info('Prompt updated', { key, userId, chars: trimmed.length });
    const all = await this.list();
    return all.find((p) => p.key === key)!;
  },
};
