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
 * The model both generators use.
 *
 * Chosen for cost: measured against real runs, one application (resume + cover
 * letter) costs about $0.033 here versus $0.166 on Claude Opus 5, because
 * output tokens were ~60% of the bill and Haiku charges $5/MTok for them rather
 * than $25. It is also the fastest model, which is the other half of why it is
 * here.
 *
 * THE TRADE IS REAL: resume tailoring is judgment work — deciding what in a
 * history is relevant to a posting, and honestly separating what the candidate
 * stated from what was inferred. Haiku is weaker at that than Opus or Sonnet.
 * If generated resumes start over-claiming or mis-ranking experience, this
 * constant is the first thing to change.
 *
 * SWITCHING BACK IS NOT JUST THIS LINE. Haiku 4.5 rejects `output_config.effort`
 * and needs a 4096-token prefix before prompt caching engages, so both
 * generators had their `effort` and `cache_control` removed to run here. Moving
 * to `claude-opus-5` or `claude-sonnet-5` means restoring both — see the
 * comments at each call site.
 */
export const MODEL = 'claude-haiku-4-5';
