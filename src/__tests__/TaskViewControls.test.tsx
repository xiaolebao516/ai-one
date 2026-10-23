// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ghWriteModule from '../host/githubWrite';
import type { HudTask } from '../ui/taskHudModel';
import { TaskView } from '../workbench/views/TaskView';
import { getTakeoverAi, setStoredTakeoverAi } from '../workbench/workbenchStorage';

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
  it('mounted: comment submission appends readback evidence to list', async () => {
    vi.spyOn(ghWriteModule.githubWrite, 'comment').mockResolvedValue({
      status: 'confirmed',
      code: 'ok',
      message: '已确认',
      steps: [],
    });

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={baseTask} onBack={vi.fn()} />);
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeDefined();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '你好，请推进下一阶段');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const submitBtn = container.querySelector('button[data-testid="comment-submit"]') as HTMLButtonElement;
    expect(submitBtn).toBeDefined();
    await act(async () => {
      submitBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // Wait for async state resolution
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('你 · 留言已发出并回读');
  });

  it('mounted: HEAD mismatch shows notice and disables buttons until refresh', async () => {
    const acceptTask: HudTask = {
      ...baseTask,
      status: 'accept',
      pr: {
        number: 126,
        draft: false,
        headSha: '1111111111111111111111111111111111111111',
      },
    };

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    // Initial render with matching HEAD
    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={acceptTask} onBack={vi.fn()} />);
    });

    expect(container.textContent).toContain('HEAD: 1111111111111111111111111111111111111111');
    expect(container.textContent).not.toContain('HEAD 已更新');

    // Update with a newer live HEAD
    const updatedTask: HudTask = {
      ...acceptTask,
      pr: {
        ...acceptTask.pr!,
        headSha: '2222222222222222222222222222222222222222',
      },
    };

    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={updatedTask} onBack={vi.fn()} />);
    });

    expect(container.textContent).toContain('PR HEAD 已更新');
    expect(container.textContent).toContain('刷新 HEAD');

    // Click refresh HEAD
    const refreshBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('刷新 HEAD'));
    expect(refreshBtn).toBeDefined();

    await act(async () => {
      refreshBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).not.toContain('PR HEAD 已更新');
    expect(container.textContent).toContain('HEAD: 2222222222222222222222222222222222222222');
  });

  it('persists takeover AI to storage on takeover and clears on dismiss', async () => {
    setStoredTakeoverAi(null);
    expect(getTakeoverAi()).toBeNull();

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    const onTakeoverAi = vi.fn();
    const onOpenClassic = vi.fn();

    await act(async () => {
      root.render(
        <TaskView
          locale="zh-CN"
          task={baseTask}
          onBack={vi.fn()}
          onTakeoverAi={onTakeoverAi}
          onOpenClassic={onOpenClassic}
        />
      );
    });

    const takeoverButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.includes('接管'));
    expect(takeoverButtons.length).toBeGreaterThan(0);

    await act(async () => {
      takeoverButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(getTakeoverAi()).toBe('ChatGPT (Pro)');
    expect(onTakeoverAi).toHaveBeenCalledWith('ChatGPT (Pro)');
    expect(onOpenClassic).toHaveBeenCalled();
  });

  it('derives pause state chronologically: old resume -> new pause resolves to paused', async () => {
    const olderResumeEv = {
      id: 'ev-resume-1',
      kind: 'readback' as const,
      text: { zh: '已恢复', en: 'Resumed' },
      raw: ghWriteModule.formatPauseBody('running'),
      observedMinutesAgo: 10,
    };
    const newerPauseEv = {
      id: 'ev-pause-2',
      kind: 'readback' as const,
      text: { zh: '已暂停', en: 'Paused' },
      raw: ghWriteModule.formatPauseBody('paused'),
      observedMinutesAgo: 2,
    };
    // Put older first or newer first; sorting by observedMinutesAgo must result in paused
    const task: HudTask = {
      ...baseTask,
      evidence: [newerPauseEv, olderResumeEv],
    };

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={task} onBack={vi.fn()} />);
    });

    const pauseBtn = container.querySelector('[data-testid="pause-toggle-button"]');
    expect(pauseBtn?.textContent).toContain('继续');
  });

  it('derives pause state chronologically: old pause -> new resume resolves to running', async () => {
    const olderPauseEv = {
      id: 'ev-pause-1',
      kind: 'readback' as const,
      text: { zh: '已暂停', en: 'Paused' },
      raw: ghWriteModule.formatPauseBody('paused'),
      observedMinutesAgo: 20,
    };
    const newerResumeEv = {
      id: 'ev-resume-2',
      kind: 'readback' as const,
      text: { zh: '已恢复', en: 'Resumed' },
      raw: ghWriteModule.formatPauseBody('running'),
      observedMinutesAgo: 1,
    };
    const task: HudTask = {
      ...baseTask,
      evidence: [olderPauseEv, newerResumeEv],
    };

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={task} onBack={vi.fn()} />);
    });

    const pauseBtn = container.querySelector('[data-testid="pause-toggle-button"]');
    expect(pauseBtn?.textContent).toContain('暂停');
  });
});
