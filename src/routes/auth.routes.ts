import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const authRouter = Router();

/** POST /api/auth/register — first user = super_admin, others = pending guest. */
authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({ email: z.string().email(), password: z.string().min(6) })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid email and a password (min 6 chars) are required' });
    }
    const result = await authService.register(parsed.data.email, parsed.data.password);
    if (result.status === 'exists') return res.status(409).json({ error: 'Email already registered' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/login — approved users only (guests are pending). */
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Email and password are required' });
    const result = await authService.login(parsed.data.email, parsed.data.password);
    if (!result.ok) {
      return result.reason === 'pending'
        ? res.status(403).json({ error: 'Your account is pending admin approval' })
        : res.status(401).json({ error: 'Invalid email or password' });
    }
    res.json({ token: result.token, email: result.email, role: result.role });
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/me — current user from the Bearer token. */
authRouter.get('/me', requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user });
});

/** GET /api/auth/users — list all users (super_admin only). */
authRouter.get('/users', requireAuth, requireRole('super_admin'), async (_req, res, next) => {
  try {
    res.json(await authService.listUsers());
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/users/:id/role — approve/assign a role. */
authRouter.post(
  '/users/:id/role',
  requireAuth,
  requireRole('super_admin'),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const parsed = z.object({ role: z.enum(['super_admin', 'admin', 'bidder', 'guest']) }).safeParse(req.body);
      if (!Number.isInteger(id) || !parsed.success) {
        return res.status(400).json({ error: 'Invalid id or role' });
      }
      const target = parsed.data.role;
      const actor = req.user!;
      if (id === actor.id) return res.status(400).json({ error: 'You cannot change your own role' });
      if (target === 'super_admin') return res.status(403).json({ error: 'Cannot assign super_admin' });
      if (actor.role === 'admin' && target !== 'bidder') {
        return res.status(403).json({ error: 'Admins can only approve users as bidders' });
      }
      res.json(await authService.setRole(id, target));
    } catch (err) {
      next(err);
    }
  },
);
