import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { profilePromptService } from '../services/profilePrompt.service';
import { ResumeInputError } from '../services/resume.service';
import { AiProviderError, AI_PROVIDERS } from '../lib/ai';
import { CUSTOM_PROMPT_MAX } from '../schemas/promptCheck.schema';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const profilePromptRouter = Router();

/**
 * Admins, not just super admins.
 *
 * The super-admin Prompts screen edits the ONE prompt that governs everybody.
 * This edits an addendum that governs one profile its owner already controls,
 * so it belongs to the same tier as sharing a profile or choosing its resume
 * template. `ownedWhere` in the service is what stops it reaching anyone
 * else's.
 */
const adminOnly = [requireAuth, requireRole('admin', 'super_admin')];

const providerField = z.enum(AI_PROVIDERS).optional();

const saveSchema = z.object({
  content: z.string().max(CUSTOM_PROMPT_MAX + 1_000),
  provider: providerField,
});

const checkSchema = z.object({ provider: providerField });

function profileIdOf(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function failure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ResumeInputError || err instanceof AiProviderError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

profilePromptRouter.get(
  '/',
  adminOnly,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await profilePromptService.list(req.user!.id));
    } catch (err) {
      failure(err, res, next);
    }
  },
);

profilePromptRouter.put(
  '/:profileId',
  adminOnly,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const profileId = profileIdOf(req.params.profileId);
      if (!profileId) return res.status(400).json({ error: 'Invalid profile' });
      const parsed = saveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid content' });
      }
      res.json(
        await profilePromptService.save(
          profileId,
          parsed.data.content,
          req.user!.id,
          parsed.data.provider,
        ),
      );
    } catch (err) {
      failure(err, res, next);
    }
  },
);

/**
 * Re-run the review without editing.
 *
 * Separate from the save because the two fail differently: a save that cannot
 * be reviewed still succeeded, but a re-check that cannot run has nothing to
 * report and says so with a status rather than silently.
 */
profilePromptRouter.post(
  '/:profileId/check',
  adminOnly,
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const profileId = profileIdOf(req.params.profileId);
      if (!profileId) return res.status(400).json({ error: 'Invalid profile' });
      const parsed = checkSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
      res.json(await profilePromptService.check(profileId, req.user!.id, parsed.data.provider));
    } catch (err) {
      failure(err, res, next);
    }
  },
);
