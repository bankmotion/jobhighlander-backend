import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { aiUsageService, MAX_RANGE_DAYS } from '../services/aiUsage.service';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

export const aiUsageRouter = Router();

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_RANGE_DAYS).default(30),
});

/**
 * GET /api/ai-usage/me?days=30 — the caller's own Anthropic spend.
 *
 * Open to every signed-in role, and it is the ONLY way to read this table:
 * everyone sees their own spend and nobody sees anyone else's, so there is no
 * companion endpoint that returns everything.
 *
 * The user id comes from the verified token and is passed to the service as a
 * scope, never read from the query string. A `?userId=` parameter here would be
 * a one-line path to reading someone else's spend, so the route never looks at
 * one — `days` is the only input it forwards.
 *
 * The path says `/me` on purpose. A bare `GET /api/ai-usage` would read as
 * "all usage" to whoever touches this next, and the scope has to be obvious at
 * the call site to stay intact.
 */
aiUsageRouter.get('/me', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: `days must be between 1 and ${MAX_RANGE_DAYS}` });
    }
    res.json(await aiUsageService.summary(parsed.data.days, req.user!.id));
  } catch (err) {
    next(err);
  }
});
