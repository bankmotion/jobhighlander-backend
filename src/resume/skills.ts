import type { TailoredResume } from '../schemas/resume.schema';

export interface SkillGroup {
  category: string;
  names: string[];
}

/** Skills with no category of their own, gathered at the end. */
const FALLBACK_CATEGORY = 'Additional';

/**
 * Group skills by category, preserving the model's ordering.
 *
 * Insertion-ordered rather than sorted: the model is told to put the most
 * posting-relevant category first, and alphabetising would throw that away and
 * lead every resume with whatever happens to start with "A".
 *
 * Categories are matched case-insensitively on a trimmed value, because
 * "Cloud and Infrastructure" and "cloud and infrastructure" coming back from one
 * generation would otherwise render as two separate headings for one group.
 * The first spelling seen wins, so the heading reads the way the model wrote it.
 */
export function groupSkills(skills: TailoredResume['skills']): SkillGroup[] {
  const groups = new Map<string, SkillGroup>();

  for (const s of skills) {
    const name = s.name?.trim();
    if (!name) continue;
    const label = s.category?.trim() || FALLBACK_CATEGORY;
    const key = label.toLowerCase();
    const existing = groups.get(key);
    if (existing) existing.names.push(name);
    else groups.set(key, { category: label, names: [name] });
  }

  // "Additional" is a catch-all, so it reads as a footnote rather than as a
  // heading with equal standing to the real ones.
  const all = [...groups.values()];
  const rest = all.filter((g) => g.category !== FALLBACK_CATEGORY);
  const extra = all.filter((g) => g.category === FALLBACK_CATEGORY);
  return [...rest, ...extra];
}

/** One line per group: "Backend: Go, Postgres, gRPC". */
export function skillLines(skills: TailoredResume['skills'], sep = ', '): string[] {
  return groupSkills(skills).map((g) => `${g.category}: ${g.names.join(sep)}`);
}
