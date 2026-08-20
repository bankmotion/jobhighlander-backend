import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { aiUsageService, MAX_PAGE_SIZE, MAX_RANGE_DAYS } from '../services/aiUsage.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const aiUsageRouter = Router();

const superAdminOnly = [requireAuth, requireRole('super_admin')];

const daysSchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_RANGE_DAYS).default(30),
});

/**
 * Optional narrowing for the admin views.
 *
 * A FILTER, not a scope. On `/me` a user id in the query string would be a
 * one-line path to reading someone else's spend; here the caller is already
 * cleared for every row, so choosing one user is just choosing a column to
 * look down. Blank strings are treated as absent so the UI can send
 * `?userId=` for "everyone" instead of conditionally building the URL.
 */
const adminQuerySchema = daysSchema.extend({
  userId: z.coerce.number().int().positive().optional().catch(undefined),
  profileId: z.coerce.number().int().positive().optional().catch(undefined),
});

const callsQuerySchema = adminQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/ai-usage/me?days=30 — the caller's own Anthropic spend.
 *
 * Open to every signed-in role. The user id comes from the verified token and
 * is passed to the service as a scope, never read from the query string. A
 * `?userId=` parameter here would be a one-line path to reading someone else's
 * spend, so the route never looks at one — `days` is the only input it forwards.
 *
 * The path says `/me` on purpose. A bare `GET /api/ai-usage` would read as
 * "all usage" to whoever touches this next, and the scope has to be obvious at
 * the call site to stay intact. The all-users view is `/all`, a separate path
 * behind a separate role check, and the two must never be merged into one
 * handler that decides which it is at runtime.
 */
aiUsageRouter.get('/me', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = daysSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: `days must be between 1 and ${MAX_RANGE_DAYS}` });
    }
    res.json(await aiUsageService.summary(parsed.data.days, req.user!.id));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ai-usage/all?days=30&userId=&profileId= — every user, every profile.
 *
 * SUPER ADMIN ONLY. One shared API key pays for all of it, so somebody has to
 * be able to see the whole bill and attribute it; that somebody is the role
 * that already administers users, prompts and scraper spend.
 *
 * Admins are NOT included. An admin owns profiles and shares them with bidders,
 * which would make this a view of what their bidders cost — a reasonable
 * feature, and a different one, needing per-profile ownership filtering rather
 * than this unfiltered read.
 */
aiUsageRouter.get('/all', ...superAdminOnly, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = adminQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: `days must be between 1 and ${MAX_RANGE_DAYS}` });
    }
    const { days, userId, profileId } = parsed.data;
    res.json(await aiUsageService.adminSummary(days, { userId, profileId }));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ai-usage/calls?days=30&userId=&profileId=&limit=50&offset=0
 *
 * SUPER ADMIN ONLY. The individual calls behind the totals, newest first, so a
 * surprising month can be traced to the generations that caused it.
 */
aiUsageRouter.get('/calls', ...superAdminOnly, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = callsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: `days must be between 1 and ${MAX_RANGE_DAYS}, limit between 1 and ${MAX_PAGE_SIZE}`,
      });
    }
    const { days, userId, profileId, limit, offset } = parsed.data;
    res.json(await aiUsageService.calls(days, { userId, profileId }, limit, offset));
  } catch (err) {
    next(err);
  }
});
