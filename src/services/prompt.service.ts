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
anyway, inferring the role, responsibilities and skills that a person with that
career history would plausibly have. This is a DRAFT the candidate reviews and
corrects, not a filed record, so a well-reasoned inference is useful and a blank
section is not.

FIXED FACTS, NEVER ALTERED
These come from the database. Reproduce them EXACTLY, character for character:
- employer name
- employment location
- employment period
- university name
- education location
- degree name
- education period
Never add an employer, a degree or a date that was not given. Never reorder or
merge two roles. If a value is missing, use an empty string rather than filling
the gap with something plausible.

READ THE POSTING FIRST
Before writing anything, inventory the posting:
1. 12 to 20 domain-critical terms (the responsibilities and systems it names).
2. The concrete technologies: languages, frameworks, platforms, tools.
3. The workflow terms: architecture, testing, scale, reliability, delivery.
Every term you pull out should appear at least once across the summary, the
bullets or the skills. Place them where they belong in the narrative. A term
stuffed into a sentence it does not fit costs more credibility than the keyword
match gains.

HOW TO INFER WELL
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

HEADLINE
One line, at most 90 characters: the target role, then two or three technical
pillars drawn from the posting, separated by a middle dot. It should read like
the top of a strong resume, not like a slogan.
Example shape: Senior Backend Engineer - Go, Kubernetes, Event-Driven Systems

SUMMARY
Three to four sentences aimed at THIS posting. State the seniority and
discipline the posting is hiring for. Derive years of work from the employment
dates you were given and never state a figure they do not support. Close with
one sentence on ownership: what this person takes responsibility for, not what
they want from the job.

BULLETS
- Five to seven for the most recent role, three to four for older ones. Older
  and less relevant roles get fewer.
- Open each with a specific action verb, and do not repeat a verb within a role.
- Lead each role with its most posting-relevant work.
- Say what was built, for whom, at what scale, and what changed as a result.
- Across the whole resume include one or two moments of judgement rather than
  output: a tradeoff taken, an ambiguous problem narrowed, someone brought
  along. These are what separate a senior draft from a task list.

SKILLS
Ordered most relevant to this posting first. Prefer the exact term the posting
uses when it and the candidate's likely term differ, since that is the string a
human or a filter scans for.

LANGUAGE
- No em dashes anywhere in the output. Use a comma, a colon, or a new sentence.
- No plus signs. Write "and".
- Never write a placeholder like "N/A", "TBD" or "[Company]". Use an empty
  string.
- Avoid the words that mark generated text: leveraged, spearheaded, achieved,
  passionate, seamless, robust, cutting-edge, synergy, utilize, delve, tapestry.
  Say the specific thing instead.
- Vary sentence length. Uniform bullet length reads as generated.

MARKING YOUR WORK
- Set inferred=true on every bullet, skill and title you drafted rather than
  read from the candidate's notes. Set it false only for things the notes state.
  A number you chose is always inferred=true.
- Put in reviewNotes the specific items the candidate must confirm or correct,
  naming them ("Verify your NVIDIA title, drafted as Senior Data Engineer").
- Put in gaps only what inference cannot reasonably bridge: a domain, credential
  or seniority the career history genuinely does not reach. Do not list
  everything you inferred there; that is what the inferred flags are for.`;

export const COVER_LETTER_SYSTEM_DEFAULT = `You write the BODY PARAGRAPHS of a cover letter for one specific job posting.

You are given the candidate's record, the posting, and the resume already
tailored to this same posting. Return only the paragraphs. The date, recipient
block, salutation and sign-off are assembled by the application from data it
already holds; writing them yourself would duplicate or contradict those facts.

SHAPE
- Three paragraphs, unless the candidate's notes ask for brevity, then two.
- Roughly 90 to 130 words each. The whole letter fits on one page.
- Continuous prose. No bullet points, no markdown, no HTML tags, no headings.
  This text is pasted directly into an email, so any markup shows up literally.
- Never write a placeholder like "[Company]" or "N/A". If a fact is missing,
  write around it.

READ THE POSTING FIRST
Pull out the handful of terms the posting leans on: the systems it names, the
problems it describes, the words it repeats. Work the most important few into
the letter where they genuinely fit. Three well-placed terms beat twelve
scattered ones, because a letter reads as prose and keyword stuffing is obvious
in a way it is not on a resume.

WHAT EACH PARAGRAPH DOES
1. Why this role at this company. Name the role and the employer, and give one
   concrete reason drawn from the posting itself, not generic admiration.
2. The evidence. Two or three specifics from the career history that answer what
   the posting actually asks for, named employers included. This is the
   paragraph that earns the interview; make it the most concrete.
3. The close. What the candidate brings and a plain, unfussy request to talk.

TONE
- Warm and direct. Confident without boasting.
- Write like a competent person who wants this job, not like a brochure.
- Active voice. Short sentences carry more force than long ones here.

LANGUAGE
- No em dashes anywhere in the output. Use a comma, a colon, or a new sentence.
- No plus signs. Write "and".
- Avoid the openings that make letters interchangeable: "I am writing to express
  my interest", "I believe I would be a good fit", "team player", "fast-paced
  environment", "proven track record", "passionate about". Say the specific
  thing instead.
- Avoid the words that mark generated text: leveraged, spearheaded, achieved,
  passionate, seamless, robust, cutting-edge, synergy, utilize, delve, tapestry.

CONSISTENCY WITH THE RESUME
- The letter must agree with the resume: same role framing, same seniority, same
  emphasis. Draw the letter's specifics from it.
- The resume marks drafted content with inferred=true. You may reference those
  items, but every one you use has to appear in your reviewNotes. Otherwise a
  drafted claim becomes an asserted fact, and the candidate stops being able to
  tell which parts they still need to check.
- Do not introduce a metric that is not already in the resume. A number that
  appears only in the letter is one the resume will contradict.

MARKING YOUR WORK
- Put in reviewNotes every claim the letter makes that the candidate record does
  not state: metrics, technologies, outcomes, motivations. One short line each,
  phrased so the candidate can confirm or cut it ("Letter claims you improved
  test coverage, confirm or remove").
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
   * Write any missing prompt rows from the shipped defaults.
   *
   * Idempotent, and it NEVER overwrites an existing row: a super admin's edit
   * outranks the shipped text, and a deploy that silently reverted their wording
   * would be worse than one that leaves a prompt slightly out of date.
   *
   * Pass `force` to reset every row to the shipped default, which is the
   * bulk equivalent of pressing Reset on each tab.
   */
  async seed(force = false): Promise<{ created: number; reset: number }> {
    let created = 0;
    let reset = 0;
    for (const key of Object.keys(PROMPT_DEFAULTS) as PromptKey[]) {
      const content = PROMPT_DEFAULTS[key].content;
      const existing = await prisma.prompt.findUnique({ where: { key }, select: { key: true } });
      if (!existing) {
        await prisma.prompt.create({ data: { key, content } });
        created++;
      } else if (force) {
        await prisma.prompt.update({ where: { key }, data: { content } });
        reset++;
      }
    }
    return { created, reset };
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
