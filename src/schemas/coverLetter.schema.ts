/**
 * Contracts for job-tailored cover letter generation.
 *
 * Same two-dialect split as resume.schema.ts: the REQUEST uses `zod` (v3) like
 * every other route, the OUTPUT uses `zod/v4` because the Anthropic SDK's
 * `zodOutputFormat()` only accepts v4.
 *
 * The model returns PARAGRAPHS, not a finished letter. The date, recipient
 * block, salutation and sign-off are assembled from the job and the profile —
 * facts the app already holds, which a model can only get wrong.
 */
import { z } from 'zod';
import * as z4 from 'zod/v4';

/* ------------------------------- request -------------------------------- */

export const coverLetterRequestSchema = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
  /** Optional steer: "mention the referral from X", "keep it under 200 words". */
  notes: z.string().trim().max(4_000).optional().default(''),
});

export type CoverLetterRequest = z.infer<typeof coverLetterRequestSchema>;

/** Body of a manual edit. The letter is text the user is about to paste. */
export const coverLetterUpdateSchema = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
  body: z.string().max(20_000),
});

/* -------------------------------- output -------------------------------- */

export const coverLetterDraftSchema = z4.object({
  paragraphs: z4
    .array(z4.string())
    .describe(
      'The letter body: 3 paragraphs (2 if brief). Plain prose, no salutation, ' +
        'no sign-off, no markdown, no bullet points. Each is one paragraph of ' +
        'continuous text.',
    ),
  /**
   * The honesty mechanism, and the reason generation is structured at all.
   *
   * A cover letter invents more than a resume does — motivation, enthusiasm and
   * cultural fit are not facts on record. When the tailored resume is supplied
   * as source it may itself contain inferred claims, and a letter restating one
   * as established fact produces two documents confidently agreeing on
   * something that was never true. Anything not stated in the candidate record
   * has to surface here.
   */
  reviewNotes: z4
    .array(z4.string())
    .describe(
      'Every claim the letter makes that the candidate record does not state — ' +
        'metrics, technologies, outcomes, motivations. One short line each, ' +
        'phrased so the candidate can confirm or cut it. Empty only when the ' +
        'letter asserts nothing beyond the record.',
    ),
});

export type CoverLetterDraft = z4.infer<typeof coverLetterDraftSchema>;
