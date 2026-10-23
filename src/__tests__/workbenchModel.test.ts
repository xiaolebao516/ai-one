import { describe, expect, it } from 'vitest';
import { TASK_HUD_MOCK_TASKS } from '../ui/taskHudMockData';
import type { HudTask, TaskStatus } from '../ui/taskHudModel';
import type { GitHubRepoTasks } from '../ui/taskHudGithub';
import { categoryHealth, countLabel, dataHealth, isCountable, isExact, observedAt, repoNotices } from '../workbench/useWorkbenchData';
import {
  activeTasks,
  filterCommands,
  filterTasks,
  groupByRepo,
  headline,
  isEditableTarget,
  navViewFor,
  nextTheme,
  normalizeRepo,
  resolveRoute,
  resolveTheme,
  shortcutFor,
  type PaletteCommand,
} from '../workbench/workbenchModel';
import { DEFAULT_PREFS, loadPrefs, loadUiRoot, savePrefs, saveUiRoot, uiRootHref } from '../workbench/workbenchStorage';

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

  it('knows which targets are text the user is typing into', () => {
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'input' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
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
    expect(headline([])).toEqual({ kind: 'empty', inProgress: 0, needsYou: 0, unknown: 0 });
    expect(headline([task('d', 'done')]).kind).toBe('quiet');
    expect(headline([task('r', 'running')])).toEqual({ kind: 'moving', inProgress: 1, needsYou: 0, unknown: 0 });
    expect(headline(tasks)).toEqual({ kind: 'waiting', inProgress: 1, needsYou: 3, unknown: 0 });
  });

  it('never calls unreadable task states "nothing to do"', () => {
    expect(headline([task('u', 'unknown'), task('d', 'done')])).toEqual({ kind: 'unclear', inProgress: 0, needsYou: 0, unknown: 1 });
    expect(headline([task('u', 'unknown'), task('r', 'running')])).toEqual({ kind: 'moving', inProgress: 1, needsYou: 0, unknown: 1 });
    expect(headline([task('u', 'unknown'), task('a', 'accept')])).toEqual({ kind: 'waiting', inProgress: 0, needsYou: 1, unknown: 1 });
  });

  it('makes counts by state "at least" when some state is unreadable, but keeps the total exact', () => {
    const readable = [task('r', 'running')];
    const withUnknown = [task('r', 'running'), task('u', 'unknown')];
    expect(categoryHealth('complete', readable)).toBe('complete');
    expect(categoryHealth('complete', withUnknown)).toBe('partial');
    expect(categoryHealth('demo', withUnknown)).toBe('partial');
    expect(categoryHealth('loading', withUnknown)).toBe('loading');
    expect(categoryHealth('failed', [])).toBe('failed');
  });

  it('writes every count with one rule: exact, at least, or unknown', () => {
    expect([countLabel(3, 'demo'), countLabel(3, 'complete'), countLabel(3, 'partial'), countLabel(3, 'loading'), countLabel(3, 'failed')]).toEqual([
      '3',
      '3',
      '≥3',
      '?',
      '?',
    ]);
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

  it('only lets an empty list mean "nothing to do" after a complete, current read', () => {
    const mine = 'o/a';
    expect(dataHealth('demo', { loading: false, results: [] }, mine)).toBe('demo');
    expect(dataHealth('github', { loading: true, results: [] }, mine)).toBe('loading');
    // A finished read for another repository set is an old snapshot, not current facts.
    expect(dataHealth('github', { loading: false, reposKey: 'o/old', results: [ok('o/old', 't')] }, mine)).toBe('loading');
    // Refreshing the same set: still "loading" although the old results are kept.
    expect(dataHealth('github', { loading: true, reposKey: mine, results: [ok(mine, 't')] }, mine)).toBe('loading');
    expect(dataHealth('github', { loading: false, reposKey: mine, results: [failed(mine, 't')] }, mine)).toBe('failed');
    expect(dataHealth('github', { loading: false, reposKey: mine, results: [failed(mine, 't'), ok('o/b', 't')] }, mine)).toBe('partial');
    expect(dataHealth('github', { loading: false, reposKey: mine, results: [{ ...ok(mine, 't'), status: 'partial' }] }, mine)).toBe('partial');
    expect(dataHealth('github', { loading: false, reposKey: mine, results: [ok(mine, 't', 'yes')] }, mine)).toBe('partial');
    expect(dataHealth('github', { loading: false, reposKey: mine, results: [ok(mine, 't')] }, mine)).toBe('complete');
  });

  it('separates exact counts from "at least" counts', () => {
    expect([isExact('demo'), isExact('complete'), isExact('partial'), isExact('loading')]).toEqual([true, true, false, false]);
    expect([isCountable('partial'), isCountable('failed'), isCountable('loading')]).toEqual([true, false, false]);
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
    expect(loadUiRoot(store, '')).toBe('workbench');
    saveUiRoot('classic', store);
    expect(loadUiRoot(store, '')).toBe('classic');
    expect(loadUiRoot(throwing, '')).toBe('workbench');
    expect(() => saveUiRoot('classic', throwing)).not.toThrow();
  });

  it('switches through the URL, so it works when storage cannot be written', () => {
    const href = uiRootHref('http://localhost:1430/?x=1#top', 'classic');
    expect(href).toBe('http://localhost:1430/?x=1&ui=classic#top');
    expect(loadUiRoot(throwing, new URL(href).search)).toBe('classic');
    expect(loadUiRoot(memory({ 'ai-one.ui.root': 'classic' }), '?ui=workbench')).toBe('workbench');
    expect(loadUiRoot(memory(), '?ui=nonsense')).toBe('workbench');
  });

  it('falls back to defaults on missing, corrupt or hostile prefs', () => {
    expect(loadPrefs(memory())).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(memory({ 'ai-one.workbench.prefs': '{nope' }))).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(throwing)).toEqual(DEFAULT_PREFS);
    const loaded = loadPrefs(
      memory({ 'ai-one.workbench.prefs': JSON.stringify({ source: 'github', theme: 'dark', repos: ['o/a', 'o/a', 'bad', 3, 'https://github.com/o/b'] }) }),
    );
    expect(loaded).toEqual({ source: 'github', theme: 'dark', repos: ['o/a', 'o/b'], dispatchRepo: '' });
    expect(loadPrefs(memory({ 'ai-one.workbench.prefs': JSON.stringify({ source: 'x', repos: [] }) }))).toEqual(DEFAULT_PREFS);
  });

  it('reads legacy prefs and rejects an invalid dispatch repository path', () => {
    const legacy = loadPrefs(memory({ 'ai-one.workbench.prefs': JSON.stringify({ source: 'github', theme: 'dark', repos: ['o/a'] }) }));
    expect(legacy.dispatchRepo).toBe('');
    const invalid = loadPrefs(memory({ 'ai-one.workbench.prefs': JSON.stringify({ source: 'github', theme: 'dark', repos: ['o/a'], dispatchRepo: 'relative/repo' }) }));
    expect(invalid.dispatchRepo).toBe('');
  });

  it('round-trips prefs', () => {
    const store = memory();
    savePrefs({ source: 'github', theme: 'light', repos: ['o/a'], dispatchRepo: 'C:\\work\\repo' }, store);
    expect(loadPrefs(store)).toEqual({ source: 'github', theme: 'light', repos: ['o/a'], dispatchRepo: 'C:\\work\\repo' });
  });
});
