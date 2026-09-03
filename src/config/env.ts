import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required'),
  // Optional on purpose: the backend must still boot on a deploy where this
  // has not been set yet. The Google login route reports a clear 503 instead,
  // rather than the whole API failing to start.
  GOOGLE_CLIENT_ID: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  // 24 hours. Must stay in step with the auth cookie's `maxAge` in the Next
  // app: a cookie that outlives its token leaves someone looking signed in
  // while every request 401s, which reads as the app being broken rather than
  // as a session that ended.
  JWT_EXPIRES_IN: z.string().default('24h'),
  ANTHROPIC_API_KEY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  // Where USDT deposits are sent. One address serves both BEP20 and ERC20.
  // Optional: the default in billing.service.ts is the address this deployment
  // ships with, so a missing value is not a broken payment page.
  USDT_DEPOSIT_ADDRESS: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'USDT_DEPOSIT_ADDRESS must be a 0x wallet address').optional(),
  ),
  OPENAI_API_KEY: z.preprocess(
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
