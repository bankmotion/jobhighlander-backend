import { Prisma, type CreditEntryKind, type CryptoChain, type TopUpStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { logger } from './logger.service';

/**
 * Prepaid balance, in MICRO-USD throughout — the same unit as
 * `AiUsage.costMicroUsd`, so a generation's cost is subtracted with no
 * conversion and no rounding step where money could leak.
 *
 * USDT is treated as 1:1 with USD. That is an assumption of the deposit flow,
 * not a fact about the market, and it is why a super admin decides what a
 * transaction was worth rather than the app reading a price feed.
 */

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

/**
 * Where deposits go. One address, both chains — which is exactly why the chain
 * has to be recorded on the claim: it is the only thing that says which
 * explorer the hash can be found in.
 */
export const DEPOSIT_ADDRESS =
  env.USDT_DEPOSIT_ADDRESS ?? '0x1b254BB4D13C224145B1d34fAe16BeA43696BBef';

export const CHAINS = ['bep20', 'erc20'] as const;

export const CHAIN_LABEL: Readonly<Record<CryptoChain, string>> = {
  bep20: 'BNB Smart Chain (BEP20)',
  erc20: 'Ethereum (ERC20)',
};

/** Where a reviewer goes to check a hash. */
export const CHAIN_EXPLORER: Readonly<Record<CryptoChain, string>> = {
  bep20: 'https://bscscan.com/tx/',
  erc20: 'https://etherscan.io/tx/',
};

export const MICRO = 1_000_000;

/** Bounds on a single claim, in whole USDT. */
export const MIN_TOPUP_USD = 1;
export const MAX_TOPUP_USD = 100_000;

export const toMicro = (usd: number): number => Math.round(usd * MICRO);

/**
 * A hash is 0x + 64 hex on both chains. Validated because it is the one field
 * a reviewer has to act on, and a typo here costs a round trip each way.
 */
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export interface BalanceView {
  balanceMicroUsd: number;
  balanceUsd: number;
  /** False once the balance runs out — the AI generators check this. */
  canSpend: boolean;
}

export const balanceView = (balanceMicroUsd: number): BalanceView => ({
  balanceMicroUsd,
  balanceUsd: balanceMicroUsd / MICRO,
  canSpend: balanceMicroUsd > 0,
});

/**
 * Move a balance and record why, atomically.
 *
 * The cached column and the ledger row are written in one transaction so they
 * cannot disagree — a balance that no entry explains is unauditable, and an
 * entry with no balance change is a lie about what the user can spend.
 *
 * `amountMicroUsd` is signed: positive credits, negative spends.
 */
async function post(
  tx: Prisma.TransactionClient,
  input: {
    userId: number;
    kind: CreditEntryKind;
    amountMicroUsd: number;
    note?: string | null;
    aiUsageId?: number | null;
    topUpRequestId?: number | null;
    createdById?: number | null;
  },
): Promise<number> {
  // Incremented in the database rather than read-modify-written in Node: two
  // concurrent generations would otherwise both read the old balance and the
  // second would overwrite the first's debit.
  const user = await tx.user.update({
    where: { id: input.userId },
    data: { balanceMicroUsd: { increment: input.amountMicroUsd } },
    select: { balanceMicroUsd: true },
  });

  await tx.creditEntry.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      amountMicroUsd: input.amountMicroUsd,
      balanceAfterMicroUsd: user.balanceMicroUsd,
      note: input.note ?? null,
      aiUsageId: input.aiUsageId ?? null,
      topUpRequestId: input.topUpRequestId ?? null,
      createdById: input.createdById ?? null,
    },
  });

  return user.balanceMicroUsd;
}

export const billingService = {
  async balanceOf(userId: number): Promise<BalanceView> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balanceMicroUsd: true },
    });
    if (!user) throw new BillingError('User not found', 404);
    return balanceView(user.balanceMicroUsd);
  },

  /**
   * Charge a generation against the balance.
   *
   * Called AFTER the vendor has already answered, so it must never throw the
   * result away: the money is spent whether or not we manage to record it, and
   * a balance that silently drifts low is better than a user losing a document
   * they waited a minute for. Failures are logged, not raised.
   *
   * The balance is allowed to go negative here. The cost of a call is not known
   * until it returns, so the alternative is refusing to record a debt that has
   * already been incurred.
   */
  async chargeUsage(input: {
    userId: number;
    amountMicroUsd: number;
    aiUsageId?: number | null;
    note?: string;
  }): Promise<void> {
    if (input.amountMicroUsd <= 0) return;
    try {
      await prisma.$transaction((tx) =>
        post(tx, {
          userId: input.userId,
          kind: 'usage',
          amountMicroUsd: -input.amountMicroUsd,
          aiUsageId: input.aiUsageId ?? null,
          note: input.note ?? null,
        }),
      );
    } catch (err) {
      logger.error('Could not charge AI usage to the balance; it is now understated', {
        userId: input.userId,
        amountMicroUsd: input.amountMicroUsd,
        err: String(err),
      });
    }
  },

  /** A super admin moving a balance by hand, in either direction. */
  async adjust(input: {
    userId: number;
    amountMicroUsd: number;
    note: string;
    byId: number;
  }): Promise<BalanceView> {
    if (!Number.isInteger(input.amountMicroUsd) || input.amountMicroUsd === 0) {
      throw new BillingError('Adjustment must be a non-zero amount');
    }
    const balance = await prisma.$transaction((tx) =>
      post(tx, {
        userId: input.userId,
        kind: 'adjustment',
        amountMicroUsd: input.amountMicroUsd,
        note: input.note,
        createdById: input.byId,
      }),
    );
    logger.info('Balance adjusted by hand', {
      userId: input.userId,
      amountMicroUsd: input.amountMicroUsd,
      by: input.byId,
    });
    return balanceView(balance);
  },

  // ── Deposit claims ──────────────────────────────────────────────────────

  async submitTopUp(input: {
    userId: number;
    chain: CryptoChain;
    txHash: string;
    amountUsd: number;
    note?: string;
  }) {
    const txHash = input.txHash.trim();
    if (!TX_HASH.test(txHash)) {
      throw new BillingError(
        'That does not look like a transaction hash. It should be 0x followed by 64 characters.',
      );
    }
    if (
      !Number.isFinite(input.amountUsd) ||
      input.amountUsd < MIN_TOPUP_USD ||
      input.amountUsd > MAX_TOPUP_USD
    ) {
      throw new BillingError(`Amount must be between ${MIN_TOPUP_USD} and ${MAX_TOPUP_USD} USDT`);
    }

    try {
      return await prisma.topUpRequest.create({
        data: {
          userId: input.userId,
          chain: input.chain,
          txHash,
          claimedMicroUsd: toMicro(input.amountUsd),
          note: input.note?.trim() || null,
        },
        select: topUpSelect,
      });
    } catch (err) {
      // The unique index is what actually prevents one transaction being
      // claimed twice; this turns it into something the user can act on.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BillingError('That transaction has already been submitted.', 409);
      }
      throw err;
    }
  },

  listMyTopUps(userId: number) {
    return prisma.topUpRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: topUpSelect,
    });
  },

  /** The super admin queue. Pending first — those are the ones owed an answer. */
  listAllTopUps(status?: TopUpStatus) {
    return prisma.topUpRequest.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      select: { ...topUpSelect, user: { select: { id: true, email: true, balanceMicroUsd: true } } },
    });
  },

  countPendingTopUps: () => prisma.topUpRequest.count({ where: { status: 'pending' } }),

  getTopUp(id: number) {
    return prisma.topUpRequest.findUnique({ where: { id }, select: topUpSelect });
  },

  /**
   * Approve a claim and move the money.
   *
   * The credited amount is the REVIEWER'S, defaulting to what the user claimed
   * but never bound by it: the whole point of a human checking the chain is
   * that the two can differ.
   *
   * The status change and the credit share one transaction, and the status is
   * updated with `status: 'pending'` in the filter — so two admins approving
   * the same claim at once results in one credit, not two.
   */
  async creditTopUp(input: {
    id: number;
    creditedMicroUsd: number;
    reviewNote?: string;
    byId: number;
  }) {
    if (!Number.isInteger(input.creditedMicroUsd) || input.creditedMicroUsd <= 0) {
      throw new BillingError('Credit must be a positive amount');
    }

    return prisma.$transaction(async (tx) => {
      const claimed = await tx.topUpRequest.updateMany({
        where: { id: input.id, status: 'pending' },
        data: {
          status: 'credited',
          creditedMicroUsd: input.creditedMicroUsd,
          reviewNote: input.reviewNote?.trim() || null,
          reviewedById: input.byId,
          reviewedAt: new Date(),
        },
      });
      // Zero rows means somebody else already ruled on it. Refusing here is
      // what stops a double credit.
      if (claimed.count === 0) {
        throw new BillingError('That request has already been reviewed.', 409);
      }

      const row = await tx.topUpRequest.findUniqueOrThrow({
        where: { id: input.id },
        select: { userId: true },
      });

      await post(tx, {
        userId: row.userId,
        kind: 'topup',
        amountMicroUsd: input.creditedMicroUsd,
        note: input.reviewNote?.trim() || 'USDT deposit',
        topUpRequestId: input.id,
        createdById: input.byId,
      });

      return tx.topUpRequest.findUniqueOrThrow({ where: { id: input.id }, select: topUpSelect });
    });
  },

  async rejectTopUp(input: { id: number; reviewNote: string; byId: number }) {
    const done = await prisma.topUpRequest.updateMany({
      where: { id: input.id, status: 'pending' },
      data: {
        status: 'rejected',
        reviewNote: input.reviewNote.trim() || null,
        reviewedById: input.byId,
        reviewedAt: new Date(),
      },
    });
    if (done.count === 0) throw new BillingError('That request has already been reviewed.', 409);
    return prisma.topUpRequest.findUniqueOrThrow({ where: { id: input.id }, select: topUpSelect });
  },

  /** The user's own statement: what they were credited and what they spent. */
  ledger(userId: number, limit = 100) {
    return prisma.creditEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
      select: {
        id: true,
        kind: true,
        amountMicroUsd: true,
        balanceAfterMicroUsd: true,
        note: true,
        createdAt: true,
      },
    });
  },
};

const topUpSelect = {
  id: true,
  chain: true,
  txHash: true,
  claimedMicroUsd: true,
  creditedMicroUsd: true,
  status: true,
  note: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
} as const;
