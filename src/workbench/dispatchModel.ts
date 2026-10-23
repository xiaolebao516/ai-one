import type { DispatchSnapshot, DispatchStatus } from '../dispatch/types';

// Obviously fake thread id: demo data must not point at a real conversation.
const THREAD_URL = 'https://chatgpt.com/c/00000000-0000-4000-8000-000000000000';

/** Fixed demo data only; browser availability is never probed. */
export const DEMO_DISPATCH: DispatchSnapshot = {
  events: [
    { id: 'sess_20261022_100000_demo-running', taskId: 'task_20261022_100000_demo-running', sessionId: 'sess_20261022_100000_demo-running', sessionKey: 'prodex-slot-1', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000001', status: 'running', createdAt: '2026-10-22T10:00:00.000Z', updatedAt: '2026-10-22T10:02:00.000Z', issue: '#12' },
    { id: 'sess_20261022_093000_demo-completed', taskId: 'task_20261022_093000_demo-completed', sessionId: 'sess_20261022_093000_demo-completed', sessionKey: 'prodex-slot-2', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000002', status: 'completed', createdAt: '2026-10-22T09:30:00.000Z', updatedAt: '2026-10-22T09:45:00.000Z', issue: '#13' },
    { id: 'sess_20261022_090000_demo-timeout', taskId: 'task_20261022_090000_demo-timeout', sessionId: 'sess_20261022_090000_demo-timeout', sessionKey: 'prodex-slot-3', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000003', status: 'timeout', createdAt: '2026-10-22T09:00:00.000Z', updatedAt: '2026-10-22T09:05:00.000Z', issue: '#14' },
    { id: 'sess_20261022_083000_demo-mismatch', taskId: 'task_20261022_083000_demo-mismatch', sessionId: 'sess_20261022_083000_demo-mismatch', sessionKey: 'prodex-slot-4', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000004', status: 'request_mismatch', createdAt: '2026-10-22T08:30:00.000Z', updatedAt: '2026-10-22T08:35:00.000Z', issue: '#15' },
    { id: 'sess_20261022_080000_demo-recovered', taskId: 'task_20261022_080000_demo-recovered', sessionId: 'sess_20261022_080000_demo-recovered', sessionKey: 'prodex-slot-5', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000005', status: 'recovered', createdAt: '2026-10-22T08:00:00.000Z', updatedAt: '2026-10-22T08:10:00.000Z', issue: '#16' },
    { id: 'sess_20261022_073000_demo-blocked', taskId: 'task_20261022_073000_demo-blocked', sessionId: 'sess_20261022_073000_demo-blocked', sessionKey: 'prodex-slot-6', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000006', status: 'blocked', createdAt: '2026-10-22T07:30:00.000Z', updatedAt: '2026-10-22T07:40:00.000Z', issue: '#17' },
    { id: 'sess_20261022_070000_demo-preview', taskId: 'task_20261022_070000_demo-preview', sessionId: 'sess_20261022_070000_demo-preview', sessionKey: 'prodex-slot-7', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000007', status: 'preview', createdAt: '2026-10-22T07:00:00.000Z', updatedAt: '2026-10-22T07:00:00.000Z', issue: '#18' },
    { id: 'sess_20261022_063000_demo-unknown', taskId: 'task_20261022_063000_demo-unknown', sessionId: 'sess_20261022_063000_demo-unknown', sessionKey: 'prodex-slot-8', threadUrl: THREAD_URL, requestId: '00000000000000000000000000000008', status: 'unknown', createdAt: '2026-10-22T06:30:00.000Z', updatedAt: '2026-10-22T06:35:00.000Z', issue: '#19' },
  ],
  slots: [
    { id: 1, port: 9333, state: 'claimed', browserState: 'unprobed', pid: 1234, task: '#12', sessionKey: 'prodex-slot-1', threadUrl: THREAD_URL, startedAt: '2026-10-22T10:00:00.000Z' },
    { id: 2, port: 9334, state: 'idle', browserState: 'unprobed' },
    { id: 3, port: 9335, state: 'stale', browserState: 'unprobed', task: '#14', startedAt: '2026-10-21T08:00:00.000Z' },
    { id: 4, port: 9336, state: 'unknown', browserState: 'unprobed' },
  ],
  warnings: [],
};

export const ATTENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ChannelTone = 'ok' | 'attention' | 'incomplete' | 'empty';

export interface ChannelSummary {
  total: number;
  counts: Record<DispatchStatus, number>;
  /** Timeouts and request mismatches inside the window; nothing else. */
  recentProblems: number;
  /** Other blocked dispatches inside the window (not timeouts or mismatches). */
  recentBlocked: number;
  lastAt?: string;
  slots: { total: number; claimed: number; idle: number; stale: number; unknown: number };
  /**
   * 'ok' means the records are complete and recent ones have no problems; browser availability is
   * never probed. 'incomplete' (warnings, unknown states or slots) is never shown as 'ok'.
   */
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
  let recentBlocked = 0;
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
    if (timestamp < cutoff || timestamp > now) continue;
    if (event.status === 'timeout' || event.status === 'request_mismatch') recentProblems += 1;
    else if (event.status === 'blocked') recentBlocked += 1;
  }

  for (const slot of snapshot.slots) {
    if (slot.state === 'claimed') slots.claimed += 1;
    else if (slot.state === 'idle') slots.idle += 1;
    else if (slot.state === 'stale') slots.stale += 1;
    else slots.unknown += 1;
  }

  // Skipped files, a truncated list or unreadable states mean "no problem seen" is not "no problem".
  const incomplete = snapshot.warnings.length > 0 || counts.unknown > 0 || slots.unknown > 0;
  let tone: ChannelTone = 'ok';
  if (recentProblems > 0 || recentBlocked > 0 || slots.stale > 0) tone = 'attention';
  else if (incomplete) tone = 'incomplete';
  else if (snapshot.events.length === 0 && snapshot.slots.length === 0) tone = 'empty';

  return { total: snapshot.events.length, counts, recentProblems, recentBlocked, lastAt, slots, tone };
}

/** Normalize an absolute local repository path without resolving or changing its case. */
export function normalizeRepoPath(input: string): string | undefined {
  if (/[\0\r\n]/.test(input)) return undefined;
  let value = input.trim();
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
    value = value.slice(1, -1).trim();
  }
  if (!value || value.length > 1024) return undefined;
  // Windows treats both slashes as separators, so any two leading ones (`//`, `\\`, `/\`) are UNC.
  if (value.startsWith('\\') || /^[\\/]{2}/.test(value)) return undefined;
  if (!value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value)) return undefined;
  if (/(^|[\\/])\.\.(?:[\\/]|$)/.test(value)) return undefined;

  if (/^\/+$/.test(value)) return '/';
  if (/^[A-Za-z]:[\\/]+$/.test(value)) return value.slice(0, 2) + value[2];
  // A backslash is a separator only on Windows; in a POSIX path it is part of a name.
  return value.startsWith('/') ? value.replace(/\/+$/, '') : value.replace(/[\\/]+$/, '');
}
