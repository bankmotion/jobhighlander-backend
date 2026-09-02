import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { aiUsageService, MAX_PAGE_SIZE, MAX_RANGE_DAYS } from '../services/aiUsage.service';
import {
  aiRateService,
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
} from '../services/aiRate.service';
import { AI_PROVIDERS } from '../lib/ai';
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

// ── Cost markup ──────────────────────────────────────────────────────────
// What this deployment charges over the vendor's list price, per provider.
//
// Super admin only in both directions. Reading it exposes the margin the
// business runs on, which is not something a bidder needs; writing it changes
// what every future call costs.

aiUsageRouter.get('/rates', ...superAdminOnly, async (_req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ rates: await aiRateService.list() });
  } catch (err) {
    next(err);
  }
});

const rateUpdateSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  // A plain decimal, because that is what a person types: 1.2, not 12000 bp.
  // The basis-point conversion is the server's business.
  multiplier: z.coerce.number().min(MIN_MULTIPLIER).max(MAX_MULTIPLIER),
});

aiUsageRouter.put('/rates', ...superAdminOnly, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = rateUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: `multiplier must be a number between ${MIN_MULTIPLIER} and ${MAX_MULTIPLIER}`,
      });
    }
    const { provider, multiplier } = parsed.data;
    // Applies to calls made FROM NOW ON. Rows already recorded keep the markup
    // they were priced at — see aiRate.service.ts.
    const rate = await aiRateService.set(provider, multiplier, req.user?.email ?? null);
    res.json({ rate });
  } catch (err) {
    next(err);
  }
});

