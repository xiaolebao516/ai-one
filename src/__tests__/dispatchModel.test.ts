import { describe, expect, it } from 'vitest';
import type { DispatchSnapshot, DispatchStatus } from '../dispatch/types';
import { ATTENTION_WINDOW_MS, DEMO_DISPATCH, normalizeRepoPath, summarizeDispatch } from '../workbench/dispatchModel';

const STATUSES: DispatchStatus[] = ['running', 'completed', 'timeout', 'request_mismatch', 'recovered', 'blocked', 'preview', 'unknown'];

describe('dispatch summary', () => {
  it('counts every declared status and every slot state', () => {
    const summary = summarizeDispatch(DEMO_DISPATCH, Date.parse('2026-10-23T12:00:00.000Z'));
    expect(summary.total).toBe(DEMO_DISPATCH.events.length);
    for (const status of STATUSES) expect(summary.counts[status]).toBe(1);
    expect(summary.slots).toEqual({ total: 4, claimed: 1, idle: 1, stale: 1, unknown: 1 });
    expect(summary.lastAt).toBe('2026-10-23T10:02:00.000Z');
  });

  it('includes the exact 24-hour boundary but excludes older, future and missing timestamps', () => {
    const now = Date.parse('2026-10-23T12:00:00.000Z');
    const snapshot: DispatchSnapshot = {
      events: [
        { id: 'at-boundary', taskId: 'a', status: 'timeout', createdAt: '2026-10-22T12:00:00.000Z' },
        { id: 'too-old', taskId: 'b', status: 'blocked', createdAt: new Date(now - ATTENTION_WINDOW_MS - 1).toISOString() },
        { id: 'future', taskId: 'c', status: 'request_mismatch', updatedAt: new Date(now + 1).toISOString() },
        { id: 'no-time', taskId: 'd', status: 'timeout' },
        { id: 'not-problem', taskId: 'e', status: 'running', createdAt: new Date(now).toISOString() },
      ],
      slots: [],
      warnings: [],
    };
    expect(summarizeDispatch(snapshot, now).recentProblems).toBe(1);
  });

  it('uses the effective timestamp and assigns all three tones', () => {
    const now = Date.parse('2026-10-23T12:00:00.000Z');
    expect(summarizeDispatch({ events: [], slots: [], warnings: [] }, now).tone).toBe('empty');
    expect(summarizeDispatch({ events: [{ id: 'ok', taskId: 'x', status: 'running', createdAt: '2026-10-23T11:00:00.000Z' }], slots: [], warnings: [] }, now)).toMatchObject({ lastAt: '2026-10-23T11:00:00.000Z', tone: 'ok' });
    expect(summarizeDispatch({ events: [{ id: 'bad', taskId: 'x', status: 'timeout', createdAt: '2026-10-23T11:00:00.000Z' }], slots: [], warnings: [] }, now).tone).toBe('attention');
    expect(summarizeDispatch({ events: [], slots: [{ id: 1, port: 9333, state: 'stale', browserState: 'unprobed' }], warnings: [] }, now).tone).toBe('attention');
  });

  it('ships one demo event for every dispatch status', () => {
    expect(DEMO_DISPATCH.events.map((event) => event.status).sort()).toEqual([...STATUSES].sort());
  });
});

describe('repository path normalization', () => {
  it('trims, removes paired quotes and trailing separators while preserving roots', () => {
    expect(normalizeRepoPath('  "C:\\work\\repo\\"  ')).toBe('C:\\work\\repo');
    expect(normalizeRepoPath("'/workspace/repo/'")).toBe('/workspace/repo');
    expect(normalizeRepoPath('C:/work/repo/')).toBe('C:/work/repo');
    expect(normalizeRepoPath('C:\\work\\repo\\\\')).toBe('C:\\work\\repo');
    expect(normalizeRepoPath('C:\\')).toBe('C:\\');
    expect(normalizeRepoPath('/')).toBe('/');
  });

  it('rejects relative paths, UNC paths, parent segments, line breaks, NUL and overlong values', () => {
    expect(normalizeRepoPath('repo')).toBeUndefined();
    expect(normalizeRepoPath('repo/path')).toBeUndefined();
    expect(normalizeRepoPath('\\\\server\\share')).toBeUndefined();
    expect(normalizeRepoPath('//server/share')).toBeUndefined();
    expect(normalizeRepoPath('/repo/../other')).toBeUndefined();
    expect(normalizeRepoPath('C:\\repo\\..\\other')).toBeUndefined();
    expect(normalizeRepoPath('/repo\nname')).toBeUndefined();
    expect(normalizeRepoPath('/repo\rname')).toBeUndefined();
    expect(normalizeRepoPath('/repo\0name')).toBeUndefined();
    expect(normalizeRepoPath('/' + 'a'.repeat(1024))).toBeUndefined();
  });
});
