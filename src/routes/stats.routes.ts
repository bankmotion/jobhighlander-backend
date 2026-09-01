import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { statsService } from '../services/stats.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const statsRouter = Router();

const DAY = 86_400_000;
const MAX_SPAN_DAYS = 366;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const query = z.object({
  // Bounded: the aggregation loads the window's rows into memory, and a
  // multi-year range is a slow query for a chart nobody reads that far back.
  days: z.coerce.number().int().min(1).max(365).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  profileId: z.coerce.number().int().positive().optional(),
  // Which bidder's stats to show. Absent = the caller's own, 'all' = everyone
  // with access to the in-scope profiles, a number = that teammate.
  bidder: z.union([z.literal('all'), z.coerce.number().int().positive()]).optional(),
});

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
  // 24 hours by default: the question these pages answer is "how is today
  // going", and a 90-day window buried that in a quarter of history.
  return { from: new Date(to.getTime() - (q.days ?? 1) * DAY), to };
}

// Every profile in the system with its members, for oversight. Super-admin
// only: it deliberately ignores profile membership, which is the rule that
// keeps one team's activity out of another team's view everywhere else.
//
// Registered BEFORE '/bid-performance' would not matter — the paths differ —
// but it shares the same window parser so the two views cannot drift on what
// "last 7 days" means.
statsRouter.get(
  '/bid-performance/all',
  requireAuth,
  requireRole('super_admin'),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = query.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
      const window = resolveWindow(parsed.data);
      if ('error' in window) return res.status(400).json({ error: window.error });
      res.json(
        await statsService.teamBidPerformance(window, {
          profileId: parsed.data.profileId,
          // 'all' is the default, so it needs no id; anything else names one.
          bidder: typeof parsed.data.bidder === 'number' ? parsed.data.bidder : undefined,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

statsRouter.get('/bid-performance', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = query.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const window = resolveWindow(parsed.data);
    if ('error' in window) return res.status(400).json({ error: window.error });
    res.json(
      await statsService.bidPerformance(req.user!.id, window, {
        profileId: parsed.data.profileId,
        bidder: parsed.data.bidder,
      }),
    );
  } catch (err) {
    next(err);
  }
});
