import type { DispatchSnapshot, DispatchStatus } from '../dispatch/types';

// Obviously fake thread id: demo data must not point at a real conversation.
const THREAD_URL = 'https://chatgpt.com/c/00000000-0000-4000-8000-000000000000';

/** Fixed demo data only; browser availability is never probed. */
export const DEMO_DISPATCH: DispatchSnapshot = {
  events: [
    { id: 'sess_20261023_100000_demo-running', taskId: 'task_20261023_100000_demo-running', sessionId: 'sess_20261023_100000_demo-running', sessionKey: 'prodex-slot-1', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000001', status: 'running', createdAt: '2026-10-23T10:00:00.000Z', updatedAt: '2026-10-23T10:02:00.000Z', issue: '#12' },
    { id: 'sess_20261023_093000_demo-completed', taskId: 'task_20261023_093000_demo-completed', sessionId: 'sess_20261023_093000_demo-completed', sessionKey: 'prodex-slot-2', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000002', status: 'completed', createdAt: '2026-10-23T09:30:00.000Z', updatedAt: '2026-10-23T09:45:00.000Z', issue: '#13' },
    { id: 'sess_20261023_090000_demo-timeout', taskId: 'task_20261023_090000_demo-timeout', sessionId: 'sess_20261023_090000_demo-timeout', sessionKey: 'prodex-slot-3', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000003', status: 'timeout', createdAt: '2026-10-23T09:00:00.000Z', updatedAt: '2026-10-23T09:05:00.000Z', issue: '#14' },
    { id: 'sess_20261023_083000_demo-mismatch', taskId: 'task_20261023_083000_demo-mismatch', sessionId: 'sess_20261023_083000_demo-mismatch', sessionKey: 'prodex-slot-4', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000004', status: 'request_mismatch', createdAt: '2026-10-23T08:30:00.000Z', updatedAt: '2026-10-23T08:35:00.000Z', issue: '#15' },
    { id: 'sess_20261023_080000_demo-recovered', taskId: 'task_20261023_080000_demo-recovered', sessionId: 'sess_20261023_080000_demo-recovered', sessionKey: 'prodex-slot-5', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000005', status: 'recovered', createdAt: '2026-10-23T08:00:00.000Z', updatedAt: '2026-10-23T08:10:00.000Z', issue: '#16' },
    { id: 'sess_20261023_073000_demo-blocked', taskId: 'task_20261023_073000_demo-blocked', sessionId: 'sess_20261023_073000_demo-blocked', sessionKey: 'prodex-slot-6', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000006', status: 'blocked', createdAt: '2026-10-23T07:30:00.000Z', updatedAt: '2026-10-23T07:40:00.000Z', issue: '#17' },
    { id: 'sess_20261023_070000_demo-preview', taskId: 'task_20261023_070000_demo-preview', sessionId: 'sess_20261023_070000_demo-preview', sessionKey: 'prodex-slot-7', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000007', status: 'preview', createdAt: '2026-10-23T07:00:00.000Z', updatedAt: '2026-10-23T07:00:00.000Z', issue: '#18' },
    { id: 'sess_20261023_063000_demo-unknown', taskId: 'task_20261023_063000_demo-unknown', sessionId: 'sess_20261023_063000_demo-unknown', sessionKey: 'prodex-slot-8', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000008', status: 'unknown', createdAt: '2026-10-23T06:30:00.000Z', updatedAt: '2026-10-23T06:35:00.000Z', issue: '#19' },
  ],
  slots: [
    { id: 1, port: 9333, state: 'claimed', browserState: 'unprobed', pid: 1234, task: '#12', sessionKey: 'prodex-slot-1', threadUrl: THREAD_URL, startedAt: '2026-10-23T10:00:00.000Z' },
    { id: 2, port: 9334, state: 'idle', browserState: 'unprobed' },
    { id: 3, port: 9335, state: 'stale', browserState: 'unprobed', task: '#14', startedAt: '2026-10-22T08:00:00.000Z' },
    { id: 4, port: 9336, state: 'unknown', browserState: 'unprobed' },
  ],
  warnings: [],
};

export const ATTENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ChannelTone = 'ok' | 'attention' | 'empty';

export interface ChannelSummary {
  total: number;
  counts: Record<DispatchStatus, number>;
  recentProblems: number;
  lastAt?: string;
  slots: { total: number; claimed: number; idle: number; stale: number; unknown: number };
  /** 'ok' means recent records have no problems; browser availability is never probed. */
  tone: ChannelTone;
}

/** Summarize only recorded metadata; missing timestamps are not observations. */
export function summarizeDispatch(snapshot: DispatchSnapshot, now: number): ChannelSummary {
  const counts: Record<DispatchStatus, number> = {
    running: 0,
    completed: 0,
    timeout: 0,
    request_mismatch: 0,
    recovered: 0,
    blocked: 0,
    preview: 0,
    unknown: 0,
  };
  const slots = { total: snapshot.slots.length, claimed: 0, idle: 0, stale: 0, unknown: 0 };
  let recentProblems = 0;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  let lastAt: string | undefined;
  const cutoff = now - ATTENTION_WINDOW_MS;

  for (const event of snapshot.events) {
    counts[event.status] += 1;
    const value = event.updatedAt ?? event.createdAt;
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) continue;
    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      lastAt = value;
    }
    if (
      (event.status === 'timeout' || event.status === 'request_mismatch' || event.status === 'blocked') &&
      timestamp >= cutoff &&
      timestamp <= now
    ) {
      recentProblems += 1;
    }
  }

  for (const slot of snapshot.slots) {
    if (slot.state === 'claimed') slots.claimed += 1;
    else if (slot.state === 'idle') slots.idle += 1;
    else if (slot.state === 'stale') slots.stale += 1;
    else slots.unknown += 1;
  }

  const tone: ChannelTone =
    snapshot.events.length === 0 && snapshot.slots.length === 0
      ? 'empty'
      : recentProblems > 0 || slots.stale > 0
        ? 'attention'
        : 'ok';

  return { total: snapshot.events.length, counts, recentProblems, lastAt, slots, tone };
}

/** Normalize an absolute local repository path without resolving or changing its case. */
export function normalizeRepoPath(input: string): string | undefined {
  if (/[\0\r\n]/.test(input)) return undefined;
  let value = input.trim();
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
    value = value.slice(1, -1).trim();
  }
  if (!value || value.length > 1024) return undefined;
  if (value.startsWith('\\') || value.startsWith('//')) return undefined;
  if (!value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value)) return undefined;
  if (/(^|[\\/])\.\.(?:[\\/]|$)/.test(value)) return undefined;

  if (/^\/+$/.test(value)) return '/';
  if (/^[A-Za-z]:[\\/]+$/.test(value)) return value.slice(0, 2) + value[2];
  return value.replace(/[\\/]+$/, '') || undefined;
}
