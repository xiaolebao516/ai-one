// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('no tauri'))) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));

import type { DispatchLoader } from '../workbench/useDispatchData';
import { useWorkbenchData, type GitHubLoader, type WorkbenchData } from '../workbench/useWorkbenchData';
import { Workbench } from '../workbench/Workbench';
import { STORAGE_KEYS } from '../workbench/workbenchStorage';

/** Resources page and the Prodex channel entry (Spec #98): every read state says what it knows. */

const live: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  for (const root of live.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
});

const githubLoader: GitHubLoader = async (repos) => repos.map((repo) => ({ repo, tasks: [], status: 'complete', errors: [], pagination: {}, observedAt: '2026-10-23T08:00:00Z' }));

function realPrefs(dispatchRepo: string) {
  window.localStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify({ source: 'github', repos: ['o/a'], theme: 'light', dispatchRepo }));
}

async function mount(options: { dispatchLoader?: DispatchLoader; isDesktop?: boolean; locale?: 'en' | 'zh-CN' } = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  live.push(root);
  await act(async () =>
    root.render(<Workbench locale={options.locale ?? 'en'} onOpenClassic={() => {}} githubLoader={githubLoader} dispatchLoader={options.dispatchLoader} isDesktop={options.isDesktop} />),
  );
  return container;
}

async function openResources(container: HTMLElement) {
  await act(async () => (container.querySelector('[data-testid="channel-button"]') as HTMLElement).click());
}

const channel = (container: HTMLElement) => container.querySelector('[data-testid="prodex-channel"]')?.textContent ?? '';

// "Recent" is measured from the moment of the read, so these are relative to the real clock.
const RECENT = new Date(Date.now() - 30 * 60_000).toISOString();
const OLD = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
const RAW = {
  sessions: [
    { id: 'sess_20261023_073000_gpt-pro-consult', task_id: 'task_20261023_073000_gpt-pro-consult', status: 'blocked', blocker_code: 'send_timeout', session_key: 'opus-98', created_at: RECENT, last_used_at: RECENT },
    { id: 'sess_20261020_070000_gpt-pro-consult', task_id: 'task_20261020_070000_gpt-pro-consult', status: 'blocked', blocker_code: 'request_mismatch', session_key: 'opus-98', created_at: OLD, last_used_at: OLD },
  ],
  receipts: [],
  slots: [
    { id: 1, port: 9333, claim_present: true, stale: false, task: '#98', session_key: 'opus-98' },
    { id: 2, port: 9334, claim_present: false },
  ],
};

describe('resources page', () => {
  it('replaces the placeholder and shows demo dispatch records labelled as demo', async () => {
    const container = await mount();
    await openResources(container);
    expect(container.querySelector('main h1')?.textContent).toBe('Resources');
    expect(container.textContent).not.toContain('Being built');
    expect(channel(container)).toContain('Demo dispatch records');
    expect(container.querySelector('[data-testid="dispatch-receipts"]')).not.toBeNull();
    // Quota and logins have no source yet: they say so instead of showing a filled bar.
    expect(container.textContent).toContain('Not checked');
    expect(container.textContent).toContain('so every quota below is unknown');
  });

  it('asks for the repository folder before reading anything local', async () => {
    realPrefs('');
    const loader = vi.fn<DispatchLoader>();
    const container = await mount({ dispatchLoader: loader, isDesktop: true });
    await openResources(container);
    expect(loader).not.toHaveBeenCalled();
    expect(channel(container)).toContain('Enter the local repository folder');
    expect(container.querySelector('[data-testid="channel-button"]')?.getAttribute('aria-label')).toContain('Not read');
  });

  it('reads local records, counts recent problems and keeps reply text out', async () => {
    realPrefs('D:/code/ai-one');
    const loader = vi.fn<DispatchLoader>(async () => RAW);
    const container = await mount({ dispatchLoader: loader, isDesktop: true });
    await openResources(container);
    expect(loader).toHaveBeenCalledWith('D:/code/ai-one');
    const text = channel(container);
    expect(text).toContain('2 dispatches · 0 running · 0 done · 1 timed out · 1 request mismatches · 0 recovered');
    // The old mismatch is counted above but is outside the last-24-hours window.
    expect(text).toContain('Last 24 h: 1 timed out or mismatched, 0 blocked for other reasons');
    expect(text).toContain('Slots: 1 claimed · 1 free · 0 stale heartbeat · 0 unreadable');
    expect(container.querySelector('[data-testid="channel-button"]')?.getAttribute('aria-label')).toContain('Recent problems');
  });

  it('says the read failed instead of showing old records', async () => {
    realPrefs('D:/code/ai-one');
    const container = await mount({ dispatchLoader: async () => Promise.reject(new Error('denied')), isDesktop: true });
    await openResources(container);
    expect(channel(container)).toContain('Could not read local dispatch records');
    expect(container.querySelector('[data-testid="dispatch-receipts"]')).toBeNull();
  });

  it('does not read in a browser preview', async () => {
    realPrefs('D:/code/ai-one');
    const loader = vi.fn<DispatchLoader>();
    const container = await mount({ dispatchLoader: loader, isDesktop: false });
    await openResources(container);
    expect(loader).not.toHaveBeenCalled();
    expect(channel(container)).toContain('only be read in the desktop app');
  });

  it('rejects a relative folder and keeps the saved one', async () => {
    realPrefs('');
    const container = await mount({ dispatchLoader: async () => RAW, isDesktop: true });
    await openResources(container);
    const input = container.querySelector('#resources-repo-path') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '../elsewhere');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => input.form?.requestSubmit());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('absolute folder path');
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.prefs) ?? '{}').dispatchRepo ?? '').toBe('');
  });

  it('a lone line break is rejected, not taken as "clear the folder"', async () => {
    realPrefs('D:/code/ai-one');
    let data: WorkbenchData | undefined;
    function Probe() {
      data = useWorkbenchData(githubLoader);
      return null;
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push(root);
    await act(async () => root.render(<Probe />));
    for (const input of ['\n', '\r\n', 'D:/code\n']) {
      let result: string | undefined;
      await act(async () => {
        result = data?.setDispatchRepo(input);
      });
      expect(result).toBe('invalid');
    }
    expect(data?.prefs.dispatchRepo).toBe('D:/code/ai-one');
    await act(async () => {
      data?.setDispatchRepo('   ');
    });
    expect(data?.prefs.dispatchRepo).toBe('');
  });

  it('shows Chinese copy in a Chinese locale', async () => {
    const container = await mount({ locale: 'zh-CN' });
    await openResources(container);
    expect(container.querySelector('main h1')?.textContent).toBe('资源');
    expect(channel(container)).toContain('演示派工记录');
    expect(container.textContent).toContain('协调者与本地 Agent');
  });
});
