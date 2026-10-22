import { useSyncExternalStore } from 'react';
import { V2_DEFAULT_SKIN, isV2SkinId, type V2SkinId } from './tokens';

/**
 * The active v2 skin for every <V2Scope> that does not pin one (#41/#42). One switch re-skins all
 * v2 surfaces in the document together: HUD, migrated v1 areas, the gallery. Persisted per origin
 * in localStorage; storage being unavailable only means the choice is not remembered.
 */
const STORAGE_KEY = 'ai-one.v2.skin';
const listeners = new Set<() => void>();
let current: V2SkinId = readStored();

function notifyListeners(): void {
  for (const listener of [...listeners]) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY) return;
  const next = isV2SkinId(event.newValue) ? event.newValue : V2_DEFAULT_SKIN;
  if (next === current) return;
  current = next;
  notifyListeners();
}

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readStored(): V2SkinId {
  try {
    const stored = storage()?.getItem(STORAGE_KEY);
    return isV2SkinId(stored) ? stored : V2_DEFAULT_SKIN;
  } catch {
    return V2_DEFAULT_SKIN;
  }
}

export function getV2Skin(): V2SkinId {
  return current;
}

export function setV2Skin(skin: V2SkinId): void {
  if (!isV2SkinId(skin) || skin === current) return;
  current = skin;
  try {
    storage()?.setItem(STORAGE_KEY, skin);
  } catch {
    // Not persisted; the in-memory choice still applies.
  }
  notifyListeners();
}

export function subscribeV2Skin(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

export function useV2Skin(): V2SkinId {
  return useSyncExternalStore(subscribeV2Skin, getV2Skin, () => V2_DEFAULT_SKIN);
}
