import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('no tauri'))) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));

import { TASK_HUD_MOCK_TASKS } from '../ui/taskHudMockData';
import { Workbench } from '../workbench/Workbench';
import { paletteCommands } from '../workbench/paletteCommands';
import { HomeView } from '../workbench/views/HomeView';
import { TaskView } from '../workbench/views/TaskView';
import { TasksView } from '../workbench/views/TasksView';
import { workbenchText } from '../workbench/workbenchText';

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
}

const noop = () => {};

describe('Workbench shell', () => {
  it('opens on the overview with navigation, the status island and the demo-data notice', () => {
    const html = renderToStaticMarkup(<Workbench locale="zh-CN" onOpenClassic={noop} />);
    const text = visibleText(html);
    expect(html).toContain('data-testid="workbench"');
    expect(html).toContain('aria-label="主导航"');
    for (const label of ['总览', '任务', '聊天', '阶段与流程', '资源']) expect(text).toContain(label);
    expect(html).toContain('aria-current="page"');
    expect(text).toContain('演示数据：这里的任务、提交、审查都是虚构的示例');
    expect(text).toMatch(/\d+ 进行中/);
    expect(text).toContain('旧版聊天界面');
  });

  it('has palette commands for every view, the data source, the theme and the classic UI', () => {
    const ids = paletteCommands(workbenchText('en'), TASK_HUD_MOCK_TASKS, 'en').map((command) => command.id);
    for (const id of ['go-home', 'go-tasks', 'go-chat', 'go-flows', 'go-resources', 'source-demo', 'source-github', 'refresh', 'theme', 'classic']) {
      expect(ids).toContain(id);
    }
    expect(ids.filter((id) => id.startsWith('task-'))).toHaveLength(TASK_HUD_MOCK_TASKS.length);
  });
});

describe('Overview', () => {
  it('leads with the needs-you count and lists needs-you before in-progress work', () => {
    const text = visibleText(renderToStaticMarkup(<HomeView locale="en" tasks={TASK_HUD_MOCK_TASKS} health="demo" onOpenTask={noop} onShowTasks={noop} />));
    expect(text).toMatch(/\d+ tasks moving, \d+ waiting for you/);
    expect(text.indexOf('Needs you')).toBeLessThan(text.indexOf('In progress'));
    expect(text).toContain('From the demo data on this page.');
  });

  it('cannot start work yet and says why instead of pretending', () => {
    const html = renderToStaticMarkup(<HomeView locale="en" tasks={[]} health="demo" onOpenTask={noop} onShowTasks={noop} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Not connected yet[^"]*"/);
    expect(visibleText(html)).toContain('ai-one cannot dispatch work on its own');
  });

  it('never turns a failed or pending GitHub read into "no tasks"', () => {
    const failed = visibleText(renderToStaticMarkup(<HomeView locale="en" tasks={[]} health="failed" onOpenTask={noop} onShowTasks={noop} />));
    expect(failed).toContain('GitHub could not be read');
    expect(failed).not.toContain('No tasks here yet');
    const loading = visibleText(renderToStaticMarkup(<TasksView locale="en" tasks={[]} health="loading" onOpenTask={noop} />));
    expect(loading).toContain('Reading GitHub');
    expect(loading).not.toContain('No tasks in this view');
    const empty = visibleText(renderToStaticMarkup(<TasksView locale="en" tasks={[]} health="complete" onOpenTask={noop} />));
    expect(empty).toContain('GitHub returned no open Issues or PRs');
    const partial = visibleText(renderToStaticMarkup(<HomeView locale="en" tasks={[]} health="partial" onOpenTask={noop} onShowTasks={noop} />));
    expect(partial).toContain('Only part of GitHub could be read');
    expect(partial).not.toContain('No tasks here yet');
  });

  it('never says "nothing waiting for you" while some task state is unreadable', () => {
    const running = TASK_HUD_MOCK_TASKS.find((item) => item.status === 'running')!;
    const unreadable = { ...running, id: 'x-unknown', status: 'unknown' as const };
    const text = visibleText(renderToStaticMarkup(<HomeView locale="en" tasks={[running, unreadable]} health="complete" onOpenTask={noop} onShowTasks={noop} />));
    expect(text).toContain('1 more with an unreadable state');
    expect(text).not.toContain('nothing waiting for you');
  });
});

describe('Task page needs-you', () => {
  it('spells out what the user has to do and where, for decide / blocked / accept tasks', () => {
    const waiting = TASK_HUD_MOCK_TASKS.find((item) => item.status === 'decide' || item.status === 'accept' || item.status === 'blocked');
    expect(waiting).toBeDefined();
    const html = renderToStaticMarkup(<TaskView locale="en" task={waiting!} onBack={noop} />);
    expect(html).toContain('id="task-needs-you"');
    expect(visibleText(html)).toContain('ai-one cannot act on this yet');
    const running = TASK_HUD_MOCK_TASKS.find((item) => item.status === 'running');
    expect(renderToStaticMarkup(<TaskView locale="en" task={running!} onBack={noop} />)).not.toContain('id="task-needs-you"');
  });
});

describe('Task page', () => {
  const task = TASK_HUD_MOCK_TASKS.find((item) => item.pr && item.evidence.length > 0) ?? TASK_HUD_MOCK_TASKS[0];

  it('shows now, stages, evidence with its source, and the delivery facts', () => {
    const text = visibleText(renderToStaticMarkup(<TaskView locale="en" task={task} onBack={noop} />));
    for (const label of ['Now', 'Evidence', 'Delivery', 'HEAD', 'CI', 'Review', 'All tasks']) expect(text).toContain(label);
    // Demo read-backs must say they are examples, not real GitHub reads.
    expect(text).toMatch(/\(example\)/);
  });
});
