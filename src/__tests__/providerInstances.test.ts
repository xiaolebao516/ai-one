import { describe, expect, it } from 'vitest';
import { isProviderInstance, parseProviderInstance, providerInstanceBase, providerInstanceLabel } from '../../shared/providerInstances';

describe('provider instances', () => {
  it('keeps legacy provider keys and gives each extra instance a stable label', () => {
    expect(parseProviderInstance('chatgpt')).toEqual({ base: 'chatgpt', n: 1 });
    expect(parseProviderInstance('chatgpt#2')).toEqual({ base: 'chatgpt', n: 2 });
    expect(parseProviderInstance('grok#3')).toEqual({ base: 'grok', n: 3 });
    expect(providerInstanceLabel('chatgpt')).toBe('ai-chatgpt');
    expect(providerInstanceLabel('chatgpt#2')).toBe('ai-chatgpt-2');
    expect(providerInstanceBase('chatgpt#3')).toBe('chatgpt');
    expect(isProviderInstance('meta#2')).toBe(true);
  });

  it.each(['', 'other', 'chatgpt#1', 'chatgpt#0', 'chatgpt#02', 'chatgpt#4', 'chatgpt#2#3', 'chatgpt#-2', 'chatgpt#999', 'ChatGPT#2'])('rejects invalid instance key %s', (key) => {
    expect(isProviderInstance(key)).toBe(false);
    expect(parseProviderInstance(key)).toBeNull();
  });

  it('fails closed even when a template-literal typed value is malformed', () => {
    expect(() => providerInstanceLabel('chatgpt#4')).toThrow('Invalid provider instance');
    expect(() => providerInstanceBase('chatgpt#-2')).toThrow('Invalid provider instance');
  });
});
