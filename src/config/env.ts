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
  // Dev-only escape hatch: return a canned resume instead of calling Anthropic,
  // so the UI can be exercised without API credits. Ignored in production.
  AI_MOCK: z.preprocess((v) => v === '1' || v === 'true', z.boolean()).default(false),
  /**
   * Artificial delay for AI_MOCK generations, in ms.
   *
   * A real generation takes 20-60s; the mock returns in under a millisecond.
   * Every piece of UI built for that wait — progress, elapsed time, closing the
   * dialog and letting it finish, concurrent runs — is untestable against an
   * instant mock. Set this to ~30000 to rehearse the real timeline.
   */
  AI_MOCK_DELAY_MS: z.coerce.number().int().min(0).max(120_000).default(0),
  ANTHROPIC_API_KEY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
