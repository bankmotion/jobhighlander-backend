import { z } from 'zod';
import * as z4 from 'zod/v4';

export const coverLetterRequestSchema = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
  notes: z.string().trim().max(4_000).optional().default(''),
});

export type CoverLetterRequest = z.infer<typeof coverLetterRequestSchema>;

export const coverLetterUpdateSchema = z.object({
  jobId: z.coerce.number().int().positive(),
  profileId: z.coerce.number().int().positive(),
  body: z.string().max(20_000),
});

export const coverLetterDraftSchema = z4.object({
  paragraphs: z4
    .array(z4.string())
    .describe(
      'The letter body: 3 paragraphs (2 if brief). Plain prose, no salutation, ' +
        'no sign-off, no markdown, no bullet points. Each is one paragraph of ' +
        'continuous text.',
    ),
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
