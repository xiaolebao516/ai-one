import type { DispatchEvent, DispatchSlot, DispatchSnapshot, DispatchStatus } from './types';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown, pattern: RegExp) => typeof value === 'string' && pattern.test(value) ? value : undefined;
const taskId = (value: unknown) => text(value, /^task_\d{8}_\d{6}_[a-z0-9-]{1,100}$/);
const sessionId = (value: unknown) => text(value, /^sess_\d{8}_\d{6}_[a-z0-9-]{1,100}$/);
const sessionKey = (value: unknown) => text(value, /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/);
const requestId = (value: unknown) => text(value, /^[a-f0-9]{32}$/);
const issue = (value: unknown) => text(value, /^#\d{1,6}$/);
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
const positiveInt = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
export const threadUrl = (value: unknown) => text(value, /^https:\/\/chatgpt\.com\/(?:g\/g-p-[a-z0-9]{1,40}\/)?c\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);

function status(raw: RecordValue): DispatchStatus {
  if (raw.status === 'blocked') {
    if (raw.blocker_code === 'send_timeout') return 'timeout';
    if (raw.blocker_code === 'request_mismatch') return 'request_mismatch';
    return 'blocked';
  }
  if (raw.status === 'done') return 'completed';
  if (raw.status === 'running') return 'running';
  if (raw.status === 'preview') return 'preview';
  return 'unknown';
}

/** Only the Rust metadata projection belongs here. No results, reply text, or raw errors. */
export function parseDispatchSnapshot(input: unknown): DispatchSnapshot {
  const raw = object(input);
  if (!Array.isArray(raw.sessions) || !Array.isArray(raw.receipts) || !Array.isArray(raw.slots)) {
    return { events: [], slots: [], warnings: ['派工元数据格式无效'] };
  }
  const receipts = raw.receipts.map(object);
  const events: DispatchEvent[] = [];
  for (const value of raw.sessions) {
    const row = object(value);
    const id = sessionId(row.id);
    const task = taskId(row.task_id);
    if (!id || !task) continue;
    const saved = receipts.find((r) => r.kind === 'consult_answer_saved' && r.task_id === task);
    events.push({ id, taskId: task, sessionId: id, sessionKey: sessionKey(row.session_key), threadUrl: threadUrl(row.thread) ?? threadUrl(saved?.thread), requestId: requestId(saved?.request_id) ?? requestId(row.request_id), status: status(row), createdAt: date(row.created_at), updatedAt: date(row.last_used_at) });
  }
  for (const row of receipts) {
    const task = taskId(row.task_id);
    if (!task || row.kind !== 'task_completed' || !/^task_\d{8}_\d{6}_gpt-pro-consult-recovered(?:-\d+)?$/.test(task)) continue;
    if (events.some((e) => e.taskId === task)) continue;
    events.push({ id: task, taskId: task, status: 'recovered', createdAt: date(row.created_at), updatedAt: date(row.created_at) });
  }
  // Receipt persistence can succeed even if the final session update failed. Keep the evidence
  // as a saved receipt, without upgrading the session's running/blocked state.
  for (const row of receipts) {
    const task = taskId(row.task_id);
    if (!task || row.kind !== 'consult_answer_saved' || events.some((e) => e.taskId === task)) continue;
    events.push({ id: task, taskId: task, status: 'unknown', requestId: requestId(row.request_id), threadUrl: threadUrl(row.thread), createdAt: date(row.created_at), updatedAt: date(row.created_at) });
  }
  const slots: DispatchSlot[] = [];
  for (const value of raw.slots) {
    const row = object(value);
    const id = positiveInt(row.id);
    if (!id || id > 8 || row.port !== 9332 + id) continue;
    const slot: DispatchSlot = { id, port: 9332 + id, state: row.invalid === true ? 'unknown' : row.claim_present === true ? row.stale === true ? 'stale' : 'claimed' : 'idle', browserState: 'unprobed', pid: positiveInt(row.pid), task: issue(row.task), sessionKey: sessionKey(row.session_key), threadUrl: threadUrl(row.thread), startedAt: typeof row.started_at === 'number' && row.started_at > 0 && row.started_at < 8.64e15 ? new Date(row.started_at).toISOString() : undefined };
    slots.push(slot);
  }
  // Issue associations are evidence only when explicit slot ownership matches the session or thread.
  for (const event of events) {
    const matches = slots.filter((s) => s.state === 'claimed' && (
      event.threadUrl ? s.threadUrl === event.threadUrl : event.sessionKey && s.sessionKey === event.sessionKey
    ));
    event.issue = matches.length === 1 ? matches[0].task : undefined;
  }
  events.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.id.localeCompare(b.id));
  const warnings: string[] = [];
  const skipped = positiveInt(raw.skipped);
  if (skipped) warnings.push(`${skipped} 个元数据文件无法读取或格式无效`);
  if (raw.truncated === true) warnings.push('仅显示最近的部分记录');
  return { events, slots, warnings };
}
