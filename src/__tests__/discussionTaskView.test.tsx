// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LocalStoreFs } from '../host/localStore';
import { host } from '../host';
import { newDiscussionTask, type LocalTask } from '../stages/localTasks';
import { useLocalTasks } from '../stages/useLocalTasks';
import { DiscussionTaskView } from '../workbench/views/DiscussionTaskView';
import { Workbench } from '../workbench/Workbench';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => []), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
const byText = (text: string) => [...container.querySelectorAll('button')].find((b) => b.querySelector('span')?.textContent === text)!;
const click = async (element: HTMLElement) => { expect(element).toBeDefined(); await act(async () => element.click()); };

function fixture(): LocalTask {
  const task = newDiscussionTask('Local discussion test');
  task.status = 'needs-you';
  task.rounds[0].steps = [{
    id: 'first', nodeId: 'first', name: 'Independent', speaker: 'chatgpt',
    text: 'Private full reply', status: 'done', startedAt: task.createdAt,
  }];
  return task;
}
function memoryFs(task: LocalTask) {
  let text = JSON.stringify({ schemaVersion: 1, tasks: [task] });
  const fs: LocalStoreFs = {
    read: vi.fn(async () => ({ status: 'ok' as const, text, backup: null })),
    write: vi.fn(async (_name, json) => { text = json; }),
    quarantine: vi.fn(async () => null), exportFile: vi.fn(async () => null),
  };
  return { fs, read: () => JSON.parse(text) as { tasks: LocalTask[] } };
}
function Harness({ fs }: { fs: LocalStoreFs }) {
  const store = useLocalTasks(fs);
  return store.tasks[0] ? <DiscussionTaskView task={store.tasks[0]} store={store} locale="en"
    source="github" defaultRepo="owner/repo" onBack={() => {}} /> : <span>No local task</span>;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.spyOn(host.app, 'isDesktop').mockReturnValue(true);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

it('saves the summary and all full replies, while unavailable resume controls send nothing', async () => {
  const { fs, read } = memoryFs(fixture());
  await act(async () => root.render(<Harness fs={fs} />));
  expect(container.textContent).toContain('Private full reply');
  expect(byText('Follow up').disabled).toBe(true);
  expect(byText('Restart').disabled).toBe(true);
  expect(container.textContent).not.toContain('Give CC a message');
  await click(byText('Finish and save'));
  expect(read().tasks[0].status).toBe('ended');
  expect(read().tasks[0].rounds[0].summary).toContain('Evidence gaps');
  expect(read().tasks[0].rounds[0].steps[0].text).toBe('Private full reply');
});

it('persists a pending marker before creating an Issue and never resends an unknown outcome after remount', async () => {
  const { fs, read } = memoryFs(fixture());
  const create = vi.spyOn(host.githubWrite, 'createIssue').mockImplementation(async () => {
    expect(read().tasks[0].issueCreation?.status).toBe('pending');
    throw new Error('connection dropped after send');
  });
  await act(async () => root.render(<Harness fs={fs} />));
  await click(byText('Create Task Issue'));
  expect(create).toHaveBeenCalledTimes(1);
  expect(byText('Create Task Issue').disabled).toBe(true);
  await act(async () => root.render(<Harness key="reloaded" fs={fs} />));
  await click(byText('Create Task Issue'));
  expect(create).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Check GitHub');
});

it('does not send an external request when the pending marker cannot be saved', async () => {
  const { fs } = memoryFs(fixture());
  vi.mocked(fs.write).mockRejectedValue(new Error('disk full'));
  const create = vi.spyOn(host.githubWrite, 'createIssue');
  await act(async () => root.render(<Harness fs={fs} />));
  await click(byText('Create Task Issue'));
  expect(create).not.toHaveBeenCalled();
  expect(container.textContent).toContain('disk full');
});

it('removes every round from the primary local collection', async () => {
  const { fs, read } = memoryFs(fixture());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await act(async () => root.render(<Harness fs={fs} />));
  await click(byText('Delete local discussion'));
  expect(read().tasks).toEqual([]);
  expect(container.textContent).not.toContain('Private full reply');
});

it('keeps local routing and the discussion group when switching data sources, without auto-resuming', async () => {
  const task = fixture(); task.status = 'running';
  window.localStorage.setItem('ai-one.local-store.localTasks', JSON.stringify({ schemaVersion: 1, tasks: [task] }));
  const githubLoader = vi.fn(async () => []);
  await act(async () => root.render(<Workbench locale="en" onOpenClassic={() => {}} githubLoader={githubLoader} />));
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true })));
  expect(container.textContent).toContain('Discussions');
  const local = [...container.querySelectorAll('main button')].find((b) => b.textContent?.includes(task.title)) as HTMLButtonElement;
  await click(local);
  expect(container.querySelector('main h1')?.textContent).toBe(task.title);
  expect(container.textContent).toContain('interrupted');
  await click(container.querySelector('#workbench-source-opt-github')!);
  expect(container.querySelector('main h1')?.textContent).toBe(task.title);
  expect(container.textContent).toContain('Private full reply');
});
