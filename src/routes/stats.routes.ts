import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { statsService, type StatsWindow } from '../services/stats.service';
import { endOfZonedDate, resolveZone, startOfZonedDate, startOfZonedDay } from '../lib/zone';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const statsRouter = Router();

const DAY = 86_400_000;
const MAX_SPAN_DAYS = 366;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const query = z.object({
  // Bounded: the aggregation loads the window's rows into memory, and a
  // multi-year range is a slow query for a chart nobody reads that far back.
  days: z.coerce.number().int().min(1).max(365).optional(),
  // 'today' is the calendar day so far and is NOT `days=1`, which is a rolling
  // 24 hours here. Both are offered because they answer different questions:
  // "how has today gone" versus "what happened since this time yesterday".
  preset: z.enum(['today', '24h']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  profileId: z.coerce.number().int().positive().optional(),
  // Which bidder's stats to show. Absent = the caller's own, 'all' = everyone
  // with access to the in-scope profiles, a number = that teammate.
  bidder: z.union([z.literal('all'), z.coerce.number().int().positive()]).optional(),
  // The viewer's display zone. Absent or unknown falls back to UTC, which is
  // what this did before zones were threaded through at all.
  tz: z.string().trim().max(64).optional(),
});

function resolveWindow(q: z.infer<typeof query>): StatsWindow | { error: string } {
  const zone = resolveZone(q.tz);

  if (q.from || q.to) {
    if (!q.from || !q.to) return { error: 'Both from and to are required for a custom range' };
    // The dates a person picks are dates in THEIR calendar, so they bound the
    // local day, not the UTC one. Picking today used to return a window that
    // started an hour late or ended five hours early depending on the zone.
    const from = startOfZonedDate(q.from, zone);
    const to = endOfZonedDate(q.to, zone);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { error: 'Invalid dates' };
    if (from > to) return { error: 'from must be on or before to' };
    if (to.getTime() - from.getTime() > MAX_SPAN_DAYS * DAY) {
      return { error: `Range cannot exceed ${MAX_SPAN_DAYS} days` };
    }
    return { from, to, zone };
  }
  const to = new Date();

  if (q.preset === 'today') {
    // Local midnight to now. Distinct from the rolling window below: at 09:00
    // this is nine hours of data, not twenty-four.
    return { from: startOfZonedDay(to, zone), to, zone };
  }

  // 24 hours by default: the question these pages answer is "how is today
  // going", and a 90-day window buried that in a quarter of history.
  const days = q.preset === '24h' ? 1 : (q.days ?? 1);
  // Rolling window: a fixed span backwards from now, so it is zone-independent
  // by definition. The zone still rides along because the BUCKETS are local.
  return { from: new Date(to.getTime() - days * DAY), to, zone };
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
