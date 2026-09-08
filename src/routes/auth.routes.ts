import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authService, GoogleNotConfiguredError } from '../services/auth.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const authRouter = Router();

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

authRouter.post('/google', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ credential: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'A Google credential is required' });

    const result = await authService.loginWithGoogle(parsed.data.credential);
    if (!result.ok) {
      if (result.reason === 'pending') {
        return res.status(403).json({ error: 'Your account is pending admin approval' });
      }
      if (result.reason === 'unverified') {
        return res.status(403).json({ error: 'Your Google email address is not verified' });
      }
      return res.status(401).json({ error: 'Google sign-in failed' });
    }
    res.json({ token: result.token, email: result.email, role: result.role });
  } catch (err) {
    if (err instanceof GoogleNotConfiguredError) {
      return res.status(503).json({ error: 'Google sign-in is not configured on the server' });
    }
    next(err);
  }
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user });
});

authRouter.get('/users', requireAuth, requireRole('super_admin'), async (_req, res, next) => {
  try {
    res.json(await authService.listUsers());
  } catch (err) {
    next(err);
  }
});

/**
 * An admin creating a bidder account.
 *
 * Admin-level, not super-admin: admins are the ones who bring bidders on, and
 * routing that through a super admin made onboarding wait on someone who was
 * not part of the decision. The account is usable at once — see
 * `authService.createBidder` for why there is no approval step.
 *
 * The role is NOT taken from the body. Accepting one would turn this into
 * "create a user with any role you name", which is a different power from the
 * one being granted here.
 *
 * The address is the whole payload: the person signs in with Google, and this
 * row is what tells that sign-in they are already a bidder rather than a guest
 * waiting on approval.
 */
/**
 * The sign-up queue: accounts still waiting for a role.
 *
 * Admin-level, where the full listing above is super-admin only. Admins are
 * already allowed to turn a guest into a bidder, and without this they had no
 * way to discover there was a guest to turn — the permission existed but was
 * unreachable. Restricted to guests so that reaching it grants exactly the
 * ability to clear the queue and nothing else about who else has an account.
 */
authRouter.get(
  '/users/pending',
  requireAuth,
  requireRole('admin', 'super_admin'),
  async (_req, res, next) => {
    try {
      res.json(await authService.listPendingUsers());
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/users',
  requireAuth,
  requireRole('admin', 'super_admin'),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      // Email only. Sign-in is Google-only, so a password collected here would
      // be a credential nobody could ever use.
      const parsed = z
        .object({ email: z.string().trim().email().max(255) })
        .safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'A valid email address is required' });
      }
      const result = await authService.createBidder(parsed.data.email, req.user!.id);
      if (!result.ok) {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }
      res.status(201).json({ id: result.id, email: result.email, role: 'bidder' });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/users/:id/role',
  requireAuth,
  requireRole('admin', 'super_admin'),
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

      // Admins reach this handler now, so this check is what actually bounds
      // them — it used to be unreachable behind a super-admin-only middleware.
      // An admin may approve someone AS A BIDDER and nothing else; making
      // admins, super admins, or demoting anyone stays with super admins.
      //
      // Promoting to super_admin hands over full control, the grantee included:
      // a super_admin can change anyone's role but their own, so the person you
      // promote can demote you.
      if (actor.role !== 'super_admin' && target !== 'bidder') {
        return res.status(403).json({ error: 'Admins can only approve users as bidders' });
      }
      // An admin must not be able to demote or re-scope an existing admin or
      // super admin by "approving" them as a bidder.
      if (actor.role !== 'super_admin') {
        const current = await authService.getAuthUser(id);
        if (!current) return res.status(404).json({ error: 'User not found' });
        if (current.role !== 'guest') {
          return res
            .status(403)
            .json({ error: 'Admins can only approve accounts that are awaiting approval' });
        }
      }
      res.json(await authService.setRole(id, target));
    } catch (err) {
      next(err);
    }
  },
);
