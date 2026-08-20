import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';

/**
 * Super-admin editable model instructions.
 *
 * PROMPTS ARE DATA; THE CODE THAT SENDS THEM IS NOT. A row replaces the system
 * block for one generator and nothing else — it cannot introduce a new call, a
 * new model, or a new output schema. That boundary is what makes a text field
 * an admin can type into safe to send to a model.
 *
 * Every key keeps its shipped text in `PROMPT_DEFAULTS`, and a missing, blank
 * or whitespace-only row falls back to it. Same reasoning as `FALLBACK_PRESET`:
 * an admin who clears the box gets the shipped behaviour back rather than a
 * generator that quietly produces nothing.
 */

export const RESUME_SYSTEM_DEFAULT = `You write a resume tailored to one specific job posting.

The candidate's stored record is thin: it gives employers and dates, and often
nothing else. Your job is to produce a strong, complete, posting-specific draft
anyway — inferring the role, responsibilities and skills that a person with that
career history would plausibly have. This is a DRAFT the candidate reviews and
corrects, not a filed record, so a well-reasoned inference is useful and a blank
section is not.

HOW TO INFER WELL
- Employer and dates are fixed facts. Never change, reorder or invent them.
- Read the posting closely first. It tells you the vocabulary, seniority and
  technical surface the draft should aim at.
- Infer each title from the employer, the length and recency of the stint, the
  overall career arc, and the target role. A five-year stay ending as the most
  recent role implies more seniority than a nine-month one early on.
- Ground responsibilities in what that employer is actually known for, and in
  what this posting asks for. Prefer concrete, checkable-sounding work over
  generic filler.
- Numbers make a resume, but an invented metric is the easiest thing for an
  interviewer to catch. Use them sparingly, keep them modest, and only where the
  candidate could plausibly confirm the shape of the claim.
- If the candidate's own notes are supplied, they OUTRANK your inference
  everywhere they touch. Reword and reorder those facts; do not overwrite them.

MARKING YOUR WORK
- Set inferred=true on every bullet, skill and title you drafted rather than
  read from the candidate's notes. Set it false only for things the notes state.
- Put in reviewNotes the specific items the candidate must confirm or correct,
  naming them ("Verify your NVIDIA title — drafted as Senior Data Engineer").
- Put in gaps only what inference cannot reasonably bridge: a domain, credential
  or seniority the career history genuinely does not reach. Do not list
  everything you inferred here; that is what the inferred flags are for.

Never write a placeholder like "N/A" or "[Company]". Use an empty string.`;

export const COVER_LETTER_SYSTEM_DEFAULT = `You write the BODY PARAGRAPHS of a cover letter for one specific job posting.

You are given the candidate's record, the posting, and — when it exists — the
resume already tailored to this same posting. Return only the paragraphs. The
date, recipient block, salutation and sign-off are assembled by the application
from data it already holds; writing them yourself would duplicate or contradict
those facts.

SHAPE
- Three paragraphs, unless the candidate's notes ask for brevity, then two.
- Roughly 90 to 130 words each. The whole letter fits on one page.
- Continuous prose. No bullet points, no markdown, no headings, no lists.
- Never write a placeholder like "[Company]" or "N/A". If a fact is missing,
  write around it.

WHAT EACH PARAGRAPH DOES
1. Why this role at this company. Name the role and the employer, and give one
   concrete reason drawn from the posting itself — not generic admiration.
2. The evidence. Two or three specifics from the career history that answer what
   the posting actually asks for, named employers included. This is the
   paragraph that earns the interview; make it the most concrete.
3. The close. What the candidate brings and a plain, unfussy request to talk.

TONE
- Warm and direct. Confident without boasting.
- Write like a competent person who wants this job, not like a brochure.
- Avoid the stock phrases that make letters interchangeable: "I am writing to
  express my interest", "team player", "fast-paced environment", "proven track
  record", "passionate about". Say the specific thing instead.

CONSISTENCY WITH THE RESUME
- When a tailored resume is supplied, the letter must agree with it: same role
  framing, same seniority, same emphasis. Draw the letter's specifics from it.
- The resume marks drafted content with inferred=true. You may reference those
  items, but every one you use has to appear in your reviewNotes — otherwise a
  drafted claim becomes an asserted fact and the candidate stops being able to
  tell which parts they still need to check.

MARKING YOUR WORK
- Put in reviewNotes every claim the letter makes that the candidate record does
  not state: metrics, technologies, outcomes, motivations. One short line each,
  phrased so the candidate can confirm or cut it ("Letter claims you improved
  test coverage — confirm or remove").
- A letter that asserts nothing beyond the record is the only case for an empty
  reviewNotes list. That is rare; motivation alone is usually an addition.`;

/** Everything editable, in the order the admin page shows it. */
export const PROMPT_DEFAULTS = {
  'resume.system': {
    name: 'Resume generation',
    description:
      'System prompt for the job-tailored resume generator. Sent ahead of the ' +
      'candidate record and the posting.',
    content: RESUME_SYSTEM_DEFAULT,
  },
  'cover-letter.system': {
    name: 'Cover letter generation',
    description:
      'System prompt for the cover letter generator. Returns body paragraphs ' +
      'only — the date, salutation and sign-off are assembled by the app.',
    content: COVER_LETTER_SYSTEM_DEFAULT,
  },
} as const;

export type PromptKey = keyof typeof PROMPT_DEFAULTS;

export const isPromptKey = (k: string): k is PromptKey => k in PROMPT_DEFAULTS;

/** One prompt as the admin page shows it. */
export interface PromptView {
  key: PromptKey;
  name: string;
  description: string;
  content: string;
  /** False when the stored text matches the shipped default. */
  customised: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const promptService = {
  /**
   * The text to send for `key`.
   *
   * Never throws and never returns empty: an unreadable database or a blank row
   * degrades to the shipped default, because a generator that fails because
   * somebody cleared a textarea is worse than one that ignores the edit.
   */
  async text(key: PromptKey): Promise<string> {
    try {
      const row = await prisma.prompt.findUnique({ where: { key }, select: { content: true } });
      const stored = row?.content?.trim();
      return stored ? stored : PROMPT_DEFAULTS[key].content;
    } catch (err) {
      logger.error('Could not read prompt; using the default', { key, err: String(err) });
      return PROMPT_DEFAULTS[key].content;
    }
  },

  /** Every prompt, stored value or default, for the admin page. */
  async list(): Promise<PromptView[]> {
    const rows = await prisma.prompt.findMany({
      select: { key: true, content: true, updatedAt: true, updatedBy: { select: { email: true } } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));

    return (Object.keys(PROMPT_DEFAULTS) as PromptKey[]).map((key) => {
      const meta = PROMPT_DEFAULTS[key];
      const row = byKey.get(key);
      const stored = row?.content?.trim();
      const content = stored ? row!.content : meta.content;
      return {
        key,
        name: meta.name,
        description: meta.description,
        content,
        customised: Boolean(stored) && stored !== meta.content.trim(),
        updatedAt: row?.updatedAt?.toISOString() ?? null,
        updatedBy: row?.updatedBy?.email ?? null,
      };
    });
  },

  /**
   * Save an edit. An empty body deletes the row, which is how "reset to
   * default" is expressed — storing a copy of the default instead would make
   * the next change to the shipped text silently not apply.
   */
  async save(key: PromptKey, content: string, userId: number): Promise<PromptView> {
    const trimmed = content.trim();
    if (!trimmed) {
      await prisma.prompt.deleteMany({ where: { key } });
      logger.info('Prompt reset to default', { key, userId });
    } else {
      await prisma.prompt.upsert({
        where: { key },
        create: { key, content: trimmed, updatedById: userId },
        update: { content: trimmed, updatedById: userId },
      });
      logger.info('Prompt updated', { key, userId, chars: trimmed.length });
    }
    const all = await this.list();
    return all.find((p) => p.key === key)!;
  },
};
