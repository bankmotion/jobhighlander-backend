import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { logger } from './logger.service';

export type Role = 'super_admin' | 'admin' | 'bidder' | 'guest';

export interface AuthTokenPayload {
  sub: number;
  email: string;
  role: Role;
}

export type RegisterResult =
  | { status: 'active'; token: string; email: string; role: Role }
  | { status: 'pending'; email: string }
  | { status: 'exists' };

// `balanceMicroUsd` rides along because the user list is where an admin asks
// "why can this person not generate anything" — the answer is usually here.
const PUBLIC_USER = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  lastLoginAt: true,
  balanceMicroUsd: true,
} as const;

let googleClient: OAuth2Client | null = null;
function getGoogleClient(): OAuth2Client {
  if (!env.GOOGLE_CLIENT_ID) throw new GoogleNotConfiguredError();
  if (!googleClient) googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  return googleClient;
}

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super('GOOGLE_CLIENT_ID is not set');
    this.name = 'GoogleNotConfiguredError';
  }
}

function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
}

export type GoogleLoginResult =
  | { ok: true; token: string; email: string; role: Role }
  | { ok: false; reason: 'invalid' | 'unverified' | 'pending' };

/**
 * Stamp the sign-in.
 *
 * Never throws: a bookkeeping column must not be able to block someone from
 * logging in. A missing timestamp is a gap in a report; a failed login is an
 * outage.
 */
async function touchLogin(userId: number): Promise<void> {
  try {
    await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  } catch (err) {
    logger.warn('Could not record last login', { userId, err: String(err) });
  }
}

export const authService = {
  signToken(payload: AuthTokenPayload): string {
    return jwt.sign(payload, env.AUTH_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
  },

  verifyToken(token: string): AuthTokenPayload | null {
    try {
      return jwt.verify(token, env.AUTH_SECRET) as unknown as AuthTokenPayload;
    } catch {
      return null;
    }
  },

  async register(emailRaw: string, password: string): Promise<RegisterResult> {
    const email = emailRaw.toLowerCase().trim();
    if (await prisma.user.findUnique({ where: { email } })) return { status: 'exists' };

    const isFirst = (await prisma.user.count()) === 0;
    const role: Role = isFirst ? 'super_admin' : 'guest';
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, passwordHash, role } });

    if (user.role === 'guest') return { status: 'pending', email: user.email };
    return {
      status: 'active',
      token: this.signToken({ sub: user.id, email: user.email, role: user.role }),
      email: user.email,
      role: user.role,
    };
  },

  /**
   * An admin creating a bidder account outright.
   *
   * Active immediately — NOT `guest` awaiting approval. Self-registration
   * yields a guest precisely because nobody vouched for the person; here an
   * admin has, by naming the address, so a second approval step would only be
   * the same admin waiting on a super admin to confirm a decision they already
   * made.
   *
   * No password is set, because none is ever used: sign-in is Google-only, and
   * `loginWithGoogle` matches on the email. Pre-creating the row is what makes
   * the difference — without it that first Google sign-in would land in the
   * `guest` branch and wait for approval, which is the step being removed here.
   * The hash stored is random and undisclosed, so the password path cannot open
   * this account either.
   *
   * Fixed to `bidder`. Creating an admin or a super admin is a different act
   * with a different blast radius, and it stays where it was: a super admin
   * changing a role.
   */
  async createBidder(
    emailRaw: string,
    createdById: number,
  ): Promise<{ ok: true; id: number; email: string } | { ok: false; reason: 'exists' }> {
    const email = emailRaw.toLowerCase().trim();
    if (await prisma.user.findUnique({ where: { email } })) return { ok: false, reason: 'exists' };

    const user = await prisma.user.create({
      data: { email, passwordHash: await unusablePasswordHash(), role: 'bidder' },
      select: { id: true, email: true },
    });
    logger.info('Bidder account created by an admin', {
      bidderId: user.id,
      email: user.email,
      createdById,
    });
    return { ok: true, id: user.id, email: user.email };
  },

  async login(
    emailRaw: string,
    password: string,
  ): Promise<{ ok: true; token: string; email: string; role: Role } | { ok: false; reason: 'invalid' | 'pending' }> {
    const email = emailRaw.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return { ok: false, reason: 'invalid' };
    if (user.role === 'guest') return { ok: false, reason: 'pending' };
    await touchLogin(user.id);
    return {
      ok: true,
      token: this.signToken({ sub: user.id, email: user.email, role: user.role }),
      email: user.email,
      role: user.role,
    };
  },

  async loginWithGoogle(idToken: string): Promise<GoogleLoginResult> {
    let payload;
    try {
      const ticket = await getGoogleClient().verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID!,
      });
      payload = ticket.getPayload();
    } catch (err) {
      if (err instanceof GoogleNotConfiguredError) throw err;
      return { ok: false, reason: 'invalid' };
    }
    if (!payload?.email) return { ok: false, reason: 'invalid' };
    // Google sets this false for unverified addresses; trusting them would let
    // someone claim an email they do not control.
    if (payload.email_verified === false) return { ok: false, reason: 'unverified' };

    const email = payload.email.toLowerCase().trim();
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const isFirst = (await prisma.user.count()) === 0;
      user = await prisma.user.create({
        data: {
          email,
          passwordHash: await unusablePasswordHash(),
          role: isFirst ? 'super_admin' : 'guest',
        },
      });
    }
    if (user.role === 'guest') return { ok: false, reason: 'pending' };
    await touchLogin(user.id);
    return {
      ok: true,
      token: this.signToken({ sub: user.id, email: user.email, role: user.role as Role }),
      email: user.email,
      role: user.role as Role,
    };
  },

  listUsers() {
    return prisma.user.findMany({ orderBy: { createdAt: 'asc' }, select: PUBLIC_USER });
  },

  async getAuthUser(id: number): Promise<{ id: number; email: string; role: Role } | null> {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true },
    });
    return user ? { id: user.id, email: user.email, role: user.role as Role } : null;
  },

  setRole(id: number, role: Role) {
    return prisma.user.update({ where: { id }, data: { role }, select: PUBLIC_USER });
  },
};
