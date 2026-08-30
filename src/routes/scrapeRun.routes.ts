import { Router, type Response, type NextFunction } from 'express';
import { scrapeRunService } from '../services/scrapeRun.service';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.middleware';

export const scrapeRunRouter = Router();

scrapeRunRouter.get(
  '/',
  requireAuth,
  requireRole('super_admin'),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const page = Number(req.query.page) || 1;
      const pageSize = Number(req.query.pageSize) || 25;
      // `?site=a&site=b` arrives as a string or an array depending on count.
      const asList = (v: unknown): string[] =>
        Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [];
      res.json(
        await scrapeRunService.list(page, pageSize, {
          sites: asList(req.query.site),
          statuses: asList(req.query.status),
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);
