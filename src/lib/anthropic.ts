import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';

/**
 * Shared Anthropic client. Created lazily so the server still boots when no
 * key is configured — only the AI routes fail, and they fail with a message
 * that says what to fix.
 */
let client: Anthropic | undefined;

export function anthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — add it to backend/.env');
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

/** True when AI features are usable; lets routes 503 instead of throwing. */
export const aiEnabled = (): boolean => Boolean(env.ANTHROPIC_API_KEY);

/**
 * Default model. Opus 5 for judgment-heavy, user-facing work; switch the
 * call site to BULK_MODEL for high-volume passes over scraped rows.
 */
export const MODEL = 'claude-opus-5';
export const BULK_MODEL = 'claude-haiku-4-5';
