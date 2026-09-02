import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { PROVIDER_MODEL } from './ai';

let client: Anthropic | undefined;

export function anthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — add it to backend/.env');
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export const MODEL = PROVIDER_MODEL.claude;

// Re-exported so the many call sites that only need "is AI usable at all" do
// not each have to know that the answer now spans two vendors.
export { aiEnabled } from './ai';
