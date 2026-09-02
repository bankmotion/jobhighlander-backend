import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  aiUsageService,
  RangeError,
  MAX_PAGE_SIZE,
  MAX_RANGE_DAYS,
  type RangeInput,
} from '../services/aiUsage.service';
import {
  aiRateService,
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
} from '../services/aiRate.service';
import { AI_PROVIDERS } from '../lib/ai';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const aiUsageRouter = Router();

const superAdminOnly = [requireAuth, requireRole('super_admin')];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * `days` stays the default so links and stored preferences saved before
 * presets existed keep working. `preset` and `from`/`to` are additive.
 */
const daysSchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_RANGE_DAYS).default(30),
  preset: z.enum(['today', '24h']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const toRange = (q: z.infer<typeof daysSchema>): RangeInput => ({
  days: q.days,
  preset: q.preset,
  from: q.from,
  to: q.to,
});

/**
 * A bad range is the caller's mistake and has a specific fix ("to is before
 * from"), so it is reported rather than folded into a generic 400.
 */
function rangeFailure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof RangeError) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
}

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
    res.json(await aiUsageService.summary(toRange(parsed.data), req.user!.id));
  } catch (err) {
    rangeFailure(err, res, next);
  }
});

aiUsageRouter.get('/all', ...superAdminOnly, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = adminQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: `days must be between 1 and ${MAX_RANGE_DAYS}` });
    }
    const { userId, profileId } = parsed.data;
    res.json(await aiUsageService.adminSummary(toRange(parsed.data), { userId, profileId }));
  } catch (err) {
    rangeFailure(err, res, next);
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
    const { userId, profileId, limit, offset } = parsed.data;
    res.json(
      await aiUsageService.calls(toRange(parsed.data), { userId, profileId }, limit, offset),
    );
  } catch (err) {
    rangeFailure(err, res, next);
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

