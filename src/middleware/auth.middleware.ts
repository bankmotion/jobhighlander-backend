import type { Request, Response, NextFunction } from 'express';
import { authService, type Role } from '../services/auth.service';

export interface AuthedRequest extends Request {
  user?: { id: number; email: string; role: Role };
}

/** Require a valid Bearer token. The Next.js server forwards the session JWT. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token ? authService.verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = { id: payload.sub, email: payload.email, role: payload.role };
  next();
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
