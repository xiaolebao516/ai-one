import { describe, expect, it } from 'vitest';
import { TASK_HUD_MOCK_TASKS } from '../ui/taskHudMockData';
import type { HudTask, TaskStatus } from '../ui/taskHudModel';
import type { GitHubRepoTasks } from '../ui/taskHudGithub';
import { dataHealth, observedAt, repoNotices } from '../workbench/useWorkbenchData';
import {
  activeTasks,
  filterCommands,
  filterTasks,
  groupByRepo,
  headline,
  navViewFor,
  nextTheme,
  normalizeRepo,
  resolveRoute,
  resolveTheme,
  shortcutFor,
  type PaletteCommand,
} from '../workbench/workbenchModel';
import { DEFAULT_PREFS, loadPrefs, loadUiRoot, savePrefs, saveUiRoot } from '../workbench/workbenchStorage';

function task(id: string, status: TaskStatus, repo = 'o/a'): HudTask {
  return {
    id,
    dataSource: 'mock',
    repo,
    title: { en: id, zh: id },
    status,
    stages: [],
    summary: { en: '', zh: '' },
    evidence: [],
  };
}

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('workbench navigation', () => {
  it('maps Ctrl/Cmd+K to the palette and Ctrl/Cmd+1..5 to the sidebar views in order', () => {
    expect(shortcutFor(key('k', { ctrlKey: true }))).toEqual({ kind: 'palette' });
    expect(shortcutFor(key('K', { metaKey: true }))).toEqual({ kind: 'palette' });
    expect(shortcutFor(key('1', { ctrlKey: true }))).toEqual({ kind: 'view', view: 'home' });
    expect(shortcutFor(key('5', { ctrlKey: true }))).toEqual({ kind: 'view', view: 'resources' });
    expect(shortcutFor(key('6', { ctrlKey: true }))).toBeUndefined();
    expect(shortcutFor(key('k'))).toBeUndefined();
    expect(shortcutFor(key('k', { ctrlKey: true, shiftKey: true }))).toBeUndefined();
    expect(shortcutFor(key('Escape'))).toEqual({ kind: 'escape' });
  });

  it('lights up Tasks for a task page and falls back to the list when the task is gone', () => {
    const tasks = [task('a', 'running')];
    expect(navViewFor({ view: 'task', taskId: 'a' })).toBe('tasks');
    expect(resolveRoute({ view: 'task', taskId: 'a' }, tasks)).toEqual({ view: 'task', taskId: 'a' });
    expect(resolveRoute({ view: 'task', taskId: 'gone' }, tasks)).toEqual({ view: 'tasks' });
    expect(resolveRoute({ view: 'home' }, [])).toEqual({ view: 'home' });
  });
});

describe('repositories', () => {
  it('accepts owner/repo and github.com links and refuses everything else', () => {
    expect(normalizeRepo(' xiaolebao516/ai-one ')).toBe('xiaolebao516/ai-one');
    expect(normalizeRepo('https://github.com/xiaolebao516/ai-one/pull/56')).toBe('xiaolebao516/ai-one');
    expect(normalizeRepo('git@github.com:o/r.git')).toBeUndefined();
    expect(normalizeRepo('o/r.git')).toBe('o/r');
    expect(normalizeRepo('just-a-name')).toBeUndefined();
    expect(normalizeRepo('o/..')).toBeUndefined();
    expect(normalizeRepo('-bad/r')).toBeUndefined();
  });
});

describe('task grouping and headline', () => {
  const tasks = [task('run', 'running', 'o/a'), task('acc', 'accept', 'o/b'), task('dec', 'decide', 'o/a'), task('done', 'done', 'o/b'), task('blk', 'blocked', 'o/a')];

  it('groups by repository in first-seen order', () => {
    expect(groupByRepo(tasks).map((group) => [group.repo, group.tasks.map((t) => t.id)])).toEqual([
      ['o/a', ['run', 'dec', 'blk']],
      ['o/b', ['acc', 'done']],
    ]);
  });

  it('lists needs-you first (decide, blocked, accept) and leaves done out of active work', () => {
    expect(activeTasks(tasks).map((t) => t.id)).toEqual(['dec', 'blk', 'acc', 'run']);
  });

  it('filters the list', () => {
    expect(filterTasks(tasks, 'all')).toHaveLength(5);
    expect(filterTasks(tasks, 'active').map((t) => t.id)).toEqual(['run']);
    expect(filterTasks(tasks, 'needsYou').map((t) => t.id)).toEqual(['dec', 'blk', 'acc']);
    expect(filterTasks(tasks, 'done').map((t) => t.id)).toEqual(['done']);
  });

  it('leads with whether the user is needed', () => {
    expect(headline([])).toEqual({ kind: 'empty', inProgress: 0, needsYou: 0 });
    expect(headline([task('d', 'done')]).kind).toBe('quiet');
    expect(headline([task('r', 'running')])).toEqual({ kind: 'moving', inProgress: 1, needsYou: 0 });
    expect(headline(tasks)).toEqual({ kind: 'waiting', inProgress: 1, needsYou: 3 });
  });

  it('works on the shipped demo data', () => {
    expect(headline(TASK_HUD_MOCK_TASKS).kind).toBe('waiting');
  });
});

describe('command palette', () => {
  const commands: PaletteCommand[] = [
    { id: 'a', label: 'Go to Tasks', keywords: 'tasks', action: { kind: 'go', route: { view: 'tasks' } } },
    { id: 'b', label: 'Read from GitHub', hint: 'source', keywords: 'github', action: { kind: 'source', source: 'github' } },
  ];

  it('matches every term case-insensitively across label, hint and keywords', () => {
    expect(filterCommands(commands, '').map((c) => c.id)).toEqual(['a', 'b']);
    expect(filterCommands(commands, 'GIT').map((c) => c.id)).toEqual(['b']);
    expect(filterCommands(commands, 'read source').map((c) => c.id)).toEqual(['b']);
    expect(filterCommands(commands, 'tasks github')).toEqual([]);
  });
});

describe('theme', () => {
  it('cycles system → dark → light and resolves system from the OS', () => {
    expect(nextTheme('system')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('system');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });
});

describe('GitHub read results', () => {
  const ok = (repo: string, observed: string, more: 'no' | 'yes' = 'no'): GitHubRepoTasks => ({
    repo,
    tasks: [],
    status: 'complete',
    errors: [],
    pagination: { issues: { page: 1, limit: 20, returned: 0, more, earlierPagesOmitted: false, source: null } } as unknown as GitHubRepoTasks['pagination'],
    observedAt: observed,
  });
  const failed = (repo: string, observed: string): GitHubRepoTasks => ({
    repo,
    tasks: [],
    status: 'error',
    errors: [{ url: '', observedAt: observed, message: 'gh not logged in' }],
    pagination: {},
    observedAt: observed,
  });

  it('turns errors, partial reads and more pages into notices', () => {
    expect(repoNotices([failed('o/a', 't'), { ...ok('o/b', 't'), status: 'partial' }, ok('o/c', 't', 'yes')])).toEqual([
      { kind: 'error', repo: 'o/a', message: 'gh not logged in' },
      { kind: 'partial', repo: 'o/b' },
      { kind: 'more', repo: 'o/c' },
    ]);
  });

  it('never reports a failed read as an observation time', () => {
    expect(observedAt([failed('o/a', '2026-10-22T12:00:00Z')])).toBeUndefined();
    expect(observedAt([ok('o/a', '2026-10-22T11:00:00Z'), failed('o/b', '2026-10-22T12:00:00Z')])).toBe('2026-10-22T11:00:00Z');
  });

  it('only lets an empty list mean "nothing to do" after a successful read', () => {
    expect(dataHealth('demo', { loading: false, results: [] })).toBe('demo');
    expect(dataHealth('github', { loading: true, results: [] })).toBe('loading');
    expect(dataHealth('github', { loading: false, results: [failed('o/a', 't')] })).toBe('failed');
    expect(dataHealth('github', { loading: true, results: [failed('o/a', 't')] })).toBe('loading');
    expect(dataHealth('github', { loading: false, results: [failed('o/a', 't'), ok('o/b', 't')] })).toBe('ok');
  });
});

describe('workbench storage', () => {
  function memory(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
  }
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };

  it('defaults to the workbench and remembers the classic choice', () => {
    const store = memory();
    expect(loadUiRoot(store)).toBe('workbench');
    saveUiRoot('classic', store);
    expect(loadUiRoot(store)).toBe('classic');
    expect(loadUiRoot(throwing)).toBe('workbench');
    expect(() => saveUiRoot('classic', throwing)).not.toThrow();
  });

  it('falls back to defaults on missing, corrupt or hostile prefs', () => {
    expect(loadPrefs(memory())).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(memory({ 'ai-one.workbench.prefs': '{nope' }))).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(throwing)).toEqual(DEFAULT_PREFS);
    const loaded = loadPrefs(
      memory({ 'ai-one.workbench.prefs': JSON.stringify({ source: 'github', theme: 'dark', repos: ['o/a', 'o/a', 'bad', 3, 'https://github.com/o/b'] }) }),
    );
    expect(loaded).toEqual({ source: 'github', theme: 'dark', repos: ['o/a', 'o/b'] });
    expect(loadPrefs(memory({ 'ai-one.workbench.prefs': JSON.stringify({ source: 'x', repos: [] }) }))).toEqual(DEFAULT_PREFS);
  });

  it('round-trips prefs', () => {
    const store = memory();
    savePrefs({ source: 'github', theme: 'light', repos: ['o/a'] }, store);
    expect(loadPrefs(store)).toEqual({ source: 'github', theme: 'light', repos: ['o/a'] });
  });
});
