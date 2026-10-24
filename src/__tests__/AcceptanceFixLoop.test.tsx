// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('not tauri'))), isTauri: () => false }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
import { useUserAcceptance, type AcceptanceLoader } from '../workbench/useUserAcceptance';
import { UserAcceptanceSection } from '../workbench/views/UserAcceptanceSection';
import { ACCEPTANCE_STORAGE_KEY, type AcceptanceWriter } from '../workbench/userAcceptance';
import type { IssueStates } from '../workbench/acceptanceFix';

const item = { key: 'o/r:7:test', repo: 'o/r', issue: 7, title: '确认页面显示正常。', steps: '打开首页', expected: '出现卡片' };
let states: IssueStates = {};
const loader: AcceptanceLoader = async () => ({ items: [item], partial: false, errors: [], issueStates: states });
let root: Root | undefined;
let container: HTMLDivElement;
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
function App({ writer, version }: { writer: AcceptanceWriter; version: number }) {
  const state = useUserAcceptance('github', ['o/r'], version, loader, writer);
  return <UserAcceptanceSection locale="zh-CN" state={state} demo={false} />;
}
async function render(writer: AcceptanceWriter, version = 0) {
  root ??= createRoot(container);
  const current = root;
  await act(async () => current.render(<App writer={writer} version={version} />));
  await flush();
}
const labels = () => [...container.querySelectorAll('button')].map((b) => b.textContent?.trim());
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
  await flush();
}
async function sendFeedback(text: string) {
  await click('有问题');
  const input = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('发送反馈');
}
const ok = { status: 'confirmed' as const, code: 'ok' as const, message: '已确认写入 GitHub' };
const writer = () => ({
  status: vi.fn(async () => ({ available: true, reason: 'ok' as const })),
  comment: vi.fn(async () => ({ ...ok, steps: [{ step: 'comment' as const, state: 'confirmed' as const }] })),
  createIssue: vi.fn(async () => ({ ...ok, issueNumber: 99, url: 'https://github.com/o/r/issues/99',
    steps: [{ step: 'create_issue' as const, state: 'confirmed' as const }, { step: 'sub_issue' as const, state: 'confirmed' as const }] })),
});
const createArgs = (api: { createIssue: { mock: { calls: unknown[][] } } }) => api.createIssue.mock.calls[0]?.[0];
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  states = {};
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(async () => {
  const current = root;
  root = undefined;
  if (current) await act(async () => current.unmount());
  container.remove();
});

describe('feedback becomes a fix task and comes back for re-acceptance', () => {
  it('creates one fix Task, shows it working, then asks for a fresh decision when it is closed', async () => {
    const api = writer();
    await render(api);
    await sendFeedback('按钮点不动');
    expect(api.comment).toHaveBeenCalledTimes(1);
    expect(api.createIssue).toHaveBeenCalledTimes(1);
    expect(createArgs(api)).toMatchObject({ repo: 'o/r', parentSpec: 7 });
    expect(JSON.parse(localStorage.getItem(ACCEPTANCE_STORAGE_KEY)!)[item.key].fix).toMatchObject({ sync: 'confirmed', issue: 99 });
    expect(container.textContent).toContain('#99');
    expect(container.textContent).toContain('正在同步状态');
    expect(labels()).not.toContain('没问题');

    states = { 'o/r#99': { state: 'open' } };
    await render(api, 1);
    expect(container.textContent).toContain('修复任务 #99 处理中');

    states = { 'o/r#99': { state: 'closed', reason: 'completed' } };
    await render(api, 2);
    expect(container.textContent).toContain('已修复（#99），请重新验收');
    await click('没问题');
    expect(api.comment).toHaveBeenCalledTimes(2);
    expect(api.createIssue).toHaveBeenCalledTimes(1);
  });
  it('offers retry only after a definite create failure', async () => {
    const api = writer();
    api.createIssue.mockResolvedValueOnce({ status: 'failed', code: 'github_failed', message: 'x', steps: [] } as never);
    await render(api);
    await sendFeedback('坏了');
    expect(container.textContent).toContain('修复任务没有建成');
    await click('重试创建修复任务');
    expect(api.createIssue).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('#99');
    expect(labels()).not.toContain('重试创建修复任务');
  });
  it('never retries or offers retry after an unknown create result', async () => {
    const api = writer();
    api.createIssue.mockRejectedValueOnce(new Error('lost'));
    await render(api);
    await sendFeedback('坏了');
    expect(container.textContent).toContain('不确定修复任务是否建成');
    expect(labels()).not.toContain('重试创建修复任务');
    expect(api.createIssue).toHaveBeenCalledTimes(1);
  });
  it('does not create a Task when the comment was not confirmed', async () => {
    const api = writer();
    api.comment.mockRejectedValueOnce(new Error('uncertain'));
    await render(api);
    await sendFeedback('坏了');
    expect(api.createIssue).not.toHaveBeenCalled();
  });
});
