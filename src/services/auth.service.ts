import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';

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

const PUBLIC_USER = { id: true, email: true, role: true, createdAt: true } as const;

/** Lazily built so a missing GOOGLE_CLIENT_ID surfaces at sign-in, not at import. */
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

/**
 * Placeholder for the NOT NULL `passwordHash` column on Google-created users.
 *
 * The column is deliberately kept (password sign-in may return later), but a
 * Google user has no password. Storing the bcrypt hash of a random secret means
 * the row satisfies the constraint while being impossible to authenticate
 * against: no password anyone can type will ever match, and `bcrypt.compare`
 * still runs normally rather than throwing on a malformed hash.
 */
function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
}

export type GoogleLoginResult =
  | { ok: true; token: string; email: string; role: Role }
  | { ok: false; reason: 'invalid' | 'unverified' | 'pending' };

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

  /**
   * Register a user. The very first user becomes super_admin (can log in
   * immediately); everyone else starts as a `guest` awaiting approval.
   */
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

  /** Validate credentials. Guests are rejected as pending approval. */
  async login(
    emailRaw: string,
    password: string,
  ): Promise<{ ok: true; token: string; email: string; role: Role } | { ok: false; reason: 'invalid' | 'pending' }> {
    const email = emailRaw.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return { ok: false, reason: 'invalid' };
    if (user.role === 'guest') return { ok: false, reason: 'pending' };
    return {
      ok: true,
      token: this.signToken({ sub: user.id, email: user.email, role: user.role }),
      email: user.email,
      role: user.role,
    };
  },

  /**
   * Sign in with a Google ID token.
   *
   * A first-time Google user is CREATED here, mirroring the password register
   * flow: the very first user in an empty database becomes super_admin, and
   * everyone after that lands as a pending `guest` for a super_admin to
   * approve. Signing in and registering are the same action for Google, so
   * there is no separate signup step.
   */
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

  /**
   * Current identity + role straight from the DB. Used to authorize every
   * request so a role change takes effect immediately, rather than being
   * trusted from the (possibly stale) JWT. Returns null if the user is gone.
   */
  async getAuthUser(id: number): Promise<{ id: number; email: string; role: Role } | null> {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true },
    });
    return user ? { id: user.id, email: user.email, role: user.role as Role } : null;
  },

  /** Approve/assign a user's role. Authorization is enforced in the route. */
  setRole(id: number, role: Role) {
    return prisma.user.update({ where: { id }, data: { role }, select: PUBLIC_USER });
  },
};
