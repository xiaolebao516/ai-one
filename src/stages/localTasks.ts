import type { HudTask, LText } from '../ui/taskHudModel';
import type { ExecutionSnapshot } from '../workflow/snapshot/types';
import { buildDiscussionViewModel, type DiscussionRunState, type DiscussionNodeStatus } from './discussionViewModel';

export const LOCAL_TASKS_SCHEMA = 1;
export const MAX_LOCAL_TASK_BYTES = 5 * 1024 * 1024;
export type LocalTaskStatus = 'running' | 'needs-you' | 'completed' | 'ended' | 'interrupted';
export type LocalTaskKind = 'discussion' | 'chat-led';
export type LocalStepStatus = 'pending' | 'running' | 'checkpoint' | 'done' | 'skipped' | 'error' | 'cancelled';
export interface LocalStep {
  id: string;
  nodeId: string;
  name: string;
  speaker: string;
  text: string;
  status: LocalStepStatus;
  startedAt: string;
  endedAt?: string;
}
export interface LocalRound {
  id: string;
  startedAt: string;
  endedAt?: string;
  trigger: 'initial' | 'follow-up' | 'restart';
  participants: string[];
  steps: LocalStep[];
  summary?: string;
}
export interface LocalTask {
  id: string;
  kind: LocalTaskKind;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: LocalTaskStatus;
  stage: '想需求' | 'Chat 主导';
  sourceConversationId?: string;
  question: string;
  /** A persisted marker before any create_issue call; pending means uncertain after a crash. */
  issueCreation?: {
    status: 'pending' | 'confirmed' | 'partial' | 'unconfirmed' | 'failed';
    repo: string;
    startedAt: string;
    issueNumber?: number;
    url?: string;
  };
  rounds: LocalRound[];
}
export interface LocalTasksFile {
  schemaVersion: typeof LOCAL_TASKS_SCHEMA;
  tasks: LocalTask[];
}
export type ParseLocalTasksResult =
  | { ok: true; file: LocalTasksFile }
  | { ok: false; reason: 'invalid-json' | 'unknown-schema' | 'invalid-shape' | 'oversized-task' };

const validStatuses = new Set<LocalTaskStatus>(['running','needs-you','completed','ended','interrupted']);
const validStepStatuses = new Set<LocalStepStatus>(['pending','running','checkpoint','done','skipped','error','cancelled']);
const validTriggers = new Set<LocalRound['trigger']>(['initial','follow-up','restart']);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isIso = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) && /\d{4}-\d\d-\d\dT/.test(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isId = (value: unknown): value is string => typeof value === 'string' && /^local:[0-9a-f-]{36}$/i.test(value);

export function localTaskBytes(task: LocalTask): number {
  return new TextEncoder().encode(JSON.stringify(task)).byteLength;
}
export function validateLocalTask(value: unknown): value is LocalTask {
  if (!isObject(value) || !isId(value.id) || (value.kind !== 'discussion' && value.kind !== 'chat-led') ||
    !nonEmpty(value.title) || !isIso(value.createdAt) || !isIso(value.updatedAt) ||
    !validStatuses.has(value.status as LocalTaskStatus) ||
    value.stage !== (value.kind === 'discussion' ? '想需求' : 'Chat 主导') ||
    typeof value.question !== 'string' ||
    (value.sourceConversationId !== undefined && typeof value.sourceConversationId !== 'string') ||
    !Array.isArray(value.rounds)) return false;
  if (value.issueCreation !== undefined) {
    const c = value.issueCreation;
    if (!isObject(c) || !['pending','confirmed','partial','unconfirmed','failed'].includes(String(c.status)) ||
      !nonEmpty(c.repo) || !isIso(c.startedAt) ||
      (c.issueNumber !== undefined && (!Number.isSafeInteger(c.issueNumber) || (c.issueNumber as number) <= 0)) ||
      (c.url !== undefined && (typeof c.url !== 'string' || !/^https:\/\/github\.com\//.test(c.url)))) return false;
  }
  const roundIds = new Set<string>();
  for (const raw of value.rounds) {
    if (!isObject(raw) || !nonEmpty(raw.id) || roundIds.has(raw.id) || !isIso(raw.startedAt) ||
      (raw.endedAt !== undefined && !isIso(raw.endedAt)) ||
      !validTriggers.has(raw.trigger as LocalRound['trigger']) ||
      !Array.isArray(raw.participants) || !raw.participants.every((x: unknown) => nonEmpty(x)) ||
      !Array.isArray(raw.steps) || (raw.summary !== undefined && typeof raw.summary !== 'string')) return false;
    roundIds.add(raw.id);
    const stepIds = new Set<string>();
    for (const step of raw.steps) {
      if (!isObject(step) || !nonEmpty(step.id) || stepIds.has(step.id) || !nonEmpty(step.nodeId) ||
        !nonEmpty(step.name) || !nonEmpty(step.speaker) || typeof step.text !== 'string' ||
        !validStepStatuses.has(step.status as LocalStepStatus) || !isIso(step.startedAt) ||
        (step.endedAt !== undefined && !isIso(step.endedAt))) return false;
      stepIds.add(step.id);
    }
  }
  return true;
}
export function parseLocalTasksFile(text: string): ParseLocalTasksResult {
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; } catch { return { ok: false, reason: 'invalid-json' }; }
  if (!isObject(raw)) return { ok: false, reason: 'invalid-shape' };
  if (raw.schemaVersion !== LOCAL_TASKS_SCHEMA) return { ok: false, reason: 'unknown-schema' };
  if (!Array.isArray(raw.tasks) || !raw.tasks.every(validateLocalTask)) return { ok: false, reason: 'invalid-shape' };
  const ids = new Set<string>();
  for (const task of raw.tasks as LocalTask[]) {
    if (ids.has(task.id)) return { ok: false, reason: 'invalid-shape' };
    ids.add(task.id);
    if (localTaskBytes(task) > MAX_LOCAL_TASK_BYTES) return { ok: false, reason: 'oversized-task' };
  }
  return { ok: true, file: raw as unknown as LocalTasksFile };
}
export function emptyLocalTasks(): LocalTasksFile { return { schemaVersion: LOCAL_TASKS_SCHEMA, tasks: [] }; }
export function newDiscussionTask(question: string, now = new Date().toISOString()): LocalTask {
  if (!question.trim()) throw new Error('Discussion prompt is empty');
  return {
    id: 'local:' + crypto.randomUUID(), kind: 'discussion',
    title: question.trim().slice(0, 120), question, createdAt: now, updatedAt: now,
    status: 'running', stage: '想需求', rounds: [{
      id: crypto.randomUUID(), startedAt: now, trigger: 'initial',
      participants: ['chatgpt','gemini','claude'], steps: [],
    }],
  };
}
/** Engine node IDs and the full outputs are kept locally. No response body is sent to GitHub. */
export function roundFromSnapshot(base: LocalRound, snapshot: ExecutionSnapshot): LocalRound {
  return {
    ...base,
    endedAt: snapshot.completedAt ?? new Date().toISOString(),
    participants: Object.values(snapshot.roleMap),
    steps: snapshot.steps.map((step, index) => ({
      id: `${base.id}:${index}`, nodeId: step.nodeId, name: step.nodeId,
      speaker: step.provider ?? 'unknown',
      text: step.outputRef.kind === 'inline' ? (step.outputRef.text ?? '') : '',
      status: step.status,
      startedAt: step.startedAt, ...(step.completedAt ? { endedAt: step.completedAt } : {}),
    })),
  };
}
export function discussionState(task: LocalTask): DiscussionRunState {
  const outputs: Record<string, string> = {};
  const statusByNode: Record<string, DiscussionNodeStatus> = {};
  if (task.status === 'running' && task.rounds.every((round) => round.steps.length === 0)) {
    statusByNode.first = 'running';
    statusByNode.second = 'running';
  }
  for (const round of task.rounds) {
    for (const step of round.steps) {
      outputs[step.nodeId] = step.text;
      statusByNode[step.nodeId] = step.status === 'cancelled' ? 'error' : step.status === 'checkpoint' ? 'paused' : step.status;
    }
  }
  return { outputs, statusByNode };
}
export function localTaskToHud(task: LocalTask): HudTask {
  const labels: Record<LocalTaskStatus, LText> = {
    running: { en: 'Discussion running', zh: '讨论进行中' },
    'needs-you': { en: 'Needs your input', zh: '等待你决定' },
    completed: { en: 'Discussion complete', zh: '讨论已完成' },
    ended: { en: 'Saved and ended', zh: '已结束并保存' },
    interrupted: { en: 'Interrupted; not resumed', zh: '已中断，不自动恢复' },
  };
  const status: HudTask['status'] = task.status === 'running' ? 'running'
    : task.status === 'needs-you' ? 'decide'
      : task.status === 'interrupted' ? 'blocked' : 'done';
  const stage: LText = task.kind === 'discussion' ? {en:'Grill', zh:'想需求'} : {en:'Chat-led', zh:'Chat 主导'};
  return {
    id: task.id, dataSource: 'local', repo: 'local', title: {en:task.title,zh:task.title},
    status, stages: [{name:stage,state:status === 'done' ? 'done' : 'active'}],
    summary: labels[task.status], evidence: [], updatedMinutesAgo: Math.max(0, Math.floor((Date.now()-Date.parse(task.updatedAt))/60000)),
  };
}
export function discussionSummary(task: LocalTask) {
  return buildDiscussionViewModel(discussionState(task));
}
/** Only summarized findings, never the original page replies, enter an Issue body. */
export function discussionIssueBody(task: LocalTask): string {
  const summary = discussionSummary(task).summary;
  const field = (f: typeof summary.nextSteps) => f.kind === 'value' ? f.text : '待补';
  const body = [
    '## 关联 / 派工',
    '- Parent Spec: 无', '- Reviewed Spec Revision: 不适用', '- Priority: P1',
    '- Recommended Agent: CC/Opus（协调定方案）', '- Backup Agent: GPT via Prodex（候补实现）',
    '- Ready when: CC 补齐开工门槛后', '- Complexity: ROUTINE', '- Merge Risk: 待 CC 评估（至少 MEDIUM）',
    '- Owner: 待 CC 接手后登记', '- Reviewer: ChatGPT（独立审计，经 Prodex 新对话）',
    '- Depends on: 无', '- Current Coordinator / claim: 待认领', '- Current Executor: 待指派',
    '- Handoff on quota exhaustion: 提交/保存工作，记录完整 HEAD、验证、风险、停止写入后交接',
    '', '## 任务与范围', task.question, '',
    '讨论汇总结论：' + (summary.conclusion.kind === 'value' ? summary.conclusion.text : '未提供'),
    '仍有分歧：' + field(summary.disagreements),
    '待补证据：' + field(summary.evidenceGaps),
    '建议下一步：' + field(summary.nextSteps),
    '', '非目标：待 CC 补齐',
    '', '## 交付 / 验收标准',
    '- [ ] 由 CC 补齐可核验验收标准和验证手段',
    '- [ ] 独立 Reviewer 对当前完整 HEAD 审计并满足风险门禁',
    '', '## 开工门槛',
    'CC 必须先补齐非目标、可核验验收标准、验证手段并登记 Owner；有父 Spec 时还必须建立原生 Sub-issue 关系。缺一项不得开始实现，无法建立父子关系则暂停并在 Issue 报告。',
    '', '## 实施与验证记录', '- PR：待创建', '- 完整 HEAD / 自动验证 / CI / 实际运行证据：待验证',
    '- 当前调度状态：READY', '', '## 协调简报',
    '默认返工上限 3，超限问用户；额度紧张自动改派并通知；登录失效先问用户。（由 CC 参照执行）',
    '', '来源：由 ai-one 本地讨论汇总创建。AI 一致不等于事实已验证。',
  ].join('\n');
  if (Array.from(body).length > 60000) throw new Error('Summary exceeds GitHub write limit');
  return body;
}
