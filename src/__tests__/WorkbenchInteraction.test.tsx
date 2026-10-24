// @vitest-environment jsdom
import { act, useEffect } from 'react';
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
 * Mounted tests for the workbench: the chat tab survives tab switches and parks its webviews,
 * keyboard and focus rules, route fallback, and out-of-order or partial GitHub reads.
 */

const live: { root: Root; container: HTMLElement }[] = [];
let chatMounts = 0;

function ChatStub({ suspended }: { suspended: boolean }) {
  useEffect(() => {
    chatMounts += 1;
  }, []);
  return (
    <div data-testid="chat-stub" data-suspended={String(suspended)}>
      <textarea aria-label="chat input" />
    </div>
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  chatMounts = 0;
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  for (const { root } of live.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
});

const emptyLoader: GitHubLoader = async (repos) => repos.map((repo) => repoResult(repo, []));

async function mount(githubLoader: GitHubLoader = emptyLoader) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  live.push({ root, container });
  await act(async () => root.render(<Workbench locale="en" githubLoader={githubLoader} renderChat={(suspended) => <ChatStub suspended={suspended} />} />));
  await settle();
  return container;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
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
const chat = (container: HTMLElement) => container.querySelector('[data-testid="chat-stub"]');
const buttonByText = (container: ParentNode, text: string) =>
  [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === text);
const tab = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('nav li button')].find((button) => button.textContent?.trim().startsWith(label));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function repoResult(repo: string, tasks: HudTask[], status: GitHubRepoTasks['status'] = 'complete'): GitHubRepoTasks {
  return { repo, tasks, status, errors: status === 'error' ? [{ url: '', observedAt: 't', message: 'down' }] : [], pagination: {}, observedAt: '2026-10-22T12:00:00Z' };
}

function githubTask(id: string, title: string, status: HudTask['status'] = 'running'): HudTask {
  return { id, dataSource: 'github', repo: 'o/a', issue: 1, title: { en: title, zh: title }, status, stages: [], summary: { en: '', zh: '' }, evidence: [] };
}

describe('chat tab', () => {
  it('opens on the chat, ready to type', async () => {
    const container = await mount();
    expect(chat(container)?.getAttribute('data-suspended')).toBe('false');
    expect(tab(container, 'Chat & discuss')?.getAttribute('aria-current')).toBe('page');
  });

  it('keeps the conversation mounted behind other tabs and parks it while they show', async () => {
    const container = await mount();
    await click(tab(container, 'Tasks'));
    expect(h1(container)).toBe('Tasks');
    expect(chat(container)?.getAttribute('data-suspended')).toBe('true');
    expect(container.querySelector('[data-testid="chat-tab"]')?.getAttribute('aria-hidden')).toBe('true');
    await click(tab(container, 'Quota'));
    await click(tab(container, 'Chat & discuss'));
    expect(chat(container)?.getAttribute('data-suspended')).toBe('false');
    expect(container.querySelector('[data-testid="page"]')).toBeNull();
    expect(chatMounts).toBe(1);
  });
});

describe('workbench keyboard and palette', () => {
  it('Ctrl+1..4 switch tabs, but not while typing or while the palette is open', async () => {
    const container = await mount();
    await key(window, { key: '3', ctrlKey: true });
    expect(h1(container)).toBe('Tasks');
    await key(window, { key: '4', ctrlKey: true });
    expect(h1(container)).toBe('Quota');
    await key(window, { key: '1', ctrlKey: true });
    expect(chat(container)?.getAttribute('data-suspended')).toBe('false');
    const input = container.querySelector('textarea') as HTMLTextAreaElement;
    input.focus();
    await key(input, { key: '3', ctrlKey: true });
    expect(chat(container)?.getAttribute('data-suspended')).toBe('false');
    await key(window, { key: 'k', ctrlKey: true });
    await key(document.activeElement as Element, { key: '3', ctrlKey: true });
    expect(dialog()).not.toBeNull();
    expect(chat(container)?.getAttribute('data-suspended')).toBe('false');
  });

  it('Ctrl+K opens the palette with focus in it; Escape closes it and focus returns', async () => {
    const container = await mount();
    await click(tab(container, 'Tasks'));
    const opener = buttonByText(container, 'Refresh');
    opener?.focus();
    await key(window, { key: 'k', ctrlKey: true });
    expect(dialog()).not.toBeNull();
    expect(document.activeElement?.getAttribute('role')).toBe('combobox');
    await key(document.activeElement as Element, { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab inside the palette', async () => {
    await mount();
    await key(window, { key: 'k', ctrlKey: true });
    const input = document.activeElement as HTMLElement;
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => void input.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
  });

  it('Enter runs the highlighted command and focus lands on the page', async () => {
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
    expect(document.activeElement).toBe(container.querySelector('[data-testid="page"]'));
  });
});

describe('tasks tab', () => {
  it('a task that disappears falls back to the list for good', async () => {
    let tasks = [githubTask('t1', 'Vanishing task')];
    const loader: GitHubLoader = async (repos) => repos.map((repo) => repoResult(repo, tasks));
    const container = await mount(loader);
    await click(tab(container, 'Tasks'));
    await click([...container.querySelectorAll('main button')].find((button) => button.textContent?.includes('Vanishing task')));
    expect(h1(container)).not.toBe('Tasks');
    tasks = [];
    await click(buttonByText(container, 'Refresh'));
    await settle();
    expect(h1(container)).toBe('Tasks');
    tasks = [githubTask('t1', 'Vanishing task')];
    await click(buttonByText(container, 'Refresh'));
    await settle();
    expect(h1(container)).toBe('Tasks');
  });

  it('a late answer for an abandoned request never lands', async () => {
    const calls: ReturnType<typeof deferred<GitHubRepoTasks[]>>[] = [];
    const loader: GitHubLoader = () => {
      const next = deferred<GitHubRepoTasks[]>();
      calls.push(next);
      return next.promise;
    };
    const container = await mount(loader);
    await click(tab(container, 'Tasks'));
    expect(container.textContent).toContain('Reading GitHub');
    // Adding a repository starts request 2 and abandons request 1.
    const repoInput = container.querySelector('input[aria-label="owner/repo"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(repoInput, 'o/z');
      repoInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonByText(container, 'Add'));
    expect(calls.length).toBe(2);
    await act(async () => calls[0].resolve([repoResult('xiaolebao516/ai-one', [githubTask('old', 'Stale task')])]));
    expect(container.textContent).not.toContain('Stale task');
    await act(async () => calls[1].resolve([repoResult('xiaolebao516/ai-one', [githubTask('new', 'Fresh task')]), repoResult('o/z', [])]));
    expect(container.textContent).toContain('Fresh task');
  });

  it('a partial read shows counts as "at least" and never as "nothing to do"', async () => {
    const loader: GitHubLoader = async () => [repoResult('o/a', [githubTask('t1', 'Read task')]), repoResult('o/b', [], 'error')];
    const container = await mount(loader);
    expect(tab(container, 'Tasks')?.textContent).toBe('Tasks');
    await click(tab(container, 'Tasks'));
    expect(container.querySelector('[role="radiogroup"][aria-label="Filter tasks"]')?.textContent).toContain('All ≥1');
    expect(container.textContent).toContain('o/b');
  });

  it('with an unreadable task state, counts by state are "at least" and empty groups never say "none"', async () => {
    const loader: GitHubLoader = async () => [repoResult('xiaolebao516/ai-one', [githubTask('t1', 'Done task', 'done'), githubTask('t2', 'Unreadable task', 'unknown')])];
    const container = await mount(loader);
    await click(tab(container, 'Tasks'));
    const filters = container.querySelector('[role="radiogroup"][aria-label="Filter tasks"]')?.textContent ?? '';
    expect(filters).toContain('All2');
    expect(filters).toContain('In progress ≥0');
    const inProgress = [...container.querySelectorAll('[aria-label="Filter tasks"] [role="radio"]')].find((radio) => radio.textContent?.startsWith('In progress'));
    await click(inProgress);
    expect(container.querySelector('main')?.textContent).toContain('None among tasks with a known state');
    expect(container.querySelector('main')?.textContent).not.toContain('No tasks in this view');
  });

  it('a loader that throws ends as "could not be read", not as an endless "reading"', async () => {
    const loader: GitHubLoader = async () => {
      throw new Error('boom');
    };
    const container = await mount(loader);
    await click(tab(container, 'Tasks'));
    expect(container.textContent).toContain('GitHub could not be read');
  });
});
