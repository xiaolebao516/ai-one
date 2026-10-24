// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('not tauri'))), isTauri: () => false }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
import { TaskRow } from '../workbench/TaskBits';
import { TASK_HUD_MOCK_TASKS } from '../ui/taskHudMockData';

let root: Root | undefined;
let container: HTMLDivElement;
const task = { ...TASK_HUD_MOCK_TASKS[0], repo: 'o/r', issue: 12 };
const noIssue = { ...TASK_HUD_MOCK_TASKS[0], repo: 'o/r', issue: undefined };
async function render(node: React.ReactElement) {
  root = createRoot(container);
  const current = root;
  await act(async () => current.render(<ul>{node}</ul>));
}
const labels = () => [...container.querySelectorAll('button')].map((b) => b.textContent?.trim());
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(async () => { const current = root; root = undefined; if (current) await act(async () => current.unmount()); container.remove(); });

describe('dispatch on task list rows', () => {
  it('shows a Dispatch button beside a real task and opens the panel under the row without opening the task', async () => {
    const onOpen = vi.fn();
    await render(<TaskRow task={task} locale="zh-CN" onOpen={onOpen} canDispatch />);
    const dispatch = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === '派工')!;
    expect(dispatch.getAttribute('aria-label')).toBe('派工 #12');
    await act(async () => dispatch.click());
    expect(onOpen).not.toHaveBeenCalled();
    expect(container.querySelector('[role="group"]')?.textContent).toContain('派给谁');
    expect(labels().filter((label) => label === '派工')).toHaveLength(1);
    await act(async () => dispatch.click());
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
  it('still opens the task when the row itself is clicked', async () => {
    const onOpen = vi.fn();
    await render(<TaskRow task={task} locale="zh-CN" onOpen={onOpen} canDispatch />);
    await act(async () => container.querySelector('button')!.click());
    expect(onOpen).toHaveBeenCalledWith(task);
  });
  it('offers no dispatch for demo data or for a task without an Issue number', async () => {
    await render(<TaskRow task={task} locale="zh-CN" onOpen={() => {}} />);
    expect(labels()).not.toContain('派工');
    await act(async () => root!.render(<ul><TaskRow task={noIssue} locale="zh-CN" onOpen={() => {}} canDispatch /></ul>));
    expect(labels()).not.toContain('派工');
  });
});
