import { DEFAULT_REPOS, MAX_REPOS, normalizeRepo, type ThemePreference, type WorkbenchSource } from './workbenchModel';
import { normalizeRepoPath } from './dispatchModel';

/**
 * Per-viewer preferences of the workbench. localStorage can be missing or throw (private mode,
 * blocked storage, tests); every read falls back to the default and every write is best effort.
 */

export type UiRoot = 'workbench' | 'classic';

export const STORAGE_KEYS = {
  root: 'ai-one.ui.root',
  prefs: 'ai-one.workbench.prefs',
} as const;

export interface WorkbenchPrefs {
  source: WorkbenchSource;
  repos: string[];
  theme: ThemePreference;
  dispatchRepo: string;
}

export const DEFAULT_PREFS: WorkbenchPrefs = { source: 'demo', repos: [...DEFAULT_REPOS], theme: 'system', dispatchRepo: '' };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string, storage: StorageLike | undefined): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string, storage: StorageLike | undefined): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Not persisted; the in-memory state still applies for this run.
  }
}

export const UI_ROOT_PARAM = 'ui';

function currentSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

/**
 * The new workbench is the default; the classic chat UI is opt-in until its parts are migrated.
 * The URL parameter wins over storage so a switch still works when storage cannot be written.
 */
export function loadUiRoot(storage: StorageLike | undefined = defaultStorage(), search: string = currentSearch()): UiRoot {
  const fromUrl = new URLSearchParams(search).get(UI_ROOT_PARAM);
  if (fromUrl === 'classic' || fromUrl === 'workbench') return fromUrl;
  return read(STORAGE_KEYS.root, storage) === 'classic' ? 'classic' : 'workbench';
}

/** The page address that opens `root`, keeping everything else of `href`. */
export function uiRootHref(href: string, root: UiRoot): string {
  const url = new URL(href);
  url.searchParams.set(UI_ROOT_PARAM, root);
  return url.toString();
}

export function saveUiRoot(root: UiRoot, storage: StorageLike | undefined = defaultStorage()): void {
  write(STORAGE_KEYS.root, root, storage);
}

/**
 * Switching reloads the page so the two UIs never share one JS runtime (bridge listeners, provider
 * webview bookkeeping).
 */
export function switchUiRoot(root: UiRoot): void {
  saveUiRoot(root);
  window.location.replace(uiRootHref(window.location.href, root));
}

export function loadPrefs(storage: StorageLike | undefined = defaultStorage()): WorkbenchPrefs {
  const raw = read(STORAGE_KEYS.prefs, storage);
  if (!raw) return { ...DEFAULT_PREFS, repos: [...DEFAULT_PREFS.repos] };
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof WorkbenchPrefs, unknown>>;
    const source = parsed.source === 'github' ? 'github' : 'demo';
    const theme = parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'system';
    const repos = Array.isArray(parsed.repos)
      ? [...new Set(parsed.repos.map((repo) => (typeof repo === 'string' ? normalizeRepo(repo) : undefined)).filter((repo): repo is string => Boolean(repo)))].slice(0, MAX_REPOS)
      : [];
    const dispatchRepo = typeof parsed.dispatchRepo === 'string' ? normalizeRepoPath(parsed.dispatchRepo) ?? '' : '';
    return { source, theme, repos: repos.length ? repos : [...DEFAULT_REPOS], dispatchRepo };
  } catch {
    return { ...DEFAULT_PREFS, repos: [...DEFAULT_PREFS.repos] };
  }
}

export function savePrefs(prefs: WorkbenchPrefs, storage: StorageLike | undefined = defaultStorage()): void {
  write(STORAGE_KEYS.prefs, JSON.stringify(prefs), storage);
}
