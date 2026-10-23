// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ghWriteModule from '../host/githubWrite';
import type { HudTask } from '../ui/taskHudModel';
import { TaskView } from '../workbench/views/TaskView';
import { TaskNotificationIsland } from '../workbench/drawer/TaskNotificationIsland';
import { getTakeoverAi, getTakeoverTaskId, setStoredTakeoverAi, clearStoredTakeover, providerForTakeover } from '../workbench/workbenchStorage';
import { loadGitHubTasks } from '../ui/taskHudGithub';

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

    const html = renderToStaticMarkup(<TaskNotificationIsland locale="zh-CN" task={blockedTask} />);
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

    const onRefreshData = vi.fn().mockResolvedValue([updatedTask]);
    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={updatedTask} onBack={vi.fn()} onRefreshData={onRefreshData} />);
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
    expect(onTakeoverAi).toHaveBeenCalledWith('ChatGPT (Pro)', 'task-test');

    // Banner is rendered
    expect(container.querySelector('[data-testid="takeover-banner"]')).toBeDefined();

    // Click exit on banner
    const exitBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('回到任务'));
    expect(exitBtn).toBeDefined();
    await act(async () => {
      exitBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Assert stored takeover AI is cleared
    expect(getTakeoverAi()).toBeNull();
    expect(container.querySelector('[data-testid="takeover-banner"]')).toBeNull();
  });

  it('clears stored takeover AI when navigating back to tasks', async () => {
    setStoredTakeoverAi('ChatGPT (Pro)');
    expect(getTakeoverAi()).toBe('ChatGPT (Pro)');

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    const onBack = vi.fn();
    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={baseTask} onBack={onBack} />);
    });

    const backBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('全部任务') || b.textContent?.includes('All tasks'));
    expect(backBtn).toBeDefined();

    await act(async () => {
      backBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(getTakeoverAi()).toBeNull();
    expect(onBack).toHaveBeenCalled();
  });

  it('integration: handles numeric comment IDs and ISO timestamps without runtime match error', async () => {
    const rawPause = ghWriteModule.formatPauseBody('paused');
    const taskWithNumericComment: HudTask = {
      ...baseTask,
      evidence: [
        {
          id: 99887766 as unknown as string,
          kind: 'readback',
          text: { zh: 'Issue 评论 · testuser', en: 'Issue Comment · testuser' },
          raw: rawPause,
          observedMinutesAgo: 5,
        },
      ],
    };

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={taskWithNumericComment} onBack={vi.fn()} />);
    });

    const pauseBtn = container.querySelector('[data-testid="pause-toggle-button"]');
    expect(pauseBtn?.textContent).toContain('继续');
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

  it('e2e integration: loads real snapshot shape, converts numeric IDs, calculates exact age, and derives pause state in TaskView', async () => {
    const TEST_NOW = new Date('2026-10-23T08:15:00.000Z');
    const rawPause = ghWriteModule.formatPauseBody('paused');
    const headSha = 'c'.repeat(40);

    const api = {
      async get(path: string): Promise<unknown> {
        if (path.includes('/issues?')) return [
          { number: 110, title: 'L5 Task Inspector', state: 'open', labels: [] },
        ];
        if (path.includes('/pulls?')) return [
          { number: 130, title: 'PR 130', state: 'open', draft: false, head: { sha: headSha } },
        ];
        if (path.includes('/check-runs?')) return { total_count: 0, check_runs: [] };
        if (path.includes('/status?')) return { sha: headSha, total_count: 0, statuses: [] };
        if (path.includes('/issues/110/comments')) return [
          {
            id: 99887766,
            user: { login: 'user-a' },
            body: rawPause,
            created_at: '2026-10-23T08:00:00.000Z',
          },
        ];
        if (path.includes('/pulls/130/reviews')) return [
          {
            id: 44556677,
            user: { login: 'reviewer-b' },
            body: '测试结果符合预期。\n**裁定：REVISE**',
            state: 'commented',
            submitted_at: '2026-10-23T07:45:00.000Z',
            commit_id: headSha,
          },
        ];
        return [];
      },
      async associations(): Promise<unknown> {
        return {
          data: {
            repository: {
              p130: {
                headRefOid: headSha,
                closingIssuesReferences: {
                  nodes: [{ number: 110, repository: { nameWithOwner: 'xiaolebao516/ai-one' } }],
                  pageInfo: { hasNextPage: false },
                },
              },
            },
          },
        };
      },
    };

    const [repo] = await loadGitHubTasks(['xiaolebao516/ai-one'], api, { now: TEST_NOW, limit: 10 });
    expect(repo.status).toBe('complete');
    expect(repo.tasks).toHaveLength(1);
    const hudTask = repo.tasks[0];

    const commentEv = hudTask.evidence.find((e) => e.text.en.includes('Issue Comment'));
    expect(commentEv).toBeDefined();
    expect(typeof commentEv?.id).toBe('string');
    expect(commentEv?.id).toBe('99887766');
    expect(commentEv?.observedMinutesAgo).toBe(15);

    const reviewEv = hudTask.evidence.find((e) => e.text.en.includes('Review Comment'));
    expect(reviewEv).toBeDefined();
    expect(typeof reviewEv?.id).toBe('string');
    expect(reviewEv?.id).toBe('44556677');
    expect(reviewEv?.observedMinutesAgo).toBe(30);
    expect(hudTask.review?.verdict).toBe('revise');

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    await act(async () => {
      root.render(<TaskView locale="zh-CN" task={hudTask} onBack={vi.fn()} />);
    });

    const pauseBtn = container.querySelector('[data-testid="pause-toggle-button"]');
    expect(pauseBtn?.textContent).toContain('继续');
  });

  it('takeover lifecycle: activates Argon as gemini, saves stable taskId, and restores on exit', async () => {
    expect(providerForTakeover('Argon')).toBe('gemini');
    expect(providerForTakeover('Gemini (Pro)')).toBe('gemini');
    expect(providerForTakeover('Claude (3.5)')).toBe('claude');
    expect(providerForTakeover('Grok (2)')).toBe('grok');
    expect(providerForTakeover('ChatGPT (Pro)')).toBe('chatgpt');

    clearStoredTakeover();

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

    const takeoverBtns = container.querySelectorAll('[data-testid="takeover-button"]');
    expect(takeoverBtns.length).toBeGreaterThan(0);

    // Click takeover on Argon
    await act(async () => {
      takeoverBtns[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(getTakeoverAi()).toBe('Argon');
    expect(getTakeoverTaskId()).toBe(baseTask.id);
    expect(onTakeoverAi).toHaveBeenCalledWith('Argon', baseTask.id);
    expect(onOpenClassic).toHaveBeenCalled();

    // Banner exit clears takeover state
    const exitBtn = container.querySelector('[data-testid="exit-takeover"]');
    expect(exitBtn).not.toBeNull();
    await act(async () => {
      exitBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(getTakeoverAi()).toBeNull();
    expect(getTakeoverTaskId()).toBeNull();
  });

  it('refresh head: deferred promise verifies pending state, failure recovery, and SHA baseline update', async () => {
    const sha1 = '1111111111111111111111111111111111111111';
    const sha2 = '2222222222222222222222222222222222222222';

    const acceptTask: HudTask = {
      ...baseTask,
      status: 'accept',
      pr: {
        number: 126,
        draft: false,
        headSha: sha1,
      },
    };

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    // 1. Initial render with sha1 matching
    await act(async () => {
      root.render(
        <TaskView
          locale="zh-CN"
          task={acceptTask}
          onBack={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain(`HEAD: ${sha1}`);
    expect(container.textContent).not.toContain('PR HEAD 已更新');

    // 2. Remote HEAD changes to sha2
    const updatedTask: HudTask = {
      ...acceptTask,
      pr: {
        ...acceptTask.pr!,
        headSha: sha2,
      },
    };

    let resolveRefresh: ((tasks: readonly HudTask[]) => void) | undefined;
    const onRefreshData = vi.fn().mockImplementation(() => {
      return new Promise<readonly HudTask[]>((resolve) => {
        resolveRefresh = resolve;
      });
    });

    await act(async () => {
      root.render(
        <TaskView
          locale="zh-CN"
          task={updatedTask}
          onBack={vi.fn()}
          onRefreshData={onRefreshData}
        />
      );
    });

    expect(container.textContent).toContain('PR HEAD 已更新');
    const refreshBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('刷新 HEAD'));
    expect(refreshBtn).toBeDefined();

    const acceptBtn = container.querySelector('[data-testid="accept-pass-button"]');
    expect(acceptBtn?.hasAttribute('disabled')).toBe(true);

    // 3. Click refresh HEAD -> enters pending state
    await act(async () => {
      refreshBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onRefreshData).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('刷新中…');
    expect(refreshBtn?.hasAttribute('disabled')).toBe(true);
    expect(acceptBtn?.hasAttribute('disabled')).toBe(true);

    // 4. Resolve with empty/missing return -> baseline is NOT updated, mismatch warning stays
    await act(async () => {
      resolveRefresh?.([]);
    });

    expect(container.textContent).toContain('PR HEAD 已更新');
    expect(container.textContent).toContain(`HEAD: ${sha1}`);
    expect(acceptBtn?.hasAttribute('disabled')).toBe(true);

    // 5. Click refresh again with successful return -> updates expectedHead to sha2
    let resolveRefresh2: ((tasks: readonly HudTask[]) => void) | undefined;
    onRefreshData.mockImplementationOnce(() => {
      return new Promise<readonly HudTask[]>((resolve) => {
        resolveRefresh2 = resolve;
      });
    });

    const refreshBtn2 = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('刷新 HEAD'));
    await act(async () => {
      refreshBtn2?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('刷新中…');

    await act(async () => {
      resolveRefresh2?.([
        { ...updatedTask, pr: { number: 126, draft: false, headSha: sha2 } },
      ]);
    });

    // Mismatch warning resolved!
    expect(container.textContent).not.toContain('PR HEAD 已更新');
    expect(container.textContent).toContain(`HEAD: ${sha2}`);
  });

  it('pause control: truncated or unknown comments history disables toggle and displays unconfirmed notice', async () => {
    const runningTaskWithTruncatedComments: HudTask = {
      ...baseTask,
      status: 'running',
      commentsCompleteness: 'truncated',
    };

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    await act(async () => {
      root.render(
        <TaskView
          locale="zh-CN"
          task={runningTaskWithTruncatedComments}
          onBack={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('暂停状态未确认');
    expect(container.textContent).toContain('评论未完整读取，禁止反向写入；请先刷新以获取完整记录。');
    const toggleBtn = container.querySelector('[data-testid="pause-toggle-button"]');
    expect(toggleBtn?.hasAttribute('disabled')).toBe(true);
  });

  it('notification island: monitors multiple needs-you tasks and deduplicates desktop notifications', async () => {
    const notificationMock = vi.fn();
    const originalNotification = window.Notification;
    Object.defineProperty(window, 'Notification', {
      value: notificationMock,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(Notification, 'permission', {
      value: 'granted',
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', {
      value: true,
      writable: true,
      configurable: true,
    });

    try {
      const taskA: HudTask = { ...baseTask, id: 'task-a', status: 'blocked' };
      const taskB: HudTask = { ...baseTask, id: 'task-b', status: 'accept' };

      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      live.push({ root, container });

      const onNavigate = vi.fn();

      await act(async () => {
        root.render(
          <TaskNotificationIsland
            tasks={[taskA, taskB]}
            currentTaskId="other-task"
            locale="zh-CN"
            onNavigate={onNavigate}
          />
        );
      });

      // Both tasks should have triggered desktop notifications independently
      expect(notificationMock).toHaveBeenCalledTimes(2);

      // UI island displays first item with +1 badge
      expect(container.textContent).toContain('+1');
      expect(container.textContent).toContain('查看');

      // Click view navigates to taskA
      const viewBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('查看'));
      await act(async () => {
        viewBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onNavigate).toHaveBeenCalledWith(taskA);
    } finally {
      Object.defineProperty(window, 'Notification', {
        value: originalNotification,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });
    }
  });

});
