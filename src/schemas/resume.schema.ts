/**
 * Contracts for job-tailored resume generation.
 *
 * Two zod dialects live here on purpose:
 *  - the REQUEST schema uses `zod` (v3), matching every other route in the app;
 *  - the OUTPUT schema uses `zod/v4`, because the Anthropic SDK's
 *    `zodOutputFormat()` only accepts v4 schemas. zod 3.25 ships both.
 * Mixing them in one file is deliberate — it keeps the seam in one place
 * instead of scattering `zod/v4` imports through the service layer.
 */
import { z } from 'zod';
import * as z4 from 'zod/v4';

/* ------------------------------- request -------------------------------- */

export const previewRequestSchema = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
  /**
   * Optional source material: an existing resume, a bio, rough notes. When it
   * is present the model works from it. When it is absent the model drafts from
   * the employment history and the posting alone, and everything it invents is
   * flagged `inferred` so the UI can demand review before the resume is sent.
   */
  notes: z.string().trim().max(20_000).optional().default(''),
});

export type PreviewRequest = z.infer<typeof previewRequestSchema>;

/* -------------------------------- output -------------------------------- */

const INFERRED = 'true when this was drafted from role/company/posting context rather than stated by the candidate.';

const bullet = z4.object({
  text: z4
    .string()
    .describe(
      'One achievement. Open with an action verb wrapped in <b> tags, and wrap ' +
        'the technologies and metrics that matter in <b> too. <b> is the ONLY ' +
        'tag allowed anywhere; any other markup is printed literally.',
    ),
  inferred: z4.boolean().describe(INFERRED),
});

const skill = z4.object({
  name: z4.string(),
  /**
   * The group this belongs under, e.g. "Backend", "Cloud and Infrastructure",
   * "Soft Skills". Grouped rather than flat because a recruiter scans for a
   * heading before a term, and a filter matches related terms better when they
   * sit together than when they are spread through one long comma run.
   *
   * Free text, not an enum: the right groupings depend on the posting, and a
   * fixed list would force a backend role's skills into a frontend taxonomy.
   * An empty string is legal and falls into a trailing "Additional" group.
   */
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
      'Achievements, most relevant to this posting first. 8 to 10 for the most ' +
        'recent role, 6 to 8 for older ones. A field description outranks the ' +
        'system prompt when the two disagree, so this is the number that decides ' +
        'the length of the resume.',
    ),
  /**
   * One line naming the hard part of the role.
   *
   * Separate from the bullets because it answers a different question: bullets
   * say what was delivered, this says what made delivering it difficult. It is
   * the line that reads as a person rather than a task list, and it is where
   * the judgement content belongs.
   */
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
  /** Empty string when not recorded, same convention as an experience entry. */
  location: z4.string().describe('Exactly as given in the education record. Empty string when not known.'),
  period: z4.string(),
});

export const tailoredResumeSchema = z4.object({
  headline: z4.string().describe('Target-role headline, e.g. "Senior Data Engineer · Python · Spark · AWS".'),
  summary: z4
    .string()
    .describe(
      '4 to 5 sentences aimed at THIS posting: seniority and discipline, the ' +
        'years the employment dates actually support, the technologies the ' +
        'posting names, one measurable outcome, and one sentence on ownership. ' +
        'Wrap 10 to 15 of the highest-value terms in <b> tags.',
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
