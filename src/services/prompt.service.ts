import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';

/**
 * Super-admin editable model instructions.
 *
 * THE PROMPT TEXT IS NOT IN THIS CODEBASE. It lives in the `prompts` table, put
 * there by `migrations/20260820070000_application_prompt`, and that row is the
 * only copy. Editing it in the admin page changes what the model is sent on the
 * next generation, with no deploy and nothing to keep in sync.
 *
 * What stays in code is the KEY REGISTRY below: which prompts exist, what to
 * call them on the admin page, and where each one is sent. That is a contract
 * between the code and the table, not content — `promptService.text('...')` has
 * to name something, and an unknown key must be a compile error rather than an
 * empty system block.
 *
 * PROMPTS ARE DATA; THE CODE THAT SENDS THEM IS NOT. A row replaces the system
 * block for one generator and nothing else — it cannot introduce a new call, a
 * new model, or a new output schema. That boundary is what makes a text field
 * an admin can type into safe to send to a model.
 *
 * THE TRADE FOR REMOVING THE COMPILED DEFAULT: there is no longer anything to
 * fall back to. A missing or blank row cannot degrade gracefully, so it fails
 * loudly instead — `text()` throws, and `save()` refuses to store an empty
 * string. Silently sending an empty system prompt would produce a plausible,
 * badly-written application rather than an error, which is the worse outcome.
 */

/** Which prompts exist and how the admin page labels them. Metadata only. */
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

/** Raised when a prompt row is missing or empty — generation cannot proceed. */
export class MissingPromptError extends Error {
  constructor(readonly key: string) {
    super(
      `Prompt "${key}" is missing or empty in the database. Run the migrations ` +
        `(npm run prisma:deploy), or set it in Admin > Prompts.`,
    );
    this.name = 'MissingPromptError';
  }
}

/** One prompt as the admin page shows it. */
export interface PromptView {
  key: PromptKey;
  name: string;
  description: string;
  content: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** False when no usable row exists, so the page can say so instead of
   *  rendering an empty box that looks like a prompt nobody wrote yet. */
  present: boolean;
}

export const promptService = {
  /**
   * The text to send for `key`.
   *
   * THROWS when the row is missing, blank, or unreadable. There is no compiled
   * default to fall back to any more, and the alternative — sending an empty
   * system block — does not fail, it just quietly produces a much worse
   * application. A caller that reaches this state has a broken deployment, and
   * should be told so.
   */
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

  /** Every prompt, for the admin page. */
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

  /**
   * Drop rows for keys the code no longer sends.
   *
   * The seed direction is gone: prompt text arrives by migration now, not from
   * a constant this file could re-insert. What is left is the prune, which is
   * what keeps the table honest after a key is retired — a row nobody sends is
   * worse than no row, because it is text somebody edited that quietly does
   * nothing.
   */
  async pruneRetiredKeys(): Promise<number> {
    const keys = Object.keys(PROMPT_KEYS) as PromptKey[];
    const { count } = await prisma.prompt.deleteMany({ where: { key: { notIn: keys } } });
    if (count) logger.info('Pruned prompt rows for retired keys', { count });
    return count;
  },

  /**
   * Save an edit.
   *
   * REFUSES AN EMPTY BODY. With the compiled default gone, clearing the box no
   * longer means "restore the shipped text" — it would mean deleting the only
   * copy and breaking every generation until someone retyped it. The caller
   * gets an error instead.
   */
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
