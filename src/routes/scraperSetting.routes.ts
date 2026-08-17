import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { scraperSettingService } from '../services/scraperSetting.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const scraperSettingRouter = Router();

const requireSuper = [requireAuth, requireRole('super_admin')];

/** GET /api/scraper-settings — all scraper settings (super_admin only). */
scraperSettingRouter.get('/', requireSuper, async (_req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await scraperSettingService.list());
  } catch (err) {
    next(err);
  }
});

/** PUT /api/scraper-settings — upsert settings (super_admin only). */
scraperSettingRouter.put('/', requireSuper, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({ settings: z.array(z.object({ key: z.string().min(1).max(120), value: z.string() })) })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Expected { settings: [{ key, value }] }' });
    }
    res.json(await scraperSettingService.update(parsed.data.settings));
  } catch (err) {
    next(err);
  }
});
