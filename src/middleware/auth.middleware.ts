import type { Request, Response, NextFunction } from 'express';
import { authService, type Role } from '../services/auth.service';

export interface AuthedRequest extends Request {
  user?: { id: number; email: string; role: Role };
}

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
    // The role is BAKED INTO the token, so a token issued before a role change
    // still asserts the old one. Authorization below already uses the database
    // role and was never fooled — but the token itself has to die too, or a
    // demoted user keeps a session that looks valid for the rest of its 24
    // hours and every screen they load is built from a role they no longer
    // hold. Rejecting on mismatch is what makes a role change log them out.
    if (user.role !== payload.role) {
      res.status(401).json({ error: 'Your access level changed. Sign in again.' });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
