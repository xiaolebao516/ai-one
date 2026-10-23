// @vitest-environment jsdom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('not tauri'))), isTauri: () => false }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
import { useUserAcceptance, type AcceptanceLoader, type AcceptanceState } from '../workbench/useUserAcceptance';
import { UserAcceptanceSection, pendingAcceptanceCount } from '../workbench/views/UserAcceptanceSection';
import { ACCEPTANCE_STORAGE_KEY, type AcceptanceWriter } from '../workbench/userAcceptance';
import { Workbench } from '../workbench/Workbench';

const item = { key: 'o/r:7:test', repo: 'o/r', issue: 7, title: '确认页面显示正常。', steps: '打开首页', expected: '出现卡片' };
const loader: AcceptanceLoader = async () => ({ items: [item], partial: false, errors: [] });
const roots: Root[] = [];
let container: HTMLDivElement;
const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };
function App({ writer, demo = false }: { writer: AcceptanceWriter; demo?: boolean }) {
  const state = useUserAcceptance(demo ? 'demo' : 'github', ['o/r'], 0, loader, writer);
  return <><output data-testid="count">{pendingAcceptanceCount(state)}</output><UserAcceptanceSection locale="zh-CN" state={state} demo={demo} /></>;
}
async function render(writer: AcceptanceWriter, demo = false) {
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<App writer={writer} demo={demo} />));
  await flush();
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await flush();
}
let latest: AcceptanceState;
function Harness({ api, repos = ['o/r'], read = loader, version = 0, demo = false, onCommit }: {
  api: AcceptanceWriter; repos?: string[]; read?: AcceptanceLoader; version?: number; demo?: boolean; onCommit?: () => void;
}) {
  latest = useUserAcceptance(demo ? 'demo' : 'github', repos, version, read, api);
  useLayoutEffect(() => { onCommit?.(); }, [onCommit]);
  return <UserAcceptanceSection locale="zh-CN" state={latest} demo={demo} />;
}
async function mountHarness(api: AcceptanceWriter) {
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<Harness api={api} />));
  await flush();
  return root;
}
const writer = () => ({
  status: vi.fn(async () => ({ available: true, reason: 'ok' as const })),
  comment: vi.fn(async () => ({ status: 'confirmed' as const, code: 'ok' as const,
    message: '已确认写入 GitHub', steps: [{ step: 'comment' as const, state: 'confirmed' as const }] })),
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); container.remove(); });
describe('acceptance UI and guarded actions', () => {
  it('separates steps/expected; approval hides item and persists after remount', async () => {
    const api = writer();
    await render(api);
    expect(container.textContent).toContain('打开首页');
    expect(container.textContent).toContain('出现卡片');
    await click('没问题');
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('0');
    expect(api.comment).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('确认页面显示正常。');
    await act(async () => roots.pop()!.unmount());
    await render(api);
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('0');
    expect(api.comment).toHaveBeenCalledTimes(1);
  });
  it('takes feedback once and makes unconfirmed write visible', async () => {
    const api = writer();
    api.comment.mockRejectedValueOnce(new Error('uncertain'));
    await render(api);
    await click('有问题');
    const input = container.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(input, '无法点击');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('发送反馈');
    expect(api.comment).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('结果未确认');
    expect(container.textContent).toContain('尚未同步到 GitHub');
  });
  it('does not write in demo mode', async () => {
    const api = writer();
    await render(api, true);
    expect(container.querySelector('button')).toBeNull();
    expect(api.comment).not.toHaveBeenCalled();
  });
  it('shows storage failure and never sends', async () => {
    const api = writer();
    const original = Storage.prototype.setItem;
    const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      await render(api);
      await click('没问题');
      expect(container.textContent).toContain('本地保存失败');
      expect(api.comment).not.toHaveBeenCalled();
    } finally { fail.mockRestore(); void original; }
  });
  it('does not claim no write occurred when saving the confirmed result fails', async () => {
    const api = writer();
    const original = Storage.prototype.setItem;
    let saves = 0;
    const save = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (++saves === 2) throw new Error('quota after comment');
      original.call(this, key, value);
    });
    try {
      await render(api);
      await click('没问题');
      expect(api.comment).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain('本地');
      expect(container.textContent).toContain('核对');
      expect(container.textContent).not.toContain('未向 GitHub 发送');
      expect(container.textContent).not.toContain('尚未同步到 GitHub');
      expect(JSON.parse(localStorage.getItem(ACCEPTANCE_STORAGE_KEY)!)[item.key].sync).toBe('pending');
      await act(async () => roots.pop()!.unmount());
      await render(api);
      expect(container.textContent).toContain('尚未同步到 GitHub');
      expect(container.querySelector('button')).toBeNull();
      expect(api.comment).toHaveBeenCalledTimes(1);
    } finally { save.mockRestore(); }
  });
  it('rejects stale callbacks after removing the repository or changing acceptance content', async () => {
    const api = writer();
    const root = await mountHarness(api);
    const staleSubmit = latest.submit;
    await act(async () => root.render(<Harness api={api} repos={['o/other']} read={async () => ({ items: [], errors: [], partial: false })} />));
    await flush();
    await act(async () => staleSubmit(item, 'approved'));
    expect(api.status).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness api={api} version={1} read={async () => ({ items: [{ ...item, key: 'revised', title: '新内容' }], errors: [], partial: false })} />));
    await flush();
    await act(async () => staleSubmit(item, 'feedback', '旧内容反馈'));
    expect(api.status).not.toHaveBeenCalled();
    expect(api.comment).not.toHaveBeenCalled();
  });
  it('invalidates the old snapshot on a refresh commit before the next passive read effect', async () => {
    const api = writer();
    const root = await mountHarness(api);
    const oldSubmit = latest.submit;
    await act(async () => root.render(<Harness api={api} version={1} onCommit={() => { void oldSubmit(item, 'approved'); }} />));
    await flush();
    expect(api.status).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACCEPTANCE_STORAGE_KEY)).toBeNull();
  });
  it.each(['repository', 'demo', 'content', 'refresh'])('rechecks %s changes after asynchronous auth before sending', async (change) => {
    const api = writer();
    let finishStatus!: (value: { available: true; reason: 'ok' }) => void;
    api.status.mockImplementationOnce(() => new Promise((resolve) => { finishStatus = resolve; }));
    const root = await mountHarness(api);
    let sending!: Promise<void>;
    await act(async () => { sending = latest.submit(item, 'approved'); });
    expect(api.status).toHaveBeenCalledTimes(1);
    const revised: AcceptanceLoader = async () => ({ items: [{ ...item, key: 'revised', title: '新内容' }], errors: [], partial: false });
    await act(async () => root.render(<Harness api={api} repos={change === 'repository' ? ['o/other'] : ['o/r']}
      demo={change === 'demo'} version={1} read={change === 'content' ? revised : loader} />));
    await flush();
    await act(async () => { finishStatus({ available: true, reason: 'ok' }); await sending; });
    expect(api.comment).not.toHaveBeenCalled();
  });
  it('never exposes another repository saved feedback after a repository switch', async () => {
    localStorage.setItem(ACCEPTANCE_STORAGE_KEY, JSON.stringify({
      [item.key]: { ...item, kind: 'feedback', sync: 'unconfirmed', feedback: '私有反馈' },
    }));
    const api = writer();
    const root = await mountHarness(api);
    expect(container.textContent).toContain(item.title);
    await act(async () => root.render(<Harness api={api} repos={['o/other']} read={async () => ({ items: [], errors: [], partial: false })} />));
    await flush();
    expect(container.textContent).not.toContain(item.title);
    expect(latest.records[item.key]).toBeUndefined();
  });
  it('uses the independent acceptance read health when the task read failed', async () => {
    localStorage.setItem('ai-one.workbench.prefs', JSON.stringify({ source: 'github', repos: ['o/r'], theme: 'system', dispatchRepo: '' }));
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Workbench locale="en" onOpenClassic={() => {}}
      acceptanceLoader={loader} githubLoader={async () => [{ repo: 'o/r', tasks: [], status: 'error', errors: [], pagination: {}, observedAt: 'now' }]} />));
    await flush();
    expect(container.querySelector('header button[aria-label="1 acceptances"]')).not.toBeNull();
  });
});
