import type { TailoredResume } from '../schemas/resume.schema';

export interface SkillGroup {
  category: string;
  names: string[];
}

const FALLBACK_CATEGORY = 'Additional';

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

export function skillLines(skills: TailoredResume['skills'], sep = ', '): string[] {
  return groupSkills(skills).map((g) => `${g.category}: ${g.names.join(sep)}`);
}
