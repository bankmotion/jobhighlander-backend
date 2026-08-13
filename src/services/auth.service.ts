import bcrypt from 'bcryptjs';
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

  listUsers() {
    return prisma.user.findMany({ orderBy: { createdAt: 'asc' }, select: PUBLIC_USER });
  },

  /** Approve/assign a user's role. Authorization is enforced in the route. */
  setRole(id: number, role: Role) {
    return prisma.user.update({ where: { id }, data: { role }, select: PUBLIC_USER });
  },
};
