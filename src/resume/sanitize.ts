/**
 * Deterministic clean-up of model-authored text.
 *
 * WHY THIS IS CODE AND NOT PROMPT. The system prompt forbids plus signs and the
 * model keeps writing "50K+ users" anyway, because that is simply how resumes
 * are written and the pattern is deeply learned. Em dashes obey the prompt;
 * this one does not. A rule that has to hold every time belongs where it can be
 * guaranteed, not where it is requested — the prompt still states it so the
 * model usually complies, and this catches the rest.
 *
 * Everything here is a pure string transform. It never adds a claim, changes a
 * number, or drops content; it only rewrites how a value is spelled.
 */

/**
 * "50K+ users" becomes "over 50K users".
 *
 * Requires a DIGIT before the plus, which is what keeps `C++` intact — the one
 * legitimate plus sign a technical resume contains. An existing qualifier is
 * absorbed rather than doubled, so "more than 30+ services" does not become
 * "more than over 30 services".
 */
export function spellOutPlus(text: string): string {
  if (!text.includes('+')) return text;
  return text.replace(
    // The qualifier group carries its OWN trailing space. Matching bare `\s*`
    // ahead of the quantity would consume the space after the previous word and
    // give "scaled toover 100M".
    /(\b(?:over|more than|at least|nearly|around|about)\s+)?(\d[\d.,]*(?:\s*(?:K|M|B|thousand|million|billion))?)\+/gi,
    (_m, qualifier: string | undefined, quantity: string) => `${qualifier ?? 'over '}${quantity}`,
  );
}

/**
 * Em dash to comma, the substitution the prompt itself asks for.
 *
 * Only the em dash (U+2014). The EN dash (U+2013) is left alone because that is
 * what `periodOf` and `yearsOf` put between two dates, and rewriting it would
 * turn "2012 – 2015" into "2012, 2015".
 */
export function replaceEmDash(text: string): string {
  if (!text.includes('—')) return text;
  return text
    .replace(/\s*—\s*/g, ', ')
    // A dash following punctuation leaves ", ," behind.
    .replace(/([,:;])\s*,\s*/g, '$1 ')
    .replace(/\s+([,.])/g, '$1');
}

/** Every text field a model wrote, cleaned in place. */
export function sanitizeResume<T>(resume: T): T {
  return walk(resume) as T;
}

/**
 * The cover letter, additionally stripped of every tag.
 *
 * The letter is assembled into an email body as plain text, so a `<b>` there is
 * read by a human as the characters "<b>". The resume keeps its tags — they are
 * rendered — which is why this is a separate pass and not part of `walk`.
 */
export function sanitizeLetter<T>(letter: T): T {
  return walkLetter(letter) as T;
}

function walkLetter(value: unknown): unknown {
  if (typeof value === 'string') return stripAllTags(spellOutPlus(replaceEmDash(value)));
  if (Array.isArray(value)) return value.map(walkLetter);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walkLetter(v)]));
  }
  return value;
}

const stripAllTags = (text: string): string => text.replace(/<\/?[a-z][^>]*>/gi, '');

/**
 * Recursively rewrite every string in a plain JSON value.
 *
 * Walks the whole object rather than naming fields, so a field added to the
 * schema later is covered without anyone remembering to add it here — the
 * failure mode of a field list is that it silently stops covering new fields.
 */
function walk(value: unknown): unknown {
  if (typeof value === 'string') return replaceEmDash(spellOutPlus(value));
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
  }
  return value;
}
