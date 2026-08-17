import type { Request, Response, NextFunction } from 'express';
import { authService, type Role } from '../services/auth.service';

export interface AuthedRequest extends Request {
  user?: { id: number; email: string; role: Role };
}

/**
 * Require a valid Bearer token. The Next.js server forwards the session JWT.
 *
 * The role is re-read from the database on every request (not trusted from the
 * token), so a role change takes effect immediately. A user who has been
 * revoked back to a pending `guest`, or deleted, is treated as signed-out.
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token ? authService.verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const user = await authService.getAuthUser(payload.sub);
    if (!user || user.role === 'guest') {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Require the authed user to hold one of `roles` (use after requireAuth). */
export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
