import { afterEach, describe, expect, it, vi } from 'vitest';
import { V2_DEFAULT_SKIN, type V2SkinId } from '../ui/v2/tokens';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function freshModule() {
  vi.resetModules();
  return import('../ui/v2/skinPreference');
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    data,
  };
}

describe('shared v2 skin preference', () => {
  it('starts from the stored skin and falls back to the default for unknown values', async () => {
    vi.stubGlobal('window', { localStorage: memoryStorage({ 'ai-one.v2.skin': 'mist' }), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    expect((await freshModule()).getV2Skin()).toBe('mist');
    vi.stubGlobal('window', { localStorage: memoryStorage({ 'ai-one.v2.skin': 'neon' }), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    expect((await freshModule()).getV2Skin()).toBe(V2_DEFAULT_SKIN);
  });

  it('notifies every subscriber once per change, persists it, and ignores invalid skins', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const { getV2Skin, setV2Skin, subscribeV2Skin } = await freshModule();
    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribeV2Skin(a);
    subscribeV2Skin(b);

    setV2Skin('mist');
    setV2Skin('mist');
    setV2Skin('neon' as V2SkinId);
    expect(getV2Skin()).toBe('mist');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(storage.data.get('ai-one.v2.skin')).toBe('mist');

    stopA();
    setV2Skin('paper');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('keeps working in memory when storage throws', async () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('blocked');
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const { getV2Skin, setV2Skin } = await freshModule();
    expect(getV2Skin()).toBe(V2_DEFAULT_SKIN);
    setV2Skin('mist');
    expect(getV2Skin()).toBe('mist');
  });
});
