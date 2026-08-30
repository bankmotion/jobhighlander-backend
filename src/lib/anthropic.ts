import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';

let client: Anthropic | undefined;

export function anthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — add it to backend/.env');
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export const aiEnabled = (): boolean => Boolean(env.ANTHROPIC_API_KEY);

export const MODEL = 'claude-haiku-4-5';
