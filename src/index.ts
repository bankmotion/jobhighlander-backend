import type { Server } from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { logger } from './services/logger.service';
import { closeBrowser } from './resume/pdf';

let server: Server | null = null;

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down`);
  try {
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
    await closeBrowser();
    await prisma.$disconnect();
  } catch (err) {
    logger.error('Error during shutdown', { err: String(err) });
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { err: String(err) });
  void shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason: String(reason) });
});

async function main(): Promise<void> {
  // Verify DB connectivity before accepting traffic.
  await prisma.$connect();
  const app = createApp();
  server = app.listen(env.PORT, () => {
    logger.info(`Backend listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch(async (err) => {
  logger.error('Fatal startup error', { err: String(err) });
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
