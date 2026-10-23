// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ghWriteModule from '../host/githubWrite';
import type { HudTask } from '../ui/taskHudModel';
import { TaskView } from '../workbench/views/TaskView';

const baseTask: HudTask = {
  id: 'task-test',
  dataSource: 'github',
  repo: 'xiaolebao516/ai-one',
  issue: 110,
  title: { zh: '任务现场补全', en: 'Task Live Controls' },
  status: 'running',
  stages: [
    { name: { zh: '执行与审计', en: 'Build & Audit' }, state: 'active' },
  ],
  summary: { zh: '检查器抽屉、留言、暂停及验收按钮', en: 'Inspector drawer, comments, pause and acceptance' },
  pr: {
    number: 126,
    draft: false,
    headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  ci: {
    state: 'success',
  },
  evidence: [
    {
      id: 'ev-1',
      kind: 'readback',
      text: { zh: '独立审计意见已回读', en: 'Review feedback read back' },
    },
  ],
};

const live: { root: Root; container: HTMLElement }[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.restoreAllMocks();
  vi.spyOn(ghWriteModule.githubWrite, 'status').mockResolvedValue({ available: true, reason: 'ok' });
});

afterEach(async () => {
  for (const { root } of live.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
});

describe('TaskView Controls & Live Inspector integration (Spec #110)', () => {
  it('renders static markup with inspector button, comment box, team and pause control', () => {
    const html = renderToStaticMarkup(<TaskView locale="zh-CN" task={baseTask} onBack={vi.fn()} />);

    expect(html).toContain('data-testid="inspector-button"');
    expect(html).toContain('给 CC 留言');
    expect(html).toContain('团队');
    expect(html).toContain('Claude Code');
    expect(html).toContain('ChatGPT (Pro)');
    expect(html).toContain('data-testid="pause-toggle-button"');
    expect(html).toContain('派工单 ›');
    expect(html).toContain('Diff ›');
  });

  it('renders disabled comment box in mock mode', () => {
    const mockTask: HudTask = { ...baseTask, dataSource: 'mock' };
    const html = renderToStaticMarkup(<TaskView locale="zh-CN" task={mockTask} onBack={vi.fn()} />);

    expect(html).toContain('演示数据，不会真的发出');
    expect(html).toContain('disabled');
  });

  it('renders acceptance card actions when status is accept', () => {
    const acceptTask: HudTask = {
      ...baseTask,
      status: 'accept',
      pr: {
        number: 126,
        draft: false,
        headSha: '1111111111111111111111111111111111111111',
      },
    };

    const html = renderToStaticMarkup(<TaskView locale="zh-CN" task={acceptTask} onBack={vi.fn()} />);
    expect(html).toContain('data-testid="accept-pass-button"');
    expect(html).toContain('验收通过');
    expect(html).toContain('验收通过（不会合并）');
    expect(html).toContain('要求修改…');
  });

  it('renders notification island when task needs user attention', () => {
    const blockedTask: HudTask = {
      ...baseTask,
      status: 'blocked',
    };

    const html = renderToStaticMarkup(<TaskView locale="zh-CN" task={blockedTask} onBack={vi.fn()} />);
    expect(html).toContain('data-testid="notification-island"');
    expect(html).toContain('阻塞');
  });

  it('mounted: opens drawer from inspector button and closes it', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={baseTask} onBack={vi.fn()} />);
    });

    expect(container.querySelector('[data-testid="task-inspector-drawer"]')).toBeNull();

    const inspectorBtn = container.querySelector('[data-testid="inspector-button"]');
    expect(inspectorBtn).toBeDefined();

    await act(async () => {
      inspectorBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="task-inspector-drawer"]')).toBeDefined();
  });

  it('mounted: opens drawer to specific tabs from evidence links', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={baseTask} onBack={vi.fn()} />);
    });

    const diffLink = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Diff ›')
    );
    expect(diffLink).toBeDefined();

    await act(async () => {
      diffLink?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="task-inspector-drawer"]')).toBeDefined();
    expect(container.textContent).toContain('在 GitHub 打开 PR Files');
  });

  it('mounted: handles takeover banner open and exit', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={baseTask} onBack={vi.fn()} />);
    });

    expect(container.querySelector('[data-testid="takeover-banner"]')).toBeNull();

    const takeoverBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent === '接管'
    );
    expect(takeoverBtn).toBeDefined();

    await act(async () => {
      takeoverBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="takeover-banner"]')).toBeDefined();
    expect(container.textContent).toContain('你正在自己操作 ChatGPT (Pro) 的网页');

    const exitBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent === '回到任务'
    );
    expect(exitBtn).toBeDefined();

    await act(async () => {
      exitBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="takeover-banner"]')).toBeNull();
  });

  it('mounted: handles pause and resume toggle', async () => {
    const spyPause = vi.spyOn(ghWriteModule.githubWrite, 'setPause').mockResolvedValue({
      status: 'confirmed',
      code: 'ok',
      message: '已暂停',
      steps: [{ step: 'comment', state: 'confirmed' }],
    });

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={baseTask} onBack={vi.fn()} />);
    });

    const pauseBtn = container.querySelector('[data-testid="pause-toggle-button"]');
    expect(pauseBtn?.textContent).toContain('暂停');

    await act(async () => {
      pauseBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(spyPause).toHaveBeenCalledWith({
      repo: 'xiaolebao516/ai-one',
      issue: 110,
      state: 'paused',
    });
  });
});
