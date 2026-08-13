import { PrismaClient } from '@prisma/client';
import { isProd } from '../config/env';

/**
 * Single shared PrismaClient. In dev, hot-reload can otherwise spawn many
 * clients (and exhaust DB connections), so we cache it on globalThis.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['error'] : ['warn', 'error'],
  });

if (!isProd) globalForPrisma.prisma = prisma;
