import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { statsService } from '../services/stats.service';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

export const statsRouter = Router();

const DAY = 86_400_000;
const MAX_SPAN_DAYS = 366;

/** `YYYY-MM-DD`, the shape an <input type="date"> submits. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const query = z.object({
  // Bounded: the aggregation loads the window's rows into memory, and a
  // multi-year range is a slow query for a chart nobody reads that far back.
  days: z.coerce.number().int().min(1).max(365).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  profileId: z.coerce.number().int().positive().optional(),
});

/**
 * Resolve the window.
 *
 * An explicit `from`/`to` wins over `days`, so a custom range is not silently
 * overridden by a stale preset in the same URL. Dates are read as whole UTC days
 * — `from` at 00:00 and `to` at 23:59:59.999 — because the picker offers days,
 * and a `to` parsed at midnight would exclude everything that happened that day.
 */
function resolveWindow(q: z.infer<typeof query>): { from: Date; to: Date } | { error: string } {
  if (q.from || q.to) {
    if (!q.from || !q.to) return { error: 'Both from and to are required for a custom range' };
    const from = new Date(`${q.from}T00:00:00.000Z`);
    const to = new Date(`${q.to}T23:59:59.999Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { error: 'Invalid dates' };
    if (from > to) return { error: 'from must be on or before to' };
    if (to.getTime() - from.getTime() > MAX_SPAN_DAYS * DAY) {
      return { error: `Range cannot exceed ${MAX_SPAN_DAYS} days` };
    }
    return { from, to };
  }
  const to = new Date();
  return { from: new Date(to.getTime() - (q.days ?? 90) * DAY), to };
}

/**
 * GET /api/stats/bid-performance?days=90
 * GET /api/stats/bid-performance?from=2026-08-01&to=2026-08-27
 *
 * Open to every signed-in role. Scoping happens inside the service against the
 * profiles the caller may use, so a bidder sees their own pipeline and nobody
 * sees a profile they were not invited to.
 */
statsRouter.get('/bid-performance', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = query.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const window = resolveWindow(parsed.data);
    if ('error' in window) return res.status(400).json({ error: window.error });
    res.json(await statsService.bidPerformance(req.user!.id, window, parsed.data.profileId));
  } catch (err) {
    next(err);
  }
});
