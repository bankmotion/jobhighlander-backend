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

/**
 * The HOUSE STYLE ADDENDUM to draft with, overriding the profile's own.
 *
 * The three states are all meaningful and all distinct, which is why this is
 * `optional()` and not `default('')`:
 *   absent      — use whatever the profile holds. What a client that predates
 *                 this field sends, and what the Cover Letter tab sends.
 *   ""          — deliberately cleared for this one generation. Must NOT fall
 *                 back to the profile, or the field could never be emptied.
 *   some text   — tuned for this posting, and not written back to the profile.
 *
 * Capped a little above `CUSTOM_PROMPT_MAX` rather than at it: the admin screen
 * enforces the real limit, and rejecting a request outright over a handful of
 * characters would lose a generation the user already waited to configure.
 */
export const customPromptField = z.string().max(6_000).optional();

export const applicationRequestSchema = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
  notes: z.string().trim().max(4_000).optional().default(''),
  provider: providerField,
  customPrompt: customPromptField,
});

export type ApplicationRequest = z.infer<typeof applicationRequestSchema>;

export const applicationDraftSchema = z4.object({
  resume: tailoredResumeSchema,
  coverLetter: coverLetterDraftSchema,
});

export type ApplicationDraft = z4.infer<typeof applicationDraftSchema>;
