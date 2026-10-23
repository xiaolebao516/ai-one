import type { AIProvider, BridgeMessage, ProviderState } from '../../shared/types';
import { getVersion } from '@tauri-apps/api/app';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { onBridgeMessage } from '../bridge/bus';
import type { AdapterNotice } from '../ui/reportBroken';
import { githubWrite as githubWriteApi } from './githubWrite';

export interface StoredSnapshotInfo {
  id: string;
  graphId?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface NavBlockedPayload {
  provider: string;
  host: string;
}

// Result of asking a provider page to stop. 'clicked' means a stop control was clicked, not that
// generation is confirmed stopped; the page engine re-checks idle before its next send.
export interface ProviderStopResult {
  outcome: 'clicked' | 'not-found' | 'skipped' | 'unavailable' | 'error';
  generating?: boolean;
  detail?: string;
}

// Fail closed at the host as well if the stop callback fails or the page engine is unavailable.
// Only a successful explicit provider reload clears the host-side latch.
const providersWithUnconfirmedStop = new Set<AIProvider>();

const STOP_ENGINE_JS =
  "window.__MAC_ENGINE__ && typeof window.__MAC_ENGINE__.stop === 'function' ? window.__MAC_ENGINE__.stop() : null";

export function parseProviderStopResult(raw: string): ProviderStopResult {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
    if (typeof value === 'string') value = JSON.parse(value) as unknown;
  } catch {
    return { outcome: 'error', detail: 'unreadable stop result' };
  }
  if (!value || typeof value !== 'object') return { outcome: 'unavailable', detail: 'page engine not loaded' };
  const result = value as { found?: unknown; clicked?: unknown; generating?: unknown; skipped?: unknown; error?: unknown };
  const generating = result.generating === true;
  if (typeof result.error === 'string') return { outcome: 'error', generating, detail: result.error };
  if (typeof result.skipped === 'string') return { outcome: 'skipped', generating, detail: result.skipped };
  if (result.clicked === true) return { outcome: 'clicked', generating };
  return { outcome: 'not-found', generating };
}

// CSS px × devicePixelRatio = 實體像素。dpr 已包含 WebView2 頁面縮放
// （Windows「文字大小」會變成 ZoomFactor），Logical 座標會少乘這個縮放而錯位。
const toBounds = (rect: DOMRectReadOnly) => {
  const dpr = globalThis.devicePixelRatio || 1;
  return {
    x: Math.round(rect.x * dpr),
    y: Math.round(rect.y * dpr),
    width: Math.round(rect.width * dpr),
    height: Math.round(rect.height * dpr),
  };
};

const SNAPSHOT_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

function safeSnapshotId(snapshotId: string): string {
  if (!SNAPSHOT_ID_RE.test(snapshotId) || snapshotId === '.' || snapshotId === '..') {
    throw new Error('Invalid snapshot id');
  }
  return snapshotId;
}

export const host = {
  app: {
    isDesktop: (): boolean => isTauri(),
    version: (): Promise<string> => getVersion(),
    openExternal: (url: string): Promise<void> => invoke('open_external_url', { url }),
  },
  onNavBlocked: async (handler: (payload: NavBlockedPayload) => void): Promise<() => void> => {
    const unlisten = await listen<NavBlockedPayload>('nav://blocked', (event) => handler(event.payload));
    return unlisten;
  },
  provider: {
    open: (provider: AIProvider, bounds: DOMRectReadOnly): Promise<ProviderState> =>
      invoke('provider_open', { provider, bounds: toBounds(bounds) }),
    close: (provider: AIProvider): Promise<void> => invoke('provider_close', { provider }),
    show: (provider: AIProvider, focus = false): Promise<void> => invoke('provider_show', { provider, focus }),
    hide: (provider: AIProvider): Promise<void> => invoke('provider_hide', { provider }),
    park: async (provider: AIProvider, bounds: DOMRectReadOnly): Promise<void> => {
      await invoke('provider_set_bounds', { provider, bounds: toBounds(bounds) });
      await invoke('provider_show', { provider, focus: false });
    },
    eval: (provider: AIProvider, js: string): Promise<void> => invoke('provider_eval', { provider, js }),
    evalWithCallback: (provider: AIProvider, js: string): Promise<string> =>
      invoke('provider_eval_with_callback', { provider, js }),
    send: (provider: AIProvider, text: string): Promise<void> => {
      if (providersWithUnconfirmedStop.has(provider)) {
        return Promise.reject(new Error(`${provider} send rejected: stop failed; reload provider page before retrying`));
      }
      return invoke('provider_eval', {
        provider,
        js: `window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch(${JSON.stringify({
          v: 1,
          action: 'SEND_MESSAGE',
          provider,
          payload: { text },
        })});`,
      });
    },
    fill: (provider: AIProvider, text: string): Promise<void> =>
      invoke('provider_eval', {
        provider,
        js: `window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch(${JSON.stringify({
          v: 1,
          action: 'FILL_DRAFT',
          provider,
          payload: { text },
        })});`,
      }),
    stop: async (provider: AIProvider): Promise<ProviderStopResult> => {
      // Mark unconfirmed before the async call; a timeout is not proof that stop succeeded.
      providersWithUnconfirmedStop.add(provider);
      const result = parseProviderStopResult(await invoke<string>('provider_eval_with_callback', { provider, js: STOP_ENGINE_JS }));
      if (result.outcome === 'clicked') providersWithUnconfirmedStop.delete(provider);
      return result;
    },
    openLogin: (provider: AIProvider): Promise<void> => invoke('provider_open_login', { provider }),
    openLoginExternal: (provider: AIProvider): Promise<void> => invoke('provider_open_login_external', { provider }),
    reload: async (provider: AIProvider): Promise<void> => {
      await invoke('provider_reload', { provider });
      providersWithUnconfirmedStop.delete(provider);
    },
    reconnect: async (provider: AIProvider): Promise<void> => {
      await invoke('provider_reload', { provider, reconnect: true });
      providersWithUnconfirmedStop.delete(provider);
    },
    newSession: (provider: AIProvider): Promise<void> => invoke('provider_new_session', { provider }),
  },
  adapter: {
    push: (provider: AIProvider, _cfg: unknown): Promise<void> => invoke('adapter_push', { provider }),
    reportBroken: (provider: AIProvider): Promise<string> => invoke('report_broken', { provider }),
    openIssue: (provider: AIProvider, body: string): Promise<void> =>
      invoke('open_adapter_issue', { provider, body }),
    onNotice: async (handler: (notice: AdapterNotice) => void): Promise<() => void> => {
      const unlisten = await listen<AdapterNotice>('adapter://notice', (event) => handler(event.payload));
      return unlisten;
    },
  },
  connections: {
    get: (): Promise<ProviderState[]> => invoke('connections_get'),
    onUpdate: async (handler: (state: ProviderState) => void): Promise<() => void> => {
      const unlisten = await listen<ProviderState>('connections://update', (event) => handler(event.payload));
      return unlisten;
    },
  },
  layout: {
    setBounds: (provider: AIProvider, rect: DOMRectReadOnly): Promise<void> =>
      invoke('provider_set_bounds', { provider, bounds: toBounds(rect) }),
  },
  bridge: {
    subscribeTitle: async (handler: (message: BridgeMessage) => void): Promise<() => void> => {
      const unlisten = await listen<BridgeMessage>('bridge://msg', (event) => handler(event.payload));
      return unlisten;
    },
    subscribe: async (handler: (message: BridgeMessage) => void): Promise<() => void> =>
      Promise.resolve(onBridgeMessage(handler)),
    onMessage: async (handler: (message: BridgeMessage) => void): Promise<() => void> => {
      return onBridgeMessage(handler);
    },
  },
  dev: {
    /** Dev-only: forward a line to the Rust stdout so headless harness runs can capture it. */
    log: (message: string): Promise<void> => invoke('dev_log', { message }),
  },
  settings: {
    get: (): Promise<unknown> => invoke('settings_get'),
    set: (settings: unknown): Promise<void> => invoke('settings_set', { settings }),
  },
  snapshot: {
    save: async (snapshotId: string, snapshotJson: string): Promise<void> =>
      invoke('snapshot_save', { snapshotId: safeSnapshotId(snapshotId), snapshotJson }),
    list: (): Promise<StoredSnapshotInfo[]> => invoke('snapshot_list'),
    load: async (snapshotId: string): Promise<string | null> =>
      invoke('snapshot_load', { snapshotId: safeSnapshotId(snapshotId) }),
    delete: async (snapshotId: string): Promise<void> => invoke('snapshot_delete', { snapshotId: safeSnapshotId(snapshotId) }),
  },
  sessionCheckpoint: {
    save: (json: string): Promise<void> => invoke('session_checkpoint_save', { json }),
    load: (): Promise<string | null> => invoke('session_checkpoint_load'),
    clear: (): Promise<void> => invoke('session_checkpoint_clear'),
  },
  /**
   * Read-only GitHub reads through the locally authenticated gh (#51, Spec #50). Rust allows only the
   * endpoints scripts/task-status/snapshot.mjs uses; failures reject with a fixed message, never gh output.
   */
  github: {
    get: (path: string): Promise<unknown> => readOnlyGitHub(invoke('github_readonly_get', { path })),
    associations: (repo: string, numbers: number[]): Promise<unknown> =>
      readOnlyGitHub(invoke('github_readonly_associations', { repo, numbers })),
  },
  githubWrite: githubWriteApi,
  /** Local Prodex metadata only. No dispatch, reply retrieval or file writes. */
  dispatch: {
    snapshot: async (repoPath: string): Promise<unknown> => {
      try {
        return await invoke('dispatch_readonly_snapshot', { repoPath });
      } catch {
        throw new Error('派工元数据读取失败，请检查仓库路径和本机文件权限');
      }
    },
  },
  share: {
    exportMarkdown: (suggestedName: string, content: string): Promise<string | null> =>
      invoke('export_markdown', { suggestedName, content }),
  },
};

const GITHUB_QUERY_FAILED = 'GitHub query failed; check gh auth status, repository access, network and API rate limits.';

/** The only messages the read-only bridge may surface (Spec #50): fixed text, never gh output. */
const GITHUB_MESSAGES: ReadonlySet<string> = new Set([
  'Request not allowed.',
  'gh is not installed; install GitHub CLI and run gh auth login.',
  'gh query timed out; snapshot is incomplete.',
  GITHUB_QUERY_FAILED,
  'GitHub returned invalid JSON; snapshot is incomplete.',
]);

/** Tauri rejects with the command's error string; collectSnapshot expects Error objects. */
async function readOnlyGitHub(request: Promise<unknown>): Promise<unknown> {
  try {
    return await request;
  } catch (error) {
    throw new Error(typeof error === 'string' && GITHUB_MESSAGES.has(error) ? error : GITHUB_QUERY_FAILED);
  }
}
