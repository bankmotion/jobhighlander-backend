import 'dotenv/config';
import { z } from 'zod';

/**
 * Validated, typed environment. Fails fast at startup if anything required is
 * missing or malformed, rather than blowing up deep in a request handler.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  // Optional on purpose: the app boots fine without AI configured. The
  // Anthropic client throws a clear error on first use instead, so a missing
  // key never blocks the scraper/job/auth routes from starting.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
