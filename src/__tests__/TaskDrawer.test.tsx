// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HudTask } from '../ui/taskHudModel';
import { TaskDrawer } from '../workbench/drawer/TaskDrawer';

const mockTask: HudTask = {
  id: 'task-1',
  dataSource: 'github',
  repo: 'xiaolebao516/ai-one',
  issue: 110,
  title: { zh: '任务现场补全', en: 'Task live inspector' },
  status: 'running',
  stages: [],
  summary: { zh: '正在开发检查器抽屉', en: 'Developing inspector drawer' },
  pr: {
    number: 126,
    draft: false,
    headSha: '1111222233334444555566667777888899990000',
  },
  ci: {
    state: 'success',
    headSha: '1111222233334444555566667777888899990000',
    detail: { zh: '24 checks', en: '24 checks' },
  },
  review: {
    verdict: 'revise',
    headSha: '1111222233334444555566667777888899990000',
    by: { zh: 'GPT Pro', en: 'GPT Pro' },
  },
  evidence: [
    {
      id: 'ev-1',
      kind: 'readback',
      text: { zh: '独立审计意见已回读', en: 'Review feedback read back' },
      raw: '审查结论：REVISE',
    },
    {
      id: 'ev-2',
      kind: 'local',
      text: { zh: 'pnpm verify 通过', en: 'pnpm verify passed' },
    },
  ],
};

const live: { root: Root; container: HTMLElement }[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const { root } of live.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
});

describe('TaskDrawer static markup & rendering', () => {
  it('does not render when isOpen is false', () => {
    const html = renderToStaticMarkup(
      <TaskDrawer
        isOpen={false}
        onClose={vi.fn()}
        activeTab="dispatch"
        onTabChange={vi.fn()}
        task={mockTask}
        locale="zh-CN"
      />
    );
    expect(html).toBe('');
  });

  it('renders all four tabs and tab header when isOpen is true', () => {
    const html = renderToStaticMarkup(
      <TaskDrawer
        isOpen={true}
        onClose={vi.fn()}
        activeTab="dispatch"
        onTabChange={vi.fn()}
        task={mockTask}
        locale="zh-CN"
      />
    );
    expect(html).toContain('aria-label="任务检查器抽屉"');
    expect(html).toContain('派工单');
    expect(html).toContain('原始回复');
    expect(html).toContain('Diff');
    expect(html).toContain('测试');
  });

  it('renders Diff tab with PR files link and full HEAD SHA', () => {
    const html = renderToStaticMarkup(
      <TaskDrawer
        isOpen={true}
        onClose={vi.fn()}
        activeTab="diff"
        onTabChange={vi.fn()}
        task={mockTask}
        locale="zh-CN"
      />
    );
    expect(html).toContain('PR #126');
    expect(html).toContain('1111222233334444555566667777888899990000');
    expect(html).toContain('在 GitHub 打开 PR Files');
  });

  it('renders Tests tab with CI state and local execution evidence', () => {
    const html = renderToStaticMarkup(
      <TaskDrawer
        isOpen={true}
        onClose={vi.fn()}
        activeTab="tests"
        onTabChange={vi.fn()}
        task={mockTask}
        locale="zh-CN"
      />
    );
    expect(html).toContain('GitHub CI / Actions');
    expect(html).toContain('通过');
    expect(html).toContain('CC 本机运行');
    expect(html).toContain('pnpm verify 通过');
  });

  it('renders OriginalResponse tab with privacy disclaimer and read-back contents', () => {
    const html = renderToStaticMarkup(
      <TaskDrawer
        isOpen={true}
        onClose={vi.fn()}
        activeTab="response"
        onTabChange={vi.fn()}
        task={mockTask}
        locale="zh-CN"
      />
    );
    expect(html).toContain('不含 AI 网页对话正文');
    expect(html).toContain('GitHub 独立审计评论');
    expect(html).toContain('审查结论：REVISE');
  });
});

describe('TaskDrawer mounted interactions', () => {
  it('handles tab click and Escape key dismissal', async () => {
    const onClose = vi.fn();
    const onTabChange = vi.fn();

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    live.push({ root, container });

    await act(async () => {
      root.render(
        <TaskDrawer
          isOpen={true}
          onClose={onClose}
          activeTab="dispatch"
          onTabChange={onTabChange}
          task={mockTask}
          locale="zh-CN"
        />
      );
    });

    const diffButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Diff')
    );
    expect(diffButton).toBeDefined();

    await act(async () => {
      diffButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onTabChange).toHaveBeenCalledWith('diff');

    // Backdrop click
    const backdrop = container.querySelector('[data-testid="drawer-backdrop"]');
    expect(backdrop).toBeDefined();
    await act(async () => {
      backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Escape key
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
