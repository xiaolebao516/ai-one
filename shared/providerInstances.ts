import type { AIProvider, ProviderInstance } from './types';

export const MAX_EXTRA_PROVIDER_INSTANCES = 2;

const BASE_PROVIDERS: readonly string[] = ['chatgpt', 'claude', 'gemini', 'grok', 'meta'];

export function parseProviderInstance(value: string): { base: AIProvider; n: number } | null {
  const match = /^([^#]+)(?:#([1-9][0-9]*))?$/.exec(value);
  if (!match || !BASE_PROVIDERS.includes(match[1])) return null;
  const n = match[2] === undefined ? 1 : Number(match[2]);
  if (!Number.isSafeInteger(n) || (match[2] !== undefined && n < 2) || n > MAX_EXTRA_PROVIDER_INSTANCES + 1) return null;
  return { base: match[1] as AIProvider, n };
}

export function isProviderInstance(value: string): value is ProviderInstance {
  return parseProviderInstance(value) !== null;
}

export function providerInstanceBase(value: ProviderInstance): AIProvider {
  const parsed = parseProviderInstance(value);
  if (!parsed) throw new Error(`Invalid provider instance key: ${value}`);
  return parsed.base;
}

export function providerInstanceLabel(value: ProviderInstance): string {
  const parsed = parseProviderInstance(value);
  if (!parsed) throw new Error(`Invalid provider instance key: ${value}`);
  return parsed.n === 1 ? `ai-${parsed.base}` : `ai-${parsed.base}-${parsed.n}`;
}
