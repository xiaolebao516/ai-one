import { describe, expect, it } from 'vitest';
import { parseDispatchSnapshot } from './parse';

const task = 'task_20261022_120000_gpt-pro-consult';
const session = { id: 'sess_20261022_120000_demo', task_id: task, status: 'done', created_at: '2026-10-22T12:00:00Z', last_used_at: '2026-10-22T12:01:00Z' };
const snapshot = (sessions: unknown[] = [session], receipts: unknown[] = []) => ({ sessions, receipts, slots: [], skipped: 0, truncated: false });

describe('dispatch metadata parser', () => {
  it('maps completion, running, timeout and mismatch without guessing unknown states', () => {
    for (const [status, code, expected] of [['done', '', 'completed'], ['running', '', 'running'], ['blocked', 'send_timeout', 'timeout'], ['blocked', 'request_mismatch', 'request_mismatch'], ['blocked', 'new_code', 'blocked'], ['surprise', '', 'unknown'], ['toString', '', 'unknown'], ['__proto__', '', 'unknown']]) {
      expect(parseDispatchSnapshot(snapshot([{ ...session, status, blocker_code: code }])).events[0].status).toBe(expected);
    }
  });
  it('joins request metadata by task id and represents recovered completion separately', () => {
    const recovered = 'task_20261022_120200_gpt-pro-consult-recovered';
    const model = parseDispatchSnapshot(snapshot([session], [{ kind: 'consult_answer_saved', task_id: task, request_id: 'a'.repeat(32) }, { kind: 'task_completed', task_id: recovered, created_at: '2026-10-22T12:02:00Z' }]));
    expect(model.events.map((e) => e.status)).toEqual(['recovered', 'completed']);
    expect(model.events[1].requestId).toBe('a'.repeat(32));
    expect(model.events[0].threadUrl).toBeUndefined();
  });
  it('handles absent fields and corrupt input with fixed diagnostics', () => {
    expect(parseDispatchSnapshot('BROKEN PRIVATE CONTENT').warnings).toEqual(['派工元数据格式无效']);
    expect(parseDispatchSnapshot(snapshot([{}])).events).toEqual([]);
    expect(parseDispatchSnapshot({ ...snapshot(), skipped: 2, truncated: true }).warnings).toEqual(['2 个元数据文件无法读取或格式无效', '仅显示最近的部分记录']);
  });
  it('drops extra fields, invalid URLs, malformed identifiers and raw error text', () => {
    const model = parseDispatchSnapshot(snapshot([{ ...session, thread: 'https://chatgpt.com/c/123?token=SECRET', summary: 'SECRET', cookie: 'SECRET', blocker_code: 'SECRET' }], [{ kind: 'consult_answer_saved', task_id: task, request_id: 'SECRET' }]));
    expect(JSON.stringify(model)).not.toContain('SECRET');
    expect(model.events[0].requestId).toBeUndefined();
    expect(model.events[0].threadUrl).toBeUndefined();
  });
  it('keeps valid slot ownership, marks old claims stale, never claims browser readiness', () => {
    const model = parseDispatchSnapshot({ ...snapshot([]), slots: [{ id: 2, port: 9334, claim_present: true, stale: true, pid: 123, task: '#80', session_key: 'audit-80', started_at: 1792670400000, thread: 'https://chatgpt.com/c/6ad9fa49-d908-83e9-a9dd-f183da27abd6', token: 'SECRET' }] });
    expect(model.slots[0]).toMatchObject({ id: 2, state: 'stale', task: '#80', sessionKey: 'audit-80', browserState: 'unprobed' });
    expect(JSON.stringify(model)).not.toContain('SECRET');
  });
  it('does not associate a reused session with an unrelated thread or ambiguous ownership', () => {
    const slots = [1, 2].map((id) => ({ id, port: 9332 + id, claim_present: true, task: `#${id}`, session_key: 'shared' }));
    expect(parseDispatchSnapshot({ ...snapshot([{ ...session, session_key: 'shared' }]), slots }).events[0].issue).toBeUndefined();
    expect(parseDispatchSnapshot({ ...snapshot([{ ...session, session_key: 'shared', thread: 'https://chatgpt.com/c/6ad9fa49-d908-83e9-a9dd-f183da27abd6' }]), slots: [slots[0]] }).events[0].issue).toBeUndefined();
  });
  it('never labels historical dispatches with a newer claim after thread/session reuse', () => {
    const thread = 'https://chatgpt.com/c/6ad9fa49-d908-83e9-a9dd-f183da27abd6';
    for (const hasThread of [true, false]) {
      const model = parseDispatchSnapshot({ ...snapshot([{ ...session, session_key: 'shared', thread: hasThread ? thread : undefined, created_at: '2026-10-21T12:00:00Z', last_used_at: '2026-10-21T12:01:00Z' }]), slots: [{ id: 1, port: 9333, claim_present: true, task: '#81', session_key: 'shared', thread: hasThread ? thread : undefined, started_at: Date.parse('2026-10-22T12:00:00Z') }] });
      expect(model.events[0].issue).toBeUndefined();
      expect(model.slots[0].task).toBe('#81');
    }
  });
  it('does not infer Issue ownership from arbitrary task names or session text', () => {
    expect(parseDispatchSnapshot(snapshot([{ ...session, session_key: 'maybe-issue-80' }])).events[0].issue).toBeUndefined();
  });
});
