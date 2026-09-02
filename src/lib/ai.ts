import { env } from '../config/env';

/**
 * Which vendor answers a generation. Everything downstream — the model string,
 * the pricing row, the badge on a saved document — is derived from this.
 */
export const AI_PROVIDERS = ['claude', 'openai'] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

/**
 * The CHEAPEST current model on each side, deliberately.
 *
 * Both generators run at high volume against long job descriptions, and neither
 * writes anything a person will not read and correct, so the tier that costs
 * 5-25x more buys nothing here. Haiku 4.5 is $1/$5 per MTok; GPT-5.6 Luna is
 * $0.20/$1.20. Changing either string means adding its rate to lib/pricing.ts
 * in the same commit, or every call after it is recorded as costing nothing.
 */
export const PROVIDER_MODEL: Readonly<Record<AiProvider, string>> = {
  claude: 'claude-haiku-4-5',
  openai: 'gpt-5.6-luna',
};

export const PROVIDER_LABEL: Readonly<Record<AiProvider, string>> = {
  claude: 'Claude',
  openai: 'OpenAI',
};

/** Raised when the caller asked for a provider this server cannot use. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export const isAiProvider = (v: unknown): v is AiProvider =>
  typeof v === 'string' && (AI_PROVIDERS as readonly string[]).includes(v);

/**
 * Which vendor produced a stored document, read back from its model string.
 *
 * Derived rather than stored in a column on purpose: the model is already on
 * every `Resume`, `CoverLetter`, `JobAiQuery` and `AiUsage` row, so this labels
 * documents written before providers were a concept without a migration and
 * without a column that could drift out of step with the model beside it.
 */
export function providerOf(model: string): AiProvider | null {
  if (/^claude/i.test(model)) return 'claude';
  if (/^(gpt|o\d|chatgpt)/i.test(model)) return 'openai';
  return null;
}

export function providerLabelOf(model: string): string {
  const p = providerOf(model);
  return p ? PROVIDER_LABEL[p] : 'Unknown provider';
}

export const providerKey = (p: AiProvider | null): string => p ?? 'unknown';

export function providerEnabled(provider: AiProvider): boolean {
  return provider === 'claude' ? Boolean(env.ANTHROPIC_API_KEY) : Boolean(env.OPENAI_API_KEY);
}

export const enabledProviders = (): AiProvider[] => AI_PROVIDERS.filter(providerEnabled);

/** True when at least one provider has a key; the generators 503 otherwise. */
export const aiEnabled = (): boolean => enabledProviders().length > 0;

/**
 * The provider used when the caller names none — the first configured one, in
 * the declared order. A request that omits `provider` still has to land
 * somewhere, and picking a provider with no key would fail deep inside the SDK.
 */
export function defaultProvider(): AiProvider | null {
  return enabledProviders()[0] ?? null;
}

/**
 * Resolve what the caller asked for into a provider this server can actually
 * call. Rejects here rather than at the SDK, so "you have no OpenAI key" is
 * distinguishable from "OpenAI rejected the key" — different fixes.
 */
export function resolveProvider(requested?: string | null): AiProvider {
  if (requested == null || requested === '') {
    const fallback = defaultProvider();
    if (!fallback) {
      throw new AiProviderError('AI is not configured on this server', 503);
    }
    return fallback;
  }
  if (!isAiProvider(requested)) {
    throw new AiProviderError(`Unknown AI provider "${requested}"`, 400);
  }
  if (!providerEnabled(requested)) {
    const key = requested === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    throw new AiProviderError(
      `${PROVIDER_LABEL[requested]} is not configured on this server — ${key} is not set.`,
      503,
    );
  }
  return requested;
}

export interface ProviderInfo {
  id: AiProvider;
  label: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
}

/** What the UI needs to render the picker: which providers exist, and which work. */
export function providerCatalog(): ProviderInfo[] {
  const fallback = defaultProvider();
  return AI_PROVIDERS.map((id) => ({
    id,
    label: PROVIDER_LABEL[id],
    model: PROVIDER_MODEL[id],
    enabled: providerEnabled(id),
    isDefault: id === fallback,
  }));
}
