import { describe, expect, it, vi } from 'vitest';
import { buildFixTask, createFixTask, fixProgress, needsNewDecision } from '../workbench/acceptanceFix';
import type { AcceptanceItem, AcceptanceRecord } from '../workbench/userAcceptance';

const item: AcceptanceItem = { key: 'o/r:7:k', repo: 'o/r', issue: 7, title: '确认页面显示正常。', steps: '打开首页', expected: '出现卡片' };
const created = (over = {}) => ({ status: 'confirmed' as const, code: 'ok' as const, message: '已确认写入 GitHub',
  steps: [{ step: 'create_issue' as const, state: 'confirmed' as const }, { step: 'sub_issue' as const, state: 'confirmed' as const }],
  issueNumber: 99, url: 'https://github.com/o/r/issues/99', ...over });
const record = (fix: AcceptanceRecord['fix']): AcceptanceRecord => ({ key: item.key, repo: 'o/r', issue: 7, title: item.title, kind: 'feedback', sync: 'confirmed', fix });

describe('fix task from acceptance feedback', () => {
  it('builds a claimable Task carrying the user words, the original item and the parent', () => {
    const task = buildFixTask(item, '  按钮点不动 ');
    expect(task.title).toBe('[Task][P1] 验收反馈：按钮点不动');
    expect(task.body).toContain('Priority: P1');
    expect(task.body).toContain('Ready when: 立即');
    expect(task.body).toContain('Parent Spec: #7');
    expect(task.body).toContain('按钮点不动');
    expect(task.body).toContain('操作步骤：打开首页');
    expect(task.body).not.toContain('<!-- ai-one:');
  });
  it('creates the issue once with the original as parent and reports the number', async () => {
    const createIssue = vi.fn(async () => created());
    expect(await createFixTask({ createIssue }, item, '坏了')).toEqual({ sync: 'confirmed', issue: 99, url: 'https://github.com/o/r/issues/99' });
    expect(createIssue).toHaveBeenCalledExactlyOnceWith({ repo: 'o/r', title: expect.any(String), body: expect.any(String), parentSpec: 7 });
  });
  it('still counts a created Task when only the parent link failed', async () => {
    const result = created({ status: 'partial', code: 'sub_issue_failed', message: 'x',
      steps: [{ step: 'create_issue', state: 'confirmed' }, { step: 'sub_issue', state: 'failed' }] });
    expect((await createFixTask({ createIssue: async () => result }, item, '坏了')).sync).toBe('confirmed');
  });
  it('keeps the Task number when create_issue is confirmed but the parent link is unconfirmed', async () => {
    const result = created({ status: 'unconfirmed', code: 'unconfirmed', message: 'x',
      steps: [{ step: 'create_issue', state: 'confirmed' }, { step: 'sub_issue', state: 'unconfirmed' }] });
    expect(await createFixTask({ createIssue: async () => result }, item, '坏了')).toMatchObject({ sync: 'confirmed', issue: 99 });
  });
  it('separates definite failure (retryable) from unknown results (never retried)', async () => {
    const failed = { status: 'failed' as const, code: 'github_failed' as const, message: 'x', steps: [] };
    expect((await createFixTask({ createIssue: async () => failed }, item, '坏了')).sync).toBe('failed');
    expect((await createFixTask({ createIssue: async () => ({ ...failed, status: 'unconfirmed' as const, code: 'unconfirmed' as const }) }, item, '坏了')).sync).toBe('unconfirmed');
    expect((await createFixTask({ createIssue: async () => { throw new Error('lost'); } }, item, '坏了')).sync).toBe('unconfirmed');
  });
  it('does not write when the card is no longer current', async () => {
    const createIssue = vi.fn(async () => created());
    expect((await createFixTask({ createIssue }, item, '坏了', () => false)).sync).toBe('failed');
    expect(createIssue).not.toHaveBeenCalled();
  });
  it('derives plain progress from the Task state on GitHub', () => {
    const fix = { sync: 'confirmed' as const, issue: 99 };
    const key = 'o/r#99';
    expect(fixProgress(record(fix), {})).toBe('queued');
    expect(fixProgress(record(fix), { [key]: { state: 'open' } })).toBe('working');
    expect(fixProgress(record(fix), { [key]: { state: 'closed', reason: 'completed' } })).toBe('done');
    expect(fixProgress(record(fix), { [key]: { state: 'closed', reason: 'not_planned' } })).toBe('dropped');
    expect(fixProgress(record({ sync: 'ready' }), {})).toBe('notStarted');
    expect(fixProgress(record({ sync: 'pending' }), {})).toBe('creating');
    expect(fixProgress(record({ sync: 'failed' }), {})).toBe('failed');
    expect(fixProgress(record({ sync: 'unconfirmed' }), {})).toBe('unknown');
    expect(fixProgress(record(undefined), {})).toBeUndefined();
    expect(needsNewDecision('done')).toBe(true);
    expect(needsNewDecision('working')).toBe(false);
  });
});
