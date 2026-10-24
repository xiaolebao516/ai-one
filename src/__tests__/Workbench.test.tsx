import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('no tauri'))) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));

import { TASK_HUD_MOCK_TASKS } from '../ui/taskHudMockData';
import { Workbench } from '../workbench/Workbench';
import { paletteCommands } from '../workbench/paletteCommands';
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
  const chat = (suspended: boolean) => <div data-testid="chat-stub" data-suspended={String(suspended)} />;

  it('opens straight on the chat, with the four tabs and nothing else in the way', () => {
    const html = renderToStaticMarkup(<Workbench locale="zh-CN" renderChat={chat} />);
    const text = visibleText(html);
    expect(html).toContain('data-testid="workbench"');
    expect(html).toContain('aria-label="主导航"');
    for (const label of ['聊天与讨论', '派活', '任务', '额度']) expect(text).toContain(label);
    expect(html).toContain('data-testid="chat-stub" data-suspended="false"');
    expect(text).not.toContain('旧版聊天界面');
    expect(text).not.toContain('阶段与流程');
    expect(text).not.toContain('总览');
  });

  it('has palette commands for every tab, the data source and the theme', () => {
    const ids = paletteCommands(workbenchText('en'), TASK_HUD_MOCK_TASKS, 'en').map((command) => command.id);
    for (const id of ['go-chat', 'go-chatled', 'go-tasks', 'go-resources', 'source-demo', 'source-github', 'refresh', 'theme']) {
      expect(ids).toContain(id);
    }
    expect(ids).not.toContain('classic');
    expect(ids.filter((id) => id.startsWith('task-'))).toHaveLength(TASK_HUD_MOCK_TASKS.length);
  });
});

describe('Task list', () => {
  it('never turns a failed or pending GitHub read into "no tasks"', () => {
    const loading = visibleText(renderToStaticMarkup(<TasksView locale="en" tasks={[]} health="loading" onOpenTask={noop} />));
    expect(loading).toContain('Reading GitHub');
    expect(loading).not.toContain('No tasks in this view');
    const failed = visibleText(renderToStaticMarkup(<TasksView locale="en" tasks={[]} health="failed" onOpenTask={noop} />));
    expect(failed).toContain('GitHub could not be read');
    const empty = visibleText(renderToStaticMarkup(<TasksView locale="en" tasks={[]} health="complete" onOpenTask={noop} />));
    expect(empty).toContain('GitHub returned no open Issues or PRs');
  });

  it('shows the lead (acceptance cards) above the list', () => {
    const html = renderToStaticMarkup(<TasksView locale="en" tasks={TASK_HUD_MOCK_TASKS} health="demo" onOpenTask={noop} lead={<p id="lead">lead</p>} />);
    expect(html.indexOf('id="lead"')).toBeGreaterThan(html.indexOf('<h1'));
    expect(html.indexOf('id="lead"')).toBeLessThan(html.indexOf('<section'));
  });
});

describe('Task page needs-you', () => {
  it('spells out what the user has to do and where, for decide / blocked / accept tasks', () => {
    const waiting = TASK_HUD_MOCK_TASKS.find((item) => item.status === 'decide' || item.status === 'accept' || item.status === 'blocked');
    expect(waiting).toBeDefined();
    const html = renderToStaticMarkup(<TaskView locale="en" task={waiting!} onBack={noop} />);
    expect(html).toContain('id="task-needs-you"');
    expect(visibleText(html)).toContain('ai-one has no decision button yet');
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
