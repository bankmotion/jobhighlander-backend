import type { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.service';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

interface HttpErrorLike {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
}

function clientMessage(type: unknown, status: number): string {
  if (type === 'entity.parse.failed') return 'Malformed JSON body';
  if (type === 'entity.too.large') return 'Payload too large';
  if (type === 'encoding.unsupported') return 'Unsupported content encoding';
  if (status === 400) return 'Bad request';
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Not found';
  if (status === 415) return 'Unsupported media type';
  return 'Request error';
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  // Past the point of no return: let Express abort the stream.
  if (res.headersSent) {
    next(err);
    return;
  }

  const e = (err ?? {}) as HttpErrorLike;
  const raw =
    typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : 500;
  const status = Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;

  if (status >= 500) {
    logger.error('Unhandled request error', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  logger.warn('Request error', { status, type: e.type, err: String(err) });
  res.status(status).json({ error: clientMessage(e.type, status) });
}
