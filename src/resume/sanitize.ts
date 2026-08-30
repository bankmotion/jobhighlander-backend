
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
