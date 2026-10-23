// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('not tauri'))), isTauri: () => false }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
import { useUserAcceptance, type AcceptanceLoader } from '../workbench/useUserAcceptance';
import { UserAcceptanceSection, pendingAcceptanceCount } from '../workbench/views/UserAcceptanceSection';
import type { AcceptanceWriter } from '../workbench/userAcceptance';

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
});
