/**
 * Minimal dependency-free structured logger. Keeps a consistent, timestamped
 * shape across the app without pulling in a logging framework.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, message: string, meta?: unknown): void {
  const line = `${new Date().toISOString()} | ${level.toUpperCase().padEnd(5)} | ${message}`;
  const args = meta === undefined ? [line] : [line, meta];
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.log(...args);
}

export const logger = {
  debug: (m: string, meta?: unknown) => emit('debug', m, meta),
  info: (m: string, meta?: unknown) => emit('info', m, meta),
  warn: (m: string, meta?: unknown) => emit('warn', m, meta),
  error: (m: string, meta?: unknown) => emit('error', m, meta),
};
