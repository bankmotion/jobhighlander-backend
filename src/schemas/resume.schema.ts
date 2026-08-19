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
  text: z4.string(),
  inferred: z4.boolean().describe(INFERRED),
});

const skill = z4.object({
  name: z4.string(),
  inferred: z4.boolean().describe(INFERRED),
});

const experienceEntry = z4.object({
  company: z4.string().describe('Exactly as given in the employment history. Never changed.'),
  period: z4.string().describe('Exactly as given in the employment history. Never changed.'),
  location: z4.string().describe('Empty string when not known.'),
  title: z4.string().describe('The role. Drafted from company, seniority arc and the target posting when not stated.'),
  titleInferred: z4.boolean().describe(INFERRED),
  bullets: z4.array(bullet).describe('3-5 achievements, most relevant to this posting first.'),
});

const educationEntry = z4.object({
  institution: z4.string(),
  degree: z4.string(),
  period: z4.string(),
});

export const tailoredResumeSchema = z4.object({
  headline: z4.string().describe('Target-role headline, e.g. "Senior Data Engineer · Python · Spark · AWS".'),
  summary: z4.string().describe('2-3 sentences aimed at THIS posting.'),
  skills: z4.array(skill).describe('Ordered most-relevant-first for this posting.'),
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
