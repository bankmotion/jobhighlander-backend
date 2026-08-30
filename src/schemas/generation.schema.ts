import { z } from 'zod';
import * as z4 from 'zod/v4';
import { tailoredResumeSchema } from './resume.schema';
import { coverLetterDraftSchema } from './coverLetter.schema';

export const applicationRequestSchema = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
  notes: z.string().trim().max(4_000).optional().default(''),
});

export type ApplicationRequest = z.infer<typeof applicationRequestSchema>;

export const applicationDraftSchema = z4.object({
  resume: tailoredResumeSchema,
  coverLetter: coverLetterDraftSchema,
});

export type ApplicationDraft = z4.infer<typeof applicationDraftSchema>;
