import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubEmpty, GitHubPanel, TaskHud } from '../ui/TaskHud';
import { TaskHudEntryView, type TaskHudEntryViewProps } from '../ui/TaskHudEntry';
import type { GitHubRepoTasks } from '../ui/taskHudGithub';
import type { HudTask } from '../ui/taskHudModel';
import {
  DEFAULT_HUD_REPOS,
  errorMessages,
  getGitHubData,
  githubOverall,
  githubTasks,
  isValidRepoName,
  mayHaveMore,
  normalizePrefs,
  parseRepoInput,
  refreshGitHubData,
  resetGitHubData,
  type GitHubDataState,
} from '../ui/taskHudSource';
import { taskHudText } from '../ui/taskHudText';

afterEach(() => resetGitHubData());

const text = taskHudText('en');
const NOW = new Date('2026-10-22T08:00:00.000Z');

function task(id: string, status: HudTask['status']): HudTask {
  return { id, dataSource: 'github', repo: 'o/r', title: { en: id, zh: id }, status, stages: [], summary: { en: 's', zh: 's' }, evidence: [] };
}

function repoResult(repo: string, status: GitHubRepoTasks['status'], tasks: HudTask[] = [], more = false): GitHubRepoTasks {
  const entry = { page: 1, limit: 10, returned: tasks.length, more: more ? ('possible' as const) : ('no' as const), earlierPagesOmitted: false, source: { url: 'u', observedAt: NOW.toISOString() } };
  return {
    repo,
    tasks,
    status,
    errors: status === 'error' ? [{ url: 'u', observedAt: NOW.toISOString(), message: 'gh is not installed; install GitHub CLI and run gh auth login.' }] : [],
    pagination: status === 'error' ? {} : { issues: entry, pullRequests: entry },
    observedAt: NOW.toISOString(),
  };
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
}

describe('repository input', () => {
  it('accepts owner/repo and github.com URLs, rejects anything else', () => {
    expect(parseRepoInput(' xiaolebao516/ai-one ')).toBe('xiaolebao516/ai-one');
    expect(parseRepoInput('https://github.com/xiaolebao516/ai-one/pull/54')).toBe('xiaolebao516/ai-one');
    expect(parseRepoInput('github.com/o/r.git')).toBe('o/r');
    for (const bad of ['', 'ai-one', 'o/r/x', '-o/r', 'o/..', 'https://gitlab.com/o/r', 'o/r name']) {
      expect(parseRepoInput(bad), bad).toBeUndefined();
    }
    expect(isValidRepoName('o/.github')).toBe(true);
    expect(isValidRepoName('o/.')).toBe(false);
  });

  it('normalises stored preferences and falls back to demo with the default repository', () => {
    expect(normalizePrefs(undefined)).toEqual({ source: 'demo', repos: [...DEFAULT_HUD_REPOS] });
    expect(normalizePrefs({ source: 'github', repos: ['o/r', 'o/r', 'bad', 42] })).toEqual({ source: 'github', repos: ['o/r'] });
    expect(normalizePrefs({ source: 'live', repos: 'o/r' })).toEqual({ source: 'demo', repos: [...DEFAULT_HUD_REPOS] });
    expect(normalizePrefs({ repos: Array.from({ length: 12 }, (_, i) => `o/r${i}`) }).repos).toHaveLength(8);
  });
});

describe('GitHub snapshot store', () => {
  it('moves from loading to done with the loader results', async () => {
    let finish: (value: GitHubRepoTasks[]) => void = () => {};
    const loader = vi.fn(() => new Promise<GitHubRepoTasks[]>((resolve) => (finish = resolve)));
    const pending = refreshGitHubData(['o/r'], loader, () => NOW);
    expect(getGitHubData()).toMatchObject({ phase: 'loading', repos: ['o/r'] });
    finish([repoResult('o/r', 'complete', [task('a', 'running')])]);
    await pending;
    expect(getGitHubData()).toMatchObject({ phase: 'done', finishedAt: NOW.toISOString() });
    expect(githubTasks(getGitHubData()).map((item) => item.id)).toEqual(['a']);
    expect(loader).toHaveBeenCalledWith(['o/r']);
  });

  it('never lets a slower earlier read overwrite a newer one', async () => {
    const resolvers: Array<(value: GitHubRepoTasks[]) => void> = [];
    const loader = () => new Promise<GitHubRepoTasks[]>((resolve) => resolvers.push(resolve));
    const first = refreshGitHubData(['o/old'], loader);
    const second = refreshGitHubData(['o/new'], loader);
    resolvers[1]([repoResult('o/new', 'complete')]);
    await second;
    resolvers[0]([repoResult('o/old', 'complete')]);
    await first;
    expect(getGitHubData().results.map((result) => result.repo)).toEqual(['o/new']);
  });

  it('turns an unexpected loader failure into per-repository errors, not an empty list', async () => {
    await refreshGitHubData(['o/a', 'o/b'], () => Promise.reject(new Error('boom')), () => NOW);
    const state = getGitHubData();
    expect(state.results.map((result) => [result.repo, result.status])).toEqual([['o/a', 'error'], ['o/b', 'error']]);
    expect(githubOverall(state)).toBe('error');
    expect(JSON.stringify(state)).not.toContain('boom');
  });

  it('summarises mixed reads as partial and reports pagination and fixed messages', () => {
    const done = (results: GitHubRepoTasks[]): GitHubDataState => ({ phase: 'done', results, repos: results.map((result) => result.repo) });
    expect(githubOverall({ phase: 'idle', results: [], repos: [] })).toBe('none');
    expect(githubOverall(done([repoResult('o/a', 'complete')]))).toBe('complete');
    expect(githubOverall(done([repoResult('o/a', 'complete'), repoResult('o/b', 'error')]))).toBe('partial');
    expect(githubOverall(done([repoResult('o/a', 'error')]))).toBe('error');
    expect(mayHaveMore(repoResult('o/a', 'partial', [], true))).toBe(true);
    expect(mayHaveMore(repoResult('o/a', 'complete'))).toBe(false);
    // A failed read has no pagination knowledge; it must not claim "first page only".
    expect(mayHaveMore({ ...repoResult('o/a', 'error'), pagination: { issues: { page: 1, limit: 10, returned: null, more: 'unknown', earlierPagesOmitted: false, source: { url: 'u', observedAt: NOW.toISOString() } } } })).toBe(false);
    expect(errorMessages(repoResult('o/a', 'error'))).toEqual(['gh is not installed; install GitHub CLI and run gh auth login.']);
  });
});

describe('GitHub source UI', () => {
  const prefs = { source: 'github' as const, repos: ['xiaolebao516/ai-one'] };
  const done = (results: GitHubRepoTasks[]): GitHubDataState => ({ phase: 'done', results, repos: results.map((result) => result.repo), finishedAt: new Date(Date.now() - 3 * 60000).toISOString() });

  it('never shows a failed read as an empty task list', () => {
    const failed = visibleText(renderToStaticMarkup(<GitHubEmpty prefs={prefs} gh={done([repoResult('xiaolebao516/ai-one', 'error')])} text={text} onRefresh={() => {}} />));
    expect(failed).toContain('Could not read GitHub');
    expect(failed).toContain('This is not an empty task list');
    expect(failed).toContain('Refresh');
    const partial = renderToStaticMarkup(<GitHubEmpty prefs={prefs} gh={done([repoResult('xiaolebao516/ai-one', 'partial')])} text={text} onRefresh={() => {}} />);
    expect(partial).toContain('data-tone="unknown"');
    const empty = visibleText(renderToStaticMarkup(<GitHubEmpty prefs={prefs} gh={done([repoResult('xiaolebao516/ai-one', 'complete')])} text={text} onRefresh={() => {}} />));
    expect(empty).toContain('No open Issues or PRs');
  });

  it('shows loading, not-read and no-repository states distinctly', () => {
    expect(renderToStaticMarkup(<GitHubEmpty prefs={prefs} gh={{ phase: 'loading', results: [], repos: prefs.repos }} text={text} onRefresh={() => {}} />)).toContain('role="status"');
    expect(visibleText(renderToStaticMarkup(<GitHubEmpty prefs={prefs} gh={{ phase: 'idle', results: [], repos: [] }} text={text} onRefresh={() => {}} />))).toContain('Not read yet');
    expect(visibleText(renderToStaticMarkup(<GitHubEmpty prefs={{ source: 'github', repos: [] }} gh={{ phase: 'idle', results: [], repos: [] }} text={text} onRefresh={() => {}} />))).toContain('Add a repository');
  });

  it('lists each repository with its read status, task count, pagination note and fixed error message', () => {
    const html = renderToStaticMarkup(
      <GitHubPanel
        prefs={{ source: 'github', repos: ['xiaolebao516/ai-one', 'o/broken'] }}
        gh={done([repoResult('xiaolebao516/ai-one', 'partial', [task('a', 'review')], true), repoResult('o/broken', 'error')])}
        locale="en"
        text={text}
        onRefresh={() => {}}
      />,
    );
    const view = visibleText(html);
    expect(view).toContain('GitHub read-back · read-only');
    expect(view).toContain('read 3 min ago');
    expect(view).toContain('xiaolebao516/ai-one Partial 1 tasks Only the first page was read');
    expect(view).toContain('o/broken Failed 0 tasks gh is not installed');
    expect(html).toContain('aria-label="Remove o/broken"');
    expect(html).toContain('placeholder="owner/repo or GitHub URL"');
    expect(html).not.toContain('href=');
  });

  it('keeps the demo source as the default and hides the switch for fixed task lists', () => {
    const standard = renderToStaticMarkup(<TaskHud locale="en" onClose={() => {}} />);
    expect(standard).toContain('aria-label="Data source"');
    expect(standard).toMatch(/aria-checked="true"[^>]*>.*?Demo/);
    expect(renderToStaticMarkup(<TaskHud locale="en" onClose={() => {}} tasks={[task('x', 'running')]} />)).not.toContain('aria-label="Data source"');
  });
});

describe('chat toolbar entry by source', () => {
  const view = (props: TaskHudEntryViewProps) =>
    (TaskHudEntryView as unknown as { render: (p: TaskHudEntryViewProps, ref: null) => ReactElement }).render(props, null);

  it('shows "not read" instead of zero counts before GitHub was read', () => {
    const idle = renderToStaticMarkup(view({ locale: 'en', onOpen: () => {}, source: 'github' }));
    expect(idle).toContain('aria-label="Open the task HUD (GitHub, not read yet)"');
    expect(visibleText(idle)).toContain('not read');
    const loaded = renderToStaticMarkup(view({ locale: 'zh-TW', onOpen: () => {}, source: 'github', tasks: [task('a', 'review'), task('b', 'blocked')] }));
    expect(loaded).toContain('aria-label="打开任务 HUD（GitHub 回读）：1 个进行中，1 件需要你，0 个失败或未知"');
  });
});
