
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
 * Rewrites the years-of-experience mention to the canonical "10+ years".
 *
 * Deliberately conservative: it only rewrites a figure that ALREADY equals the
 * span computed from the employment dates. So it can normalise the wording but
 * can never change the number, and cannot touch an unrelated quantity such as
 * "a five year engagement". Anything it does not recognise is left as written.
 *
 * This exists because the prompt alone is not a guarantee. The instruction is
 * followed most of the time, and "most of the time" is not good enough for a
 * document someone sends to an employer.
 */
export function writeExperienceYears(text: string, years: number): string {
  if (!years || !Number.isFinite(years)) return text;
  const canonical = `${years}+ years`;
  return text.replace(
    /\b(?:(?:over|more than|at least|nearly|around|about)\s+)?([a-z]+|\d{1,2})\+?\s+years\b/gi,
    (match, token: string) => {
      const value = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token.toLowerCase()];
      return value === years ? canonical : match;
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
