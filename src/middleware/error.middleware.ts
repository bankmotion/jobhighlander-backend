import type { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.service';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  logger.error('Unhandled request error', { err: String(err) });
  res.status(500).json({ error: 'Internal server error' });
}
