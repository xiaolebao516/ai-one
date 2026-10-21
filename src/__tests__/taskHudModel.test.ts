import { describe, expect, it } from 'vitest';
import {
  ALL,
  STATUS_TONE,
  TASK_STATUSES,
  effectiveCi,
  escapeAction,
  filterTasks,
  hudReducer,
  initialHudState,
  needsAttention,
  needsYouTasks,
  repoList,
  reviewIsCurrent,
  selectedTask,
  summarize,
  type HudTask,
} from '../ui/taskHudModel';
import { TASK_HUD_MOCK_TASKS } from '../ui/taskHudMockData';
import { taskHudText } from '../ui/taskHudText';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

function task(overrides: Partial<HudTask>): HudTask {
  return {
    id: 'x',
    dataSource: 'mock',
    repo: 'demo/x',
    title: { en: 'x', 'zh-TW': 'x' },
    status: 'running',
    stages: [],
    summary: { en: 's', 'zh-TW': 's' },
    evidence: [],
    ...overrides,
  };
}

describe('CI is bound to the current HEAD', () => {
  it('only reports a CI result for the exact HEAD it was read on', () => {
    expect(effectiveCi(task({}))).toEqual({ state: 'unknown', reason: 'no-pr' });
    expect(effectiveCi(task({ pr: { number: 1, draft: true } }))).toEqual({ state: 'unknown', reason: 'no-head' });
    expect(effectiveCi(task({ pr: { number: 1, draft: true, headSha: HEAD } }))).toEqual({ state: 'unknown', reason: 'no-ci', headSha: HEAD });
    expect(effectiveCi(task({ pr: { number: 1, draft: true, headSha: HEAD }, ci: { state: 'success', headSha: OTHER } }))).toEqual({
      state: 'unknown',
      reason: 'head-mismatch',
      headSha: HEAD,
    });
    expect(effectiveCi(task({ pr: { number: 1, draft: false, headSha: HEAD }, ci: { state: 'failure', headSha: HEAD } }))).toEqual({ state: 'failure', headSha: HEAD });
  });

  it('treats a review on another HEAD as stale', () => {
    const pr = { number: 1, draft: false, headSha: HEAD };
    expect(reviewIsCurrent(task({ pr, review: { verdict: 'pass', headSha: HEAD } }))).toBe(true);
    expect(reviewIsCurrent(task({ pr, review: { verdict: 'pass', headSha: OTHER } }))).toBe(false);
    expect(reviewIsCurrent(task({ pr, review: { verdict: 'none' } }))).toBe(false);
  });

  it('flags failures and unreadable state, not a calm Draft with running CI', () => {
    expect(needsAttention(task({ status: 'unknown' }))).toBe(true);
    expect(needsAttention(task({ pr: { number: 1, draft: true, headSha: HEAD }, ci: { state: 'running', headSha: HEAD } }))).toBe(false);
    expect(needsAttention(task({ pr: { number: 1, draft: true } }))).toBe(true);
    expect(needsAttention(task({ status: 'done', pr: { number: 1, draft: false } }))).toBe(false);
  });
});

describe('demo data summary', () => {
  it('counts the seeded tasks into overlapping groups', () => {
    expect(summarize(TASK_HUD_MOCK_TASKS)).toEqual({ total: 9, inProgress: 4, needsYou: 3, attention: 4 });
    expect(summarize([])).toEqual({ total: 0, inProgress: 0, needsYou: 0, attention: 0 });
  });

  it('orders "needs you" as decision, blocker, acceptance', () => {
    expect(needsYouTasks(TASK_HUD_MOCK_TASKS).map((item) => item.status)).toEqual(['decide', 'blocked', 'accept']);
  });

  it('filters by repository and status group', () => {
    expect(repoList(TASK_HUD_MOCK_TASKS)).toEqual(['demo/home-lab', 'demo/notes-sync', 'demo/orbit-app']);
    expect(filterTasks(TASK_HUD_MOCK_TASKS, 'demo/home-lab', ALL).map((item) => item.id)).toEqual(['home-7', 'home-8', 'home-3']);
    expect(filterTasks(TASK_HUD_MOCK_TASKS, ALL, 'needsYou')).toHaveLength(3);
    expect(filterTasks(TASK_HUD_MOCK_TASKS, 'demo/home-lab', 'needsYou')).toHaveLength(0);
    expect(filterTasks(TASK_HUD_MOCK_TASKS, ALL, 'attention').map((item) => item.id).sort()).toEqual(['home-7', 'home-8', 'notes-15', 'notes-20']);
    expect(filterTasks(TASK_HUD_MOCK_TASKS, ALL, 'done').map((item) => item.id)).toEqual(['home-3']);
  });

  it('covers every status the HUD can show, and maps each to a semantic tone', () => {
    const seeded = new Set(TASK_HUD_MOCK_TASKS.map((item) => item.status));
    for (const status of TASK_STATUSES) {
      expect(seeded.has(status), status).toBe(true);
      expect(STATUS_TONE[status]).toBeTruthy();
    }
  });
});

describe('demo data cannot pass for real GitHub data', () => {
  it('is tagged mock, uses fictional demo repositories and carries no links', () => {
    for (const item of TASK_HUD_MOCK_TASKS) {
      expect(item.dataSource).toBe('mock');
      expect(item.repo.startsWith('demo/')).toBe(true);
      expect(item.title.en && item.title['zh-TW']).toBeTruthy();
      expect(item.summary.en && item.summary['zh-TW']).toBeTruthy();
      if (item.pr?.headSha) expect(item.pr.headSha).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(JSON.stringify(TASK_HUD_MOCK_TASKS)).not.toMatch(/https?:|github\.com|xiaolebao516/);
  });

  it('labels mock read-backs and local runs as examples', () => {
    const zh = taskHudText('zh-TW');
    const en = taskHudText('en');
    expect(zh.evidence('readback', 'mock')).toBe('模擬已回讀（示例）');
    expect(en.evidence('readback', 'mock')).toBe('Simulated read-back (example)');
    expect(en.evidence('local', 'mock')).toContain('example');
    expect(en.evidence('readback', 'github')).toBe('Read back');
    expect(en.evidence('self', 'github')).toContain('not evidence');
    // Locales without HUD copy read English rather than an empty string.
    expect(taskHudText('ja').t('back')).toBe('Back to chat');
  });
});

describe('view state', () => {
  it('remembers where the detail view was opened from', () => {
    const fromList = hudReducer(hudReducer(initialHudState(), { type: 'list', status: 'needsYou' }), { type: 'open', id: 'orbit-39' });
    expect(fromList).toMatchObject({ view: 'detail', selectedId: 'orbit-39', backTo: 'list', status: 'needsYou' });
    expect(hudReducer(fromList, { type: 'back' })).toMatchObject({ view: 'list', selectedId: undefined, status: 'needsYou' });
    const fromOverview = hudReducer(initialHudState(), { type: 'open', id: 'orbit-45' });
    expect(hudReducer(fromOverview, { type: 'back' }).view).toBe('overview');
    expect(hudReducer(initialHudState(), { type: 'back' })).toEqual(initialHudState());
  });

  it('closes the detail before the HUD on Escape', () => {
    expect(escapeAction(initialHudState({ view: 'detail', selectedId: 'x' }))).toBe('back');
    expect(escapeAction(initialHudState({ view: 'list' }))).toBe('close');
    expect(escapeAction(initialHudState())).toBe('close');
  });

  it('drops the open task and filters when the data set changes', () => {
    const state = initialHudState({ view: 'detail', backTo: 'list', selectedId: 'orbit-42', repo: 'demo/orbit-app', status: 'needsYou' });
    expect(hudReducer(state, { type: 'scenario', scenario: 'empty' })).toEqual(initialHudState({ view: 'list', backTo: 'list', scenario: 'empty' }));
    expect(hudReducer(initialHudState({ repo: 'demo/x', status: 'done' }), { type: 'clearFilters' })).toMatchObject({ repo: ALL, status: ALL });
  });

  it('never guesses a task for a stale id', () => {
    expect(selectedTask(initialHudState({ selectedId: 'missing' }), TASK_HUD_MOCK_TASKS)).toBeUndefined();
    expect(selectedTask(initialHudState({ selectedId: 'home-3' }), TASK_HUD_MOCK_TASKS)?.repo).toBe('demo/home-lab');
  });
});
