import { Router, type Response, type NextFunction } from 'express';
import { scrapeRunService } from '../services/scrapeRun.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const scrapeRunRouter = Router();

/** GET /api/scrape-runs — recent scraper runs (super_admin only). */
scrapeRunRouter.get(
  '/',
  requireAuth,
  requireRole('super_admin'),
  async (_req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await scrapeRunService.list());
    } catch (err) {
      next(err);
    }
  },
);
