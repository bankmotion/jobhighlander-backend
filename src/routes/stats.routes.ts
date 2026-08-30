import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { statsService } from '../services/stats.service';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

export const statsRouter = Router();

const query = z.object({
  // Bounded: the aggregation loads the window's rows into memory, and a
  // multi-year range is a slow query for a chart nobody reads that far back.
  days: z.coerce.number().int().min(1).max(365).default(90),
  profileId: z.coerce.number().int().positive().optional(),
});

/**
 * GET /api/stats/bid-performance?days=90&profileId=
 *
 * Open to every signed-in role. Scoping happens inside the service against the
 * profiles the caller may use, so a bidder sees their own pipeline and nobody
 * sees a profile they were not invited to.
 */
statsRouter.get('/bid-performance', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = query.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { days, profileId } = parsed.data;
    res.json(await statsService.bidPerformance(req.user!.id, days, profileId));
  } catch (err) {
    next(err);
  }
});
