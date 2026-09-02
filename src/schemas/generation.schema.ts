import { z } from 'zod';
import * as z4 from 'zod/v4';
import { AI_PROVIDERS } from '../lib/ai';
import { tailoredResumeSchema } from './resume.schema';
import { coverLetterDraftSchema } from './coverLetter.schema';

/**
 * Which vendor to bill for this generation.
 *
 * Optional so an older client, or a caller that has no preference, still works
 * — the server falls back to the first configured provider. An unknown value
 * is rejected here rather than silently defaulting, because a request that
 * names a provider means to name one.
 */
export const providerField = z.enum(AI_PROVIDERS).optional();

export const applicationRequestSchema = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
  notes: z.string().trim().max(4_000).optional().default(''),
  provider: providerField,
});

export type ApplicationRequest = z.infer<typeof applicationRequestSchema>;

export const applicationDraftSchema = z4.object({
  resume: tailoredResumeSchema,
  coverLetter: coverLetterDraftSchema,
});

export type ApplicationDraft = z4.infer<typeof applicationDraftSchema>;
