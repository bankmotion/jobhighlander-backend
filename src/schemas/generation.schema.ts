/**
 * Contract for generating a whole application — resume and cover letter — in
 * ONE model call.
 *
 * Same two-dialect split as the schemas it composes: the REQUEST uses `zod`
 * (v3) like every other route, the OUTPUT uses `zod/v4` because the Anthropic
 * SDK's `zodOutputFormat()` only accepts v4.
 */
import { z } from 'zod';
import * as z4 from 'zod/v4';
import { tailoredResumeSchema } from './resume.schema';
import { coverLetterDraftSchema } from './coverLetter.schema';

/* ------------------------------- request -------------------------------- */

export const applicationRequestSchema = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
  /** Optional steer, applied to both documents. */
  notes: z.string().trim().max(4_000).optional().default(''),
});

export type ApplicationRequest = z.infer<typeof applicationRequestSchema>;

/* -------------------------------- output -------------------------------- */

/**
 * Both documents in one object.
 *
 * FIELD ORDER IS LOAD-BEARING. A model fills a JSON object in the order the
 * schema declares, so putting `resume` first means the letter is written with
 * the finished resume already in front of it — which is exactly the dependency
 * the two-call version got by feeding the saved resume into the second prompt.
 * Reversing these two lines would leave the letter guessing at a resume that
 * does not exist yet, and the two documents would drift apart.
 */
export const applicationDraftSchema = z4.object({
  resume: tailoredResumeSchema,
  coverLetter: coverLetterDraftSchema,
});

export type ApplicationDraft = z4.infer<typeof applicationDraftSchema>;
