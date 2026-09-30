import { z } from 'zod';
import * as z4 from 'zod/v4';
import { AI_PROVIDERS } from '../lib/ai';

export const previewRequestSchema = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
  provider: z.enum(AI_PROVIDERS).optional(),
  /** See `customPromptField` in generation.schema.ts for what absent vs "" mean. */
  customPrompt: z.string().max(6_000).optional(),
});

export type PreviewRequest = z.infer<typeof previewRequestSchema>;

const INFERRED = 'true when this was drafted from role/company/posting context rather than stated by the candidate.';

const bullet = z4.object({
  text: z4
    .string()
    .describe(
      'One achievement. Open with an action verb, left plain. Wrap in <b> ' +
        'tags the name of the project, the technologies and the metrics that ' +
        'matter. THE HOUSE STYLE ADDENDUM MAY OVERRIDE THIS EMPHASIS: when it ' +
        'asks for more or less bold, follow it. <b> is the ONLY tag allowed ' +
        'anywhere; any other markup is printed literally.',
    ),
  inferred: z4.boolean().describe(INFERRED),
});

const skill = z4.object({
  name: z4.string(),
  category: z4.string().describe(
    'Short group heading, two or three words at most, e.g. "Backend" or ' +
      '"Cloud and Infrastructure". Reuse the same wording across skills that ' +
      'belong together; do not invent a group per skill.',
  ),
  inferred: z4.boolean().describe(INFERRED),
});

const experienceEntry = z4.object({
  company: z4.string().describe('Exactly as given in the employment history. Never changed.'),
  period: z4.string().describe('Exactly as given in the employment history. Never changed.'),
  location: z4.string().describe('Empty string when not known.'),
  title: z4.string().describe('The role. Drafted from company, seniority arc and the target posting when not stated.'),
  titleInferred: z4.boolean().describe(INFERRED),
  bullets: z4
    .array(bullet)
    .describe(
      'Achievements, most relevant to this posting first. 9 or more for the ' +
        'most recent role, 6 to 8 for every other role, never fewer than 6. ' +
        'A field description outranks the ' +
        'system prompt when the two disagree, so this is the number that decides ' +
        'the length of the resume.',
    ),
  skills: z4
    .array(z4.string())
    .describe(
      'Every technology and skill this role actually uses in its bullets, the ' +
        'ones the posting asks for first. Plain names, no markup, no sentences.',
    ),
  impact: z4
    .string()
    .describe(
      'One sentence on the hardest constraint of this role and what it demanded ' +
        '(a tradeoff, an ambiguity, a scale or reliability limit). Empty string ' +
        'when nothing honest can be said.',
    ),
});

const educationEntry = z4.object({
  institution: z4.string(),
  degree: z4.string(),
  location: z4.string().describe('Exactly as given in the education record. Empty string when not known.'),
  period: z4.string(),
});

export const tailoredResumeSchema = z4.object({
  headline: z4
    .string()
    .describe(
      'The professional title alone, at most 90 characters. NO technologies: ' +
        'the stack belongs in the skills and the bullets, and a headline packed ' +
        'with it reads as keyword padding. e.g. "Senior Platform and ' +
        'Infrastructure Engineer".',
    ),
  summary: z4
    .string()
    .describe(
      '3 to 4 sentences aimed at THIS posting: seniority and discipline, the ' +
        'years the employment dates actually support, the technologies the ' +
        'posting names, one measurable outcome, and a close on alignment with ' +
        'the role and the company. No personal pronouns. ' +
        'Wrap 10 to 15 of the highest-value terms in <b> tags, unless the house ' +
        'style addendum asks for a different density — that count overrides ' +
        'this one.',
    ),
  skills: z4
    .array(skill)
    .describe(
      'Ordered most-relevant-first for this posting, and grouped: skills sharing ' +
        'a category must be adjacent, with the most relevant category first.',
    ),
  experience: z4.array(experienceEntry),
  education: z4.array(educationEntry),
  gaps: z4
    .array(z4.string())
    .describe(
      'Requirements in the posting that cannot be supported even by reasonable inference — ' +
        'a domain, credential or seniority the career history genuinely does not reach.',
    ),
  reviewNotes: z4
    .array(z4.string())
    .describe(
      'The specific things the candidate must check or correct before sending, ' +
        'e.g. "Verify your NVIDIA title — drafted as Senior Data Engineer".',
    ),
});

export type TailoredResume = z4.infer<typeof tailoredResumeSchema>;

/**
 * Bring a resume saved under an earlier shape up to the current one.
 *
 * Fields have been added to the draft over time, and a field the model must
 * now produce cannot be optional in `tailoredResumeSchema`: that schema is sent
 * to the provider as the output format, where every key is required. So the
 * leniency lives here, on the way IN from storage, and nowhere else.
 *
 * Each default is the value that renders as "this role has none", never an
 * invention: an empty list of skills, an empty impact line, an uncategorised
 * skill, an education entry with no location. A resume written before a field
 * existed opens exactly as it looked then.
 */
function withCurrentShape(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const doc = value as Record<string, unknown>;
  const each = (list: unknown, fix: (item: Record<string, unknown>) => Record<string, unknown>) =>
    Array.isArray(list)
      ? list.map((item) => (item && typeof item === 'object' ? fix(item as Record<string, unknown>) : item))
      : list;
  return {
    ...doc,
    skills: each(doc.skills, (s) => ({ ...s, category: s.category ?? '' })),
    experience: each(doc.experience, (e) => ({
      ...e,
      skills: e.skills ?? [],
      impact: e.impact ?? '',
    })),
    education: each(doc.education, (ed) => ({ ...ed, location: ed.location ?? '' })),
  };
}

/**
 * What a route validates a SAVED or POSTED resume against.
 *
 * Same document as `tailoredResumeSchema`, which stays the strict contract for
 * what the model returns. This one only adds the step above, so a resume from
 * last month and one from today go through the same renderer.
 */
export const storedResumeSchema = z4.preprocess(withCurrentShape, tailoredResumeSchema);
