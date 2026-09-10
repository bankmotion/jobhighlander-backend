
export function spellOutPlus(text: string): string {
  if (!text.includes('+')) return text;
  return text.replace(
    // The qualifier group carries its OWN trailing space. Matching bare `\s*`
    // ahead of the quantity would consume the space after the previous word and
    // give "scaled toover 100M".
    //
    // The trailing lookahead exempts the years-of-experience figure. A resume
    // opens with "10+ years", which is how a recruiter expects to read it;
    // rewriting that to "over 10 years" is the one place this rule made the
    // document worse. Every other quantity is still spelled out.
    /(\b(?:over|more than|at least|nearly|around|about)\s+)?(\d[\d.,]*(?:\s*(?:K|M|B|thousand|million|billion))?)\+(?!\s*years?\b)/gi,
    (_m, qualifier: string | undefined, quantity: string) => `${qualifier ?? 'over '}${quantity}`,
  );
}

// Number words the model reaches for when writing an experience figure. Twenty
// is a generous ceiling: beyond that a resume states a decade, not a count.
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
};

/**
 * Force the years-of-experience claim to the span the employment dates support.
 *
 * THE FIRST recognisable "N years" in the summary is the career-span claim, and
 * it is rewritten to the canonical form whatever number the model chose. Later
 * mentions are left alone: those are sub-spans ("five years leading teams"),
 * and rewriting them would replace a true statement with a false one.
 *
 * This used to rewrite only a figure that ALREADY equalled the computed span,
 * on the reasoning that it could then never corrupt an unrelated quantity. The
 * effect was that it normalised the wording of numbers that were already right
 * and silently passed through every number that was wrong — the only case that
 * mattered. A profile whose dates support six years shipped resumes claiming
 * ten. Restricting the correction to the FIRST mention answers the original
 * worry without keeping the hole.
 *
 * An unparseable quantity ("many years") is left as written: it overstates
 * nothing specific, and there is no number to disagree with.
 *
 * This exists because the prompt alone is not a guarantee. The candidate block
 * states the figure as a fixed fact and the instruction is followed most of the
 * time, and "most of the time" is not good enough for a document someone sends
 * to an employer.
 */
export function writeExperienceYears(text: string, years: number): string {
  if (!years || !Number.isFinite(years)) return text;
  const canonical = `${years}+ years`;
  let claimed = false;
  return text.replace(
    /\b(?:(?:over|more than|at least|nearly|around|about)\s+)?([a-z]+|\d{1,2})\+?\s+years\b/gi,
    (match, token: string) => {
      const value = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token.toLowerCase()];
      if (value === undefined || !Number.isFinite(value)) return match;
      if (claimed) return match;
      claimed = true;
      return canonical;
    },
  );
}

export function replaceEmDash(text: string): string {
  if (!text.includes('—')) return text;
  return text
    .replace(/\s*—\s*/g, ', ')
    // A dash following punctuation leaves ", ," behind.
    .replace(/([,:;])\s*,\s*/g, '$1 ')
    .replace(/\s+([,.])/g, '$1');
}

export function sanitizeResume<T>(resume: T): T {
  return walk(resume) as T;
}

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

function walk(value: unknown): unknown {
  if (typeof value === 'string') return replaceEmDash(spellOutPlus(value));
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
  }
  return value;
}
