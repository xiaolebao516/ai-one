// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('no tauri'))), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));

import { parseQuotaHudReading } from '../resources/parse';
import { deriveResources, quotaTitleView } from '../resources/registry';
import type { QuotaHudReading } from '../resources/types';
import { useQuotaHud, type QuotaHudData, type QuotaHudLoader, type QuotaHudStarter } from '../resources/useQuotaHud';
import type { DispatchData } from '../workbench/useDispatchData';
import { ResourcesView } from '../workbench/views/ResourcesView';
import { Workbench } from '../workbench/Workbench';

const NOW = Date.parse('2026-10-23T12:00:00.000Z');
const freshAt = new Date(NOW - 60_000).toISOString();

function quota(vendor: string, usedPercent: number | null, observedAt: string | null = freshAt) {
  return {
    id: vendor + '-limit',
    vendor,
    name: '5h limit',
    usedPercent,
    resetAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
    status: 'normal',
    account: 'test-account',
    observedAt,
    extraQuotaField: 'ignored',
  };
}

function snapshot(overrides: {
  quotas?: unknown[];
  providers?: unknown[];
  sessions?: unknown[];
} = {}) {
  return {
    schemaVersion: 1,
    generatedAt: freshAt,
    mode: 'live',
    connection: { status: 'connected', message: null, platform: 'test' },
    quotas: overrides.quotas ?? [],
    providers: overrides.providers ?? [],
    sessions: overrides.sessions ?? [],
    unknownField: { tolerated: true },
  };
}

function rawReading(state: string = 'running', snapshotValue: unknown = snapshot(), readAt: string = freshAt) {
  return {
    state,
    heartbeatAgeSeconds: 2,
    snapshot: snapshotValue,
    readAt,
    unknownReadingField: true,
  };
}

function parsed(state: string = 'running', snapshotValue: unknown = snapshot()): QuotaHudReading {
  return parseQuotaHudReading(rawReading(state, snapshotValue));
}

function resource(reading: QuotaHudReading, id: 'claude-code' | 'codex') {
  const result = deriveResources(reading, NOW).find((item) => item.id === id);
  if (!result) throw new Error('missing resource ' + id);
  return result;
}

describe('parseQuotaHudReading', () => {
  it('accepts both JSON text and objects, and ignores unknown fields', () => {
    const raw = rawReading('running', snapshot({
      quotas: [quota('codex', 13)],
      providers: [{ id: 'codex', name: 'Codex', detected: true, accountStatus: { status: 'ready', notice: null, checkedAt: freshAt }, extra: 1 }],
      sessions: [],
    }));
    expect(parseQuotaHudReading(JSON.stringify(raw))).toEqual(parseQuotaHudReading(raw));
    expect(parseQuotaHudReading(raw).snapshot?.quotas[0]?.usedPercent).toBe(13);
    expect(parseQuotaHudReading(raw).snapshot?.providers[0]?.id).toBe('codex');
  });

  it('treats missing fields as unknown and tolerates partial snapshots', () => {
    const reading = parseQuotaHudReading({ state: 'running', snapshot: { schemaVersion: 1, unknownField: true } });
    expect(reading.state).toBe('running');
    expect(reading.heartbeatAgeSeconds).toBeNull();
    expect(reading.readAt).toBeNull();
    expect(reading.snapshot?.quotas).toEqual([]);
    expect(reading.snapshot?.providers).toEqual([]);
    expect(reading.snapshot?.sessions).toEqual([]);
    expect(reading.snapshot?.connection).toBeNull();
  });

  it('fails closed for malformed JSON, non-objects, invalid states and unsupported schema versions', () => {
    expect(parseQuotaHudReading('{broken').state).toBe('unreadable');
    expect(parseQuotaHudReading(null).state).toBe('unreadable');
    expect(parseQuotaHudReading({ state: 'maybe', snapshot: snapshot() }).state).toBe('unreadable');
    expect(parseQuotaHudReading(rawReading('running', { schemaVersion: 2, quotas: [quota('codex', 90)] })).snapshot).toBeNull();
  });
});

describe('deriveResources', () => {
  it('maps login errors and unavailable account status without losing their notices', () => {
    const reading = parsed('running', snapshot({
      providers: [
        { id: 'claude', detected: true, accountStatus: { status: 'error', notice: '登录过期', checkedAt: freshAt } },
        { id: 'codex', detected: true, accountStatus: { status: 'unavailable', notice: '没有订阅额度', checkedAt: freshAt } },
      ],
    }));
    const claude = resource(reading, 'claude-code');
    const codex = resource(reading, 'codex');
    expect(claude.login).toBe('attention');
    expect(claude.loginNotice).toBe('登录过期');
    expect(codex.login).toBe('unknown');
    expect(codex.loginNotice).toBe('没有订阅额度');
  });

  it('derives busy, waiting, idle and unknown activity', () => {
    const live = parsed('running', snapshot({
      providers: [{ id: 'claude', detected: true }, { id: 'codex', detected: true }],
      sessions: [
        { id: 'a', source: 'claude', state: 'running', updatedAt: freshAt, tokens: 1 },
        { id: 'b', source: 'codex', state: 'waiting', updatedAt: freshAt, tokens: 1 },
      ],
    }));
    expect(resource(live, 'claude-code').activity).toBe('busy');
    expect(resource(live, 'codex').activity).toBe('waiting');
    expect(resource(parsed('running', snapshot()), 'claude-code').activity).toBe('idle');
    expect(resource(parsed('stopped', snapshot()), 'claude-code').activity).toBe('unknown');
  });

  it.each([
    [69.9, 'ok'],
    [70, 'warn'],
    [89.9, 'warn'],
    [90, 'critical'],
    [null, 'unknown'],
  ] as const)('uses safe quota levels at %s percent', (usedPercent, level) => {
    const reading = parsed('running', snapshot({ quotas: [quota('codex', usedPercent)] }));
    expect(resource(reading, 'codex').quota.windows[0]?.level).toBe(level);
  });

  it('marks old observations and stopped HUD snapshots stale while retaining their values', () => {
    const oldAt = new Date(NOW - 31 * 60 * 1000).toISOString();
    const old = parsed('running', snapshot({ quotas: [quota('codex', 13, oldAt)] }));
    expect(resource(old, 'codex').quota.stale).toBe(true);
    expect(resource(old, 'codex').quota.source).toBe('unknown');
    expect(resource(old, 'codex').quota.windows[0]?.usedPercent).toBe(13);
    const stopped = parsed('stopped', snapshot({ quotas: [quota('codex', 13)] }));
    expect(resource(stopped, 'codex').quota.stale).toBe(true);
    expect(resource(stopped, 'codex').quota.source).toBe('unknown');
    const staleStatus = parsed('running', snapshot({ quotas: [{ ...quota('codex', 13), status: 'stale' }] }));
    expect(resource(staleStatus, 'codex').quota.stale).toBe(true);
    expect(resource(staleStatus, 'codex').quota.source).toBe('unknown');
  });

  it('keeps absent HUD data fully unknown and does not mix Claude with Codex', () => {
    const absentReading = parsed('absent', null);
    const absent = resource(absentReading, 'codex');
    const absentClaude = resource(absentReading, 'claude-code');
    expect(absent.login).toBe('unknown');
    expect(absent.activity).toBe('unknown');
    expect(absent.quota.source).toBe('unknown');
    expect(absentClaude.login).toBe('unknown');
    expect(absentClaude.activity).toBe('unknown');
    expect(absentClaude.quota.source).toBe('unknown');
    const split = parsed('running', snapshot({
      quotas: [quota('codex', 13)],
      providers: [{ id: 'codex', detected: false }],
      sessions: [{ id: 'a', source: 'claude', state: 'running', updatedAt: freshAt, tokens: 1 }],
    }));
    expect(resource(split, 'claude-code').login).toBe('not-detected');
    expect(resource(split, 'claude-code').quota.windows).toHaveLength(0);
    expect(resource(split, 'claude-code').activity).toBe('busy');
    expect(resource(split, 'codex').quota.windows).toHaveLength(1);
    expect(resource(split, 'codex').login).toBe('not-detected');
  });

  it('ignores stale and unknown quota windows in the title summary', () => {
    const live = parsed('running', snapshot({ quotas: [quota('claude', 70), quota('codex', 90)] }));
    expect(quotaTitleView(deriveResources(live, NOW))).toEqual({ level: 'critical', usedPercent: 90 });
    const stopped = parsed('stopped', snapshot({ quotas: [quota('codex', 99)] }));
    expect(quotaTitleView(deriveResources(stopped, NOW))).toEqual({ level: 'unknown', usedPercent: null });
  });
});

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mountedRoots: Mounted[] = [];
let current: QuotaHudData | undefined;

function HookProbe({ options }: { options: Parameters<typeof useQuotaHud>[0] }) {
  current = useQuotaHud(options);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

async function mount(node: ReactNode): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const mounted = { root, container };
  mountedRoots.push(mounted);
  await act(async () => root.render(node));
  return mounted;
}

async function unmount(mounted: Mounted) {
  await act(async () => mounted.root.unmount());
  const index = mountedRoots.indexOf(mounted);
  if (index >= 0) mountedRoots.splice(index, 1);
  mounted.container.remove();
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  current = undefined;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const mounted of mountedRoots.splice(0)) {
    await act(async () => mounted.root.unmount());
    mounted.container.remove();
  }
  document.body.innerHTML = '';
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  current = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useQuotaHud', () => {
  it('returns unavailable outside desktop without calling the loader', async () => {
    const loader = vi.fn<QuotaHudLoader>(() => Promise.resolve(rawReading()));
    await mount(<HookProbe options={{ loader, isDesktop: false }} />);
    expect(current?.state).toBe('unavailable');
    expect(current?.reading?.state).toBe('unavailable');
    expect(loader).not.toHaveBeenCalled();
  });

  it('polls every ten seconds only while visible and clears the timer on unmount', async () => {
    vi.useFakeTimers();
    const loader = vi.fn<QuotaHudLoader>(() => Promise.resolve(rawReading()));
    const mounted = await mount(<HookProbe options={{ loader, isDesktop: true }} />);
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(loader).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(loader).toHaveBeenCalledTimes(2);
    await unmount(mounted);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('discards late responses and refreshes after starting the HUD', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const loader = vi.fn<QuotaHudLoader>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const starter = vi.fn<QuotaHudStarter>(() => Promise.resolve({ started: true }));
    await mount(<HookProbe options={{ loader, starter, isDesktop: true }} />);
    await flush();
    await act(async () => current?.refresh());
    await flush();
    expect(loader).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve(rawReading('running', snapshot(), new Date(NOW).toISOString()));
      await second.promise;
    });
    await act(async () => {
      first.resolve(rawReading('stopped', snapshot(), new Date(NOW - 60_000).toISOString()));
      await first.promise;
    });
    expect(current?.reading?.state).toBe('running');
    await act(async () => { await current?.start(); });
    await flush();
    expect(starter).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledTimes(3);
  });
});

const noOp = () => {};
const dispatch: DispatchData = { state: 'unavailable', refresh: noOp };

function resourcesMarkup(reading: QuotaHudReading): string {
  const quotaHud: QuotaHudData = { state: 'ready', reading, refresh: noOp, start: async () => undefined };
  return renderToStaticMarkup(
    <ResourcesView
      locale="zh-CN"
      dispatch={dispatch}
      quotaHud={quotaHud}
      repoPath=""
      onSetRepo={() => 'saved'}
      onOpenClassic={noOp}
    />,
  );
}

describe('ResourcesView quota display', () => {
  it('shows expired values as dashed unknown data, never as green current quota', () => {
    const oldAt = new Date(NOW - 31 * 60 * 1000).toISOString();
    const reading = parsed('stopped', snapshot({
      providers: [{ id: 'codex', detected: true, accountStatus: { status: 'ready', notice: null, checkedAt: freshAt } }],
      quotas: [quota('codex', 13, oldAt)],
    }));
    const container = document.createElement('div');
    container.innerHTML = resourcesMarkup(reading);
    const card = container.querySelector('[data-testid="resource-codex"]');
    expect(card?.textContent).toContain('已过期');
    expect(card?.textContent).toContain('13%');
    expect(card?.querySelector('[data-testid="quota-window-bar"]')?.className).toContain('border-dashed');
    expect(card?.querySelector('[data-testid="quota-window-bar"]')?.innerHTML).not.toContain('bg-v2-done');
  });

  it('keeps absent and null-percent quotas unknown rather than green', () => {
    const absent = document.createElement('div');
    absent.innerHTML = resourcesMarkup(parsed('absent', null));
    const absentCard = absent.querySelector('[data-testid="resource-codex"]');
    expect(absentCard?.textContent).toContain('未知');
    expect(absentCard?.innerHTML).not.toContain('bg-v2-done');

    const unknownPercent = document.createElement('div');
    unknownPercent.innerHTML = resourcesMarkup(parsed('running', snapshot({ quotas: [quota('codex', null)] })));
    const unknownCard = unknownPercent.querySelector('[data-testid="resource-codex"]');
    expect(unknownCard?.textContent).toContain('未知');
    expect(unknownCard?.querySelector('[data-testid="quota-window-bar"]')?.className).toContain('border-dashed');
  });
});

describe('Workbench quota title button', () => {
  it('shows the highest fresh percentage and maps critical usage to the red token', async () => {
    const loader: QuotaHudLoader = async () => rawReading('running', snapshot({
      quotas: [quota('claude', 70, new Date().toISOString()), quota('codex', 95, new Date().toISOString())],
      providers: [{ id: 'codex', detected: true, accountStatus: { status: 'ready', notice: null, checkedAt: freshAt } }],
    }), new Date().toISOString());
    const mounted = await mount(
      <Workbench locale="zh-CN" onOpenClassic={noOp} isDesktop={true} quotaHudLoader={loader} quotaHudStarter={async () => ({ started: true })} />,
    );
    await flush();
    await flush();
    const button = mounted.container.querySelector('[data-testid="quota-button"]');
    expect(button?.textContent).toContain('额度 95%');
    expect(button?.getAttribute('aria-label')).toContain('额度 HUD');
    expect(button?.getAttribute('data-tone')).toBe('critical');
    expect(button?.querySelector('[data-testid="quota-button-dot"]')?.className).toContain('bg-v2-block');
    await act(async () => { (button as HTMLButtonElement).click(); });
    expect(mounted.container.textContent).toContain('Codex CLI');
  });

  it('uses the neutral dot and unknown label when no fresh usage is available', async () => {
    const loader: QuotaHudLoader = async () => rawReading('absent', null, new Date().toISOString());
    const mounted = await mount(
      <Workbench locale="zh-CN" onOpenClassic={noOp} isDesktop={true} quotaHudLoader={loader} quotaHudStarter={async () => ({ started: false })} />,
    );
    await flush();
    await flush();
    const button = mounted.container.querySelector('[data-testid="quota-button"]');
    expect(button?.textContent).toContain('额度未知');
    expect(button?.getAttribute('data-tone')).toBe('unknown');
    expect(button?.querySelector('[data-testid="quota-button-dot"]')?.className).toContain('bg-v2-unknown');
  });
});
