import { invoke, isTauri } from '@tauri-apps/api/core';

export type LocalStoreName = 'flows' | 'coordination' | 'localTasks';

export interface LocalStoreRead {
  status: 'ok' | 'missing' | 'corrupt';
  text: string | null;
  backup: string | null;
}

export interface LocalStoreFs {
  read(name: LocalStoreName): Promise<LocalStoreRead>;
  write(name: LocalStoreName, json: string): Promise<void>;
  quarantine(name: LocalStoreName): Promise<string | null>;
  exportFile(suggestedName: string, content: string): Promise<string | null>;
}

const FILE_NAMES: Record<LocalStoreName, string> = {
  flows: 'flows.json',
  coordination: 'coordination.json',
  localTasks: 'local-tasks.json',
};

const STORAGE_PREFIX = 'ai-one.local-store.';
const memory = new Map<LocalStoreName, string>();
const memoryBackups = new Map<string, string>();
const memoryOverrides = new Set<LocalStoreName>();

function storageKey(name: LocalStoreName): string {
  return STORAGE_PREFIX + name;
}

function localStorageRef(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readRaw(name: LocalStoreName): string | null {
  const storage = localStorageRef();
  if (storage && !memoryOverrides.has(name)) {
    try {
      return storage.getItem(storageKey(name));
    } catch {
      // Fall back to this runtime's memory copy when storage is blocked.
    }
  }
  return memory.get(name) ?? null;
}

function safeFileName(suggestedName: string): string {
  const leaf = suggestedName.split(/[\\/]/).pop()?.trim() ?? '';
  return leaf && leaf !== '.' && leaf !== '..' ? leaf : 'export.json';
}

function backupName(name: LocalStoreName): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const prefix = FILE_NAMES[name] + '.bak-' + stamp;
  const storage = localStorageRef();
  let candidate = prefix;
  let suffix = 2;
  const exists = (value: string): boolean => {
    if (memoryBackups.has(value)) return true;
    if (!storage) return false;
    try {
      return storage.getItem(storageKey(name) + '.' + value) !== null;
    } catch {
      return false;
    }
  };
  while (exists(candidate)) {
    candidate = prefix + '-' + suffix;
    suffix += 1;
  }
  return candidate;
}

async function quarantineBrowser(name: LocalStoreName): Promise<string | null> {
  const text = readRaw(name);
  if (text === null) return null;
  const backup = backupName(name);
  memoryBackups.set(backup, text);
  memory.delete(name);
  memoryOverrides.add(name);

  const storage = localStorageRef();
  if (storage) {
    try {
      storage.setItem(storageKey(name) + '.' + backup, text);
      storage.removeItem(storageKey(name));
      memoryOverrides.delete(name);
    } catch {
      // Keep the quarantine result in memory if browser storage is unavailable.
    }
  }
  return backup;
}

export const tauriLocalStoreFs: LocalStoreFs = {
  read: (name) => invoke<LocalStoreRead>('local_store_read', { name }),
  write: (name, json) => invoke<void>('local_store_write', { name, json }),
  quarantine: (name) => invoke<string | null>('local_store_quarantine', { name }),
  exportFile: (suggestedName, content) =>
    invoke<string | null>('local_store_export', { suggestedName: safeFileName(suggestedName), content }),
};

export const browserLocalStoreFs: LocalStoreFs = {
  async read(name) {
    const text = readRaw(name);
    if (text === null) return { status: 'missing', text: null, backup: null };
    try {
      JSON.parse(text) as unknown;
      return { status: 'ok', text, backup: null };
    } catch {
      const backup = await quarantineBrowser(name);
      return { status: 'corrupt', text: null, backup };
    }
  },

  async write(name, json) {
    try {
      JSON.parse(json) as unknown;
    } catch {
      throw new Error('Invalid JSON');
    }

    if (name === 'localTasks') {
      const store = localStorageRef();
      if (!store) throw new Error('Persistent browser storage is unavailable.');
      try { store.setItem(storageKey(name), json); }
      catch { throw new Error('Persistent browser storage is full or unavailable. Nothing was saved.'); }
      memory.set(name, json);
      memoryOverrides.delete(name);
      return;
    }
    memory.set(name, json);
    memoryOverrides.add(name);
    const storage = localStorageRef();
    if (storage) {
      try {
        storage.setItem(storageKey(name), json);
        memoryOverrides.delete(name);
      } catch {
        // The in-memory copy remains available for this runtime.
      }
    }
  },

  quarantine: quarantineBrowser,

  async exportFile(suggestedName, content) {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    const filename = safeFileName(suggestedName);
    try {
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      return filename;
    } catch {
      return null;
    }
  },
};

export function getLocalStoreFs(): LocalStoreFs {
  try {
    return isTauri() ? tauriLocalStoreFs : browserLocalStoreFs;
  } catch {
    return browserLocalStoreFs;
  }
}
