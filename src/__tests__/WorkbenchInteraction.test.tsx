// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('no tauri'))) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));

import type { GitHubRepoTasks } from '../ui/taskHudGithub';
import type { HudTask } from '../ui/taskHudModel';
import type { GitHubLoader } from '../workbench/useWorkbenchData';
import { Workbench } from '../workbench/Workbench';

/**
 * Mounted tests for the workbench (#79 audit): keyboard and focus rules, route fallback across
 * data-source flips, and out-of-order GitHub reads. These are browser behaviours that static
 * markup cannot prove.
 */

const live: { root: Root; container: HTMLElement }[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  for (const { root } of live.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
});

async function mount(githubLoader?: GitHubLoader) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  live.push({ root, container });
  await act(async () => root.render(<Workbench locale="en" onOpenClassic={() => {}} githubLoader={githubLoader} />));
  return container;
}

async function key(target: EventTarget, init: KeyboardEventInit) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('nothing to click');
  await act(async () => (element as HTMLElement).click());
}

const h1 = (container: HTMLElement) => container.querySelector('main h1')?.textContent ?? '';
const dialog = () => document.querySelector('[role="dialog"]');
const buttonByText = (container: ParentNode, text: string) =>
  [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === text);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function repoResult(repo: string, tasks: HudTask[], status: GitHubRepoTasks['status'] = 'complete'): GitHubRepoTasks {
  return { repo, tasks, status, errors: status === 'error' ? [{ url: '', observedAt: 't', message: 'down' }] : [], pagination: {}, observedAt: '2026-10-22T12:00:00Z' };
}

function githubTask(id: string, title: string): HudTask {
  return { id, dataSource: 'github', repo: 'o/a', title: { en: title, zh: title }, status: 'running', stages: [], summary: { en: '', zh: '' }, evidence: [] };
}

describe('workbench keyboard and palette', () => {
  it('Ctrl+K opens the palette with focus in it; Escape closes it and focus returns', async () => {
    const container = await mount();
    const opener = buttonByText(container, 'All tasks');
    opener?.focus();
    await key(window, { key: 'k', ctrlKey: true });
    expect(dialog()).not.toBeNull();
    expect(document.activeElement?.getAttribute('role')).toBe('combobox');
    await key(document.activeElement as Element, { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('Escape closes the palette even when focus is not in its input', async () => {
    await mount();
    await key(window, { key: 'k', ctrlKey: true });
    (document.activeElement as HTMLElement).blur();
    await key(document.body, { key: 'Escape' });
    expect(dialog()).toBeNull();
  });

  it('keeps Tab inside the palette', async () => {
    await mount();
    await key(window, { key: 'k', ctrlKey: true });
    const input = document.activeElement as HTMLElement;
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => void input.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
  });

  it('Enter runs the highlighted command and focus lands on the page, not on a removed control', async () => {
    const container = await mount();
    await key(window, { key: 'k', ctrlKey: true });
    const input = document.activeElement as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'go to tasks');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await key(input, { key: 'Enter' });
    expect(dialog()).toBeNull();
    expect(h1(container)).toBe('Tasks');
    expect(document.activeElement).toBe(container.querySelector('main'));
  });

  it('Ctrl+1..5 switch pages, but not while typing or while the palette is open', async () => {
    const container = await mount();
    await key(window, { key: '2', ctrlKey: true });
    expect(h1(container)).toBe('Tasks');
    await key(window, { key: '1', ctrlKey: true });
    const composer = container.querySelector('textarea') as HTMLTextAreaElement;
    composer.focus();
    await key(composer, { key: '2', ctrlKey: true });
    expect(h1(container)).not.toBe('Tasks');
    await key(window, { key: 'k', ctrlKey: true });
    await key(document.activeElement as Element, { key: '3', ctrlKey: true });
    expect(dialog()).not.toBeNull();
    expect(h1(container)).not.toBe('Chat');
  });
});

describe('route fallback across data sources', () => {
  it('a task that disappears falls back to the list for good, not just until the source flips back', async () => {
    const failing: GitHubLoader = async (repos) => repos.map((repo) => repoResult(repo, [], 'error'));
    const container = await mount(failing);
    const demoTask = container.querySelector('nav section button') as HTMLButtonElement;
    const title = demoTask.textContent ?? '';
    await click(demoTask);
    expect(container.querySelector('main h1')?.textContent).not.toBe('Tasks');

    await click(buttonByText(container, 'GitHub'));
    expect(h1(container)).toBe('Tasks');
    await click(buttonByText(container, 'Demo data'));
    expect(h1(container)).toBe('Tasks');
    expect(title.length).toBeGreaterThan(0);
  });
});

describe('GitHub reads', () => {
  it('a late answer for an abandoned request never lands, and the old snapshot is not current', async () => {
    const calls: ReturnType<typeof deferred<GitHubRepoTasks[]>>[] = [];
    const loader: GitHubLoader = () => {
      const next = deferred<GitHubRepoTasks[]>();
      calls.push(next);
      return next.promise;
    };
    const container = await mount(loader);

    await click(buttonByText(container, 'GitHub')); // request 1
    expect(h1(container)).toBe('Reading GitHub…');
    await click(buttonByText(container, 'Demo data'));
    await click(buttonByText(container, 'GitHub')); // request 2

    // Request 1 answers late: ignored.
    await act(async () => calls[0].resolve([repoResult('xiaolebao516/ai-one', [githubTask('old', 'Stale task')])]));
    expect(container.textContent).not.toContain('Stale task');
    expect(h1(container)).toBe('Reading GitHub…');

    await act(async () => calls[1].resolve([repoResult('xiaolebao516/ai-one', [githubTask('new', 'Fresh task')])]));
    expect(container.textContent).toContain('Fresh task');
    expect(h1(container)).toBe('1 tasks moving, nothing waiting for you');

    // Refreshing keeps the snapshot visible but stops presenting its counts as current.
    await click(buttonByText(container, 'Refresh'));
    expect(h1(container)).toBe('Reading GitHub…');
    expect(container.querySelector('header button[aria-label]')?.textContent).toContain('?');
  });

  it('a partial read shows what it found as "at least", and an empty part is not "nothing to do"', async () => {
    const loader: GitHubLoader = async () => [repoResult('o/a', []), repoResult('o/b', [], 'error')];
    const container = await mount(loader);
    await click(buttonByText(container, 'GitHub'));
    expect(h1(container)).toBe('Nothing of this kind in what could be read; the rest is unknown.');
    expect(container.querySelector('header button[aria-label]')?.textContent).toContain('≥0');
    expect(container.textContent).not.toContain('No tasks here yet');
    // The sidebar follows the same rule as the status island.
    const sidebar = container.querySelector('nav') as HTMLElement;
    expect(sidebar.textContent).not.toContain('Nothing in progress');
    expect(sidebar.textContent).toContain('Nothing of this kind in what could be read');
  });

  it('partial reads show counts as "at least" in the sidebar, the overview and the task filters', async () => {
    const loader: GitHubLoader = async () => [repoResult('o/a', [githubTask('t1', 'Read task')]), repoResult('o/b', [], 'error')];
    const container = await mount(loader);
    await click(buttonByText(container, 'GitHub'));
    const navTasks = [...container.querySelectorAll('nav li button')].find((button) => button.textContent?.startsWith('Tasks'));
    expect(navTasks?.textContent).toContain('≥1');
    expect(container.querySelector('#home-in-progress')?.textContent).toContain('≥1');
    await key(window, { key: '2', ctrlKey: true });
    expect(container.querySelector('[role="radiogroup"][aria-label="Filter tasks"]')?.textContent).toContain('All ≥1');
  });

  it('a stale snapshot shows "?" in the sidebar while refreshing', async () => {
    const calls: ReturnType<typeof deferred<GitHubRepoTasks[]>>[] = [];
    const loader: GitHubLoader = () => {
      const next = deferred<GitHubRepoTasks[]>();
      calls.push(next);
      return next.promise;
    };
    const container = await mount(loader);
    await click(buttonByText(container, 'GitHub'));
    await act(async () => calls[0].resolve([repoResult('xiaolebao516/ai-one', [githubTask('t1', 'Read task')])]));
    const navTasks = () => [...container.querySelectorAll('nav li button')].find((button) => button.textContent?.startsWith('Tasks'));
    expect(navTasks()?.textContent).toContain('1');
    await click(buttonByText(container, 'Refresh'));
    expect(navTasks()?.textContent).toContain('?');
  });
});
