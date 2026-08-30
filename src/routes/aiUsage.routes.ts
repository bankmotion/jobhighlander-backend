import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { aiUsageService, MAX_PAGE_SIZE, MAX_RANGE_DAYS } from '../services/aiUsage.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const aiUsageRouter = Router();

const superAdminOnly = [requireAuth, requireRole('super_admin')];

const daysSchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_RANGE_DAYS).default(30),
});

const adminQuerySchema = daysSchema.extend({
  userId: z.coerce.number().int().positive().optional().catch(undefined),
  profileId: z.coerce.number().int().positive().optional().catch(undefined),
});

const callsQuerySchema = adminQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

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
