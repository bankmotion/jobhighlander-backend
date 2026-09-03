import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  billingService,
  BillingError,
  CHAINS,
  CHAIN_EXPLORER,
  CHAIN_LABEL,
  DEPOSIT_ADDRESS,
  MAX_TOPUP_USD,
  MIN_TOPUP_USD,
  toMicro,
} from '../services/billing.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const billingRouter = Router();

const superAdminOnly = [requireAuth, requireRole('super_admin')];

function failure(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof BillingError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

/** Balance for the top bar. Deliberately tiny — it is read on every page load. */
billingRouter.get('/balance', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json(await billingService.balanceOf(req.user!.id));
  } catch (err) {
    failure(err, res, next);
  }
});

/**
 * Everything the top-up page needs to render: where to send, on which chains,
 * and the limits. Served rather than hard-coded in the client so the address
 * lives in one place — a wrong address on a payment page loses real money.
 */
billingRouter.get('/deposit', requireAuth, (_req: AuthedRequest, res: Response) => {
  res.json({
    address: DEPOSIT_ADDRESS,
    chains: CHAINS.map((id) => ({ id, label: CHAIN_LABEL[id], explorer: CHAIN_EXPLORER[id] })),
    minUsd: MIN_TOPUP_USD,
    maxUsd: MAX_TOPUP_USD,
  });
});

billingRouter.get('/ledger', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ entries: await billingService.ledger(req.user!.id) });
  } catch (err) {
    failure(err, res, next);
  }
});

// ── Deposit claims ────────────────────────────────────────────────────────

const submitSchema = z.object({
  chain: z.enum(CHAINS),
  txHash: z.string().trim().min(1).max(120),
  amountUsd: z.coerce.number(),
  note: z.string().trim().max(500).optional(),
});

billingRouter.get('/top-ups', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ requests: await billingService.listMyTopUps(req.user!.id) });
  } catch (err) {
    failure(err, res, next);
  }
});

billingRouter.post('/top-ups', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    }
    const request = await billingService.submitTopUp({ ...parsed.data, userId: req.user!.id });
    res.status(201).json({ request });
  } catch (err) {
    failure(err, res, next);
  }
});

// ── Review queue (super admin) ────────────────────────────────────────────

/**
 * Just the count, for the sidebar badge.
 *
 * Its own endpoint rather than counting the full list: this is read on every
 * page load, and shipping up to 200 claim rows to render one number would put
 * the whole queue on the wire for every navigation.
 *
 * Two segments, so it cannot be captured by the '/top-ups/:id/...' routes below.
 */
billingRouter.get('/top-ups/pending-count', ...superAdminOnly, async (_req: AuthedRequest, res, next) => {
  try {
    res.json({ pending: await billingService.countPendingTopUps() });
  } catch (err) {
    failure(err, res, next);
  }
});

billingRouter.get('/top-ups/all', ...superAdminOnly, async (req: AuthedRequest, res, next) => {
  try {
    const status = z.enum(['pending', 'credited', 'rejected']).optional().safeParse(req.query.status);
    res.json({ requests: await billingService.listAllTopUps(status.data) });
  } catch (err) {
    failure(err, res, next);
  }
});

const decisionSchema = z.object({
  // Absent means "credit exactly what they claimed". Present overrides it,
  // because the reviewer has looked at the chain and the user has not.
  amountUsd: z.coerce.number().positive().max(MAX_TOPUP_USD).optional(),
  reviewNote: z.string().trim().max(500).optional(),
});

billingRouter.post('/top-ups/:id/credit', ...superAdminOnly, async (req: AuthedRequest, res, next) => {
  try {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id' });
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });

    // Default to what the user claimed when the reviewer names no figure —
    // approving "as submitted" is the common case and should not require
    // retyping the number.
    let creditedMicroUsd = parsed.data.amountUsd != null ? toMicro(parsed.data.amountUsd) : null;
    if (creditedMicroUsd == null) {
      const existing = await billingService.getTopUp(id.data);
      if (!existing) return res.status(404).json({ error: 'Request not found' });
      creditedMicroUsd = existing.claimedMicroUsd;
    }

    const request = await billingService.creditTopUp({
      id: id.data,
      creditedMicroUsd,
      reviewNote: parsed.data.reviewNote,
      byId: req.user!.id,
    });
    res.json({ request });
  } catch (err) {
    failure(err, res, next);
  }
});

billingRouter.post('/top-ups/:id/reject', ...superAdminOnly, async (req: AuthedRequest, res, next) => {
  try {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id' });
    const parsed = z
      .object({ reviewNote: z.string().trim().min(1).max(500) })
      .safeParse(req.body);
    if (!parsed.success) {
      // A rejection with no reason is unanswerable for the person who paid.
      return res.status(400).json({ error: 'Say why it was rejected' });
    }
    const request = await billingService.rejectTopUp({
      id: id.data,
      reviewNote: parsed.data.reviewNote,
      byId: req.user!.id,
    });
    res.json({ request });
  } catch (err) {
    failure(err, res, next);
  }
});

/** Per-account totals and the margin, for the payments screen. */
billingRouter.get('/overview', ...superAdminOnly, async (_req: AuthedRequest, res, next) => {
  try {
    res.json(await billingService.overview());
  } catch (err) {
    failure(err, res, next);
  }
});

/** The money history, across everyone. */
billingRouter.get('/entries', ...superAdminOnly, async (req: AuthedRequest, res, next) => {
  try {
    const q = z
      .object({
        kind: z.enum(['topup', 'usage', 'adjustment']).optional(),
        userId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Invalid query' });
    res.json({ entries: await billingService.allEntries(q.data) });
  } catch (err) {
    failure(err, res, next);
  }
});

/** Accounts a super admin can credit, with what they currently hold. */
billingRouter.get('/users', ...superAdminOnly, async (_req: AuthedRequest, res, next) => {
  try {
    res.json({ users: await billingService.usersForCredit() });
  } catch (err) {
    failure(err, res, next);
  }
});

/** Hand adjustment, either direction. Kept separate from the claim flow. */
const adjustSchema = z.object({
  userId: z.coerce.number().int().positive(),
  amountUsd: z.coerce.number().refine((v) => v !== 0, 'Amount cannot be zero'),
  note: z.string().trim().min(1).max(500),
});

billingRouter.post('/adjust', ...superAdminOnly, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    }
    const { userId, amountUsd, note } = parsed.data;
    res.json(
      await billingService.adjust({
        userId,
        amountMicroUsd: toMicro(amountUsd),
        note,
        byId: req.user!.id,
      }),
    );
  } catch (err) {
    failure(err, res, next);
  }
});

