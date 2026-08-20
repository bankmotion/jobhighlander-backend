import { prisma } from '../lib/prisma';
import { ownedProfileWhere } from './profile.service';

/** Mirrors the Prisma `InvitationStatus` enum. */
export type InvitationStatus = 'pending' | 'accepted' | 'declined';

/** Raised for a rejected invitation; the route turns it into a status code. */
export class InvitationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'InvitationError';
  }
}

const invitedUserSelect = {
  id: true,
  status: true,
  createdAt: true,
  respondedAt: true,
  user: { select: { id: true, email: true, role: true } },
} as const;

const profileLabelSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  location: true,
  owner: { select: { id: true, email: true } },
} as const;

/** Assert the profile exists AND belongs to `ownerId`, or throw a 404. */
async function assertOwned(profileId: number, ownerId: number): Promise<void> {
  const owned = await prisma.profile.findFirst({
    where: { id: profileId, ...ownedProfileWhere(ownerId) },
    select: { id: true },
  });
  // Not-yours and does-not-exist are the same 404 on purpose: a 403 here would
  // let anyone enumerate which profile ids are real.
  if (!owned) throw new InvitationError('Profile not found', 404);
}

/**
 * Invitations to use a profile.
 *
 * Sending is owner-side, answering is invitee-side, and the two never share a
 * code path — an owner cannot accept on someone's behalf, and an invitee cannot
 * create an invitation for themselves.
 */
export const invitationService = {
  /** Every profile this owner has, each with who it is shared with. */
  async listByOwner(ownerId: number) {
    const profiles = await prisma.profile.findMany({
      where: ownedProfileWhere(ownerId),
      orderBy: { updatedAt: 'desc' },
      select: {
        ...profileLabelSelect,
        invitations: { orderBy: { createdAt: 'desc' }, select: invitedUserSelect },
      },
    });
    return profiles;
  },

  /** Who one profile is shared with. Owner-only. */
  async listForProfile(profileId: number, ownerId: number) {
    await assertOwned(profileId, ownerId);
    return prisma.profileInvitation.findMany({
      where: { profileId },
      orderBy: { createdAt: 'desc' },
      select: invitedUserSelect,
    });
  },

  /**
   * Invite the holder of `email` to use `profileId`.
   *
   * Addressed by email, not by user id, deliberately: an admin has no business
   * reading the user table, so nothing here lists accounts to them. They type
   * the address of someone they already know.
   *
   * Upsert rather than insert: (profile, user) is unique, so re-inviting after a
   * decline reopens that same row as `pending` instead of failing on the
   * constraint. An already-accepted invitation is left alone — resetting it to
   * pending would silently revoke access the owner did not ask to revoke.
   */
  async invite(profileId: number, ownerId: number, emailRaw: string) {
    await assertOwned(profileId, ownerId);

    const email = emailRaw.toLowerCase().trim();
    const target = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });
    // Naming the reason rather than a flat "not found": an admin typing an
    // address needs to know whether to fix a typo or chase an approval. It does
    // confirm that an address has an account here, which is the unavoidable
    // cost of inviting by email at all.
    if (!target) throw new InvitationError('No account with that email address', 404);
    // Guests are unapproved accounts that cannot sign in at all; inviting one
    // would create an invitation nobody could ever answer.
    if (target.role === 'guest') {
      throw new InvitationError('That account is still awaiting approval', 400);
    }
    if (target.id === ownerId) {
      throw new InvitationError('You already own this profile', 400);
    }

    const userId = target.id;
    const existing = await prisma.profileInvitation.findUnique({
      where: { profileId_userId: { profileId, userId } },
      select: { id: true, status: true },
    });
    if (existing?.status === 'accepted') {
      throw new InvitationError('That user already has access', 409);
    }

    return prisma.profileInvitation.upsert({
      where: { profileId_userId: { profileId, userId } },
      create: { profileId, userId, invitedById: ownerId, status: 'pending' },
      update: { status: 'pending', invitedById: ownerId, respondedAt: null },
      select: invitedUserSelect,
    });
  },

  /**
   * Withdraw an invitation / revoke access. Owner-only.
   *
   * A hard delete, not a `declined` row: `declined` means "the invitee said no",
   * and overloading it with "the owner took it back" would show the owner an
   * answer the invitee never gave.
   */
  async revoke(profileId: number, ownerId: number, userId: number): Promise<boolean> {
    await assertOwned(profileId, ownerId);
    const r = await prisma.profileInvitation.deleteMany({ where: { profileId, userId } });
    return r.count > 0;
  },

  /** Invitations addressed to this user, newest first. */
  listForUser(userId: number, status?: InvitationStatus) {
    return prisma.profileInvitation.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        respondedAt: true,
        profile: { select: profileLabelSelect },
        invitedBy: { select: { id: true, email: true } },
      },
    });
  },

  /** How many invitations are still waiting on this user — drives the nav badge. */
  pendingCount(userId: number): Promise<number> {
    return prisma.profileInvitation.count({ where: { userId, status: 'pending' } });
  },

  /**
   * Answer an invitation. Only its addressee may, and `updateMany` scoped by
   * `userId` is what enforces that: a mismatched id updates nothing and comes
   * back as a 404 rather than touching someone else's row.
   *
   * Declining an already-accepted invitation is allowed on purpose — that is how
   * an invitee gives back access they no longer want.
   */
  async respond(
    invitationId: number,
    userId: number,
    status: 'accepted' | 'declined',
  ): Promise<boolean> {
    const r = await prisma.profileInvitation.updateMany({
      where: { id: invitationId, userId },
      data: { status, respondedAt: new Date() },
    });
    return r.count > 0;
  },
};
