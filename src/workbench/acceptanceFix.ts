import type { GithubWriteCreateIssueArgs, GithubWriteResult } from '../host/githubWrite';
import type { AcceptanceItem, AcceptanceRecord } from './userAcceptance';

/** ready: comment confirmed, create_issue not yet sent (safe to send). pending: create_issue may have been sent. */
export type FixSync = 'ready' | 'pending' | 'confirmed' | 'failed' | 'unconfirmed';
export interface AcceptanceFix { sync: FixSync; issue?: number; url?: string }
export interface IssueState { state: 'open' | 'closed'; reason?: string }
export type IssueStates = Record<string, IssueState>;
export type FixProgress = 'notStarted' | 'creating' | 'unknown' | 'failed' | 'queued' | 'working' | 'done' | 'dropped';
export interface FixWriter { createIssue(args: GithubWriteCreateIssueArgs): Promise<GithubWriteResult> }

export const issueStateKey = (repo: string, issue: number): string => `${repo.toLowerCase()}#${issue}`;

/** A user's acceptance feedback becomes a claimable Task so an agent can pick it up from the board. */
export function buildFixTask(item: AcceptanceItem, feedback: string): { title: string; body: string } {
  const problem = feedback.trim();
  const headline = problem.replace(/\s+/gu, ' ').slice(0, 60);
  const original = item.raw ?? [item.title, item.steps && `操作步骤：${item.steps}`, item.expected && `预期结果：${item.expected}`]
    .filter(Boolean).join('\n');
  const body = `## 关联 / 派工
- Parent Spec: #${item.issue}（用户验收反馈产生；原 Issue 即使已关闭也以此为线索）
- Priority: P1
- Recommended Agent: 首选改动原功能的原调度 agent；否则 Claude Code / Opus 或 Codex（按额度）
- Backup Agent: Codex / 任一可用 agent
- Ready when: 立即
- Complexity: ROUTINE
- Merge Risk: MEDIUM（来源是用户验收反馈，风险未评估；接手 agent 按实际 diff 复核）
- Depends on: 无
- Current Coordinator / claim: 待认领
- Current Executor: 待认领

## 用户的验收反馈（原话）
${problem}

## 被验收的内容（来自 #${item.issue}）
${original}

## 任务与范围
复现并修复上面反馈的问题；范围限于该验收项涉及的功能，其他问题另开 Task。

## 交付 / 验收标准
- [ ] 按“被验收的内容”重新验证，用户反馈的问题不再出现，并补回归测试
- [ ] 修复合并后，在原 Issue #${item.issue} 的“待用户验收”里更新这一项，让用户在 ai-one 总览重新验收
- [ ] 合并后同一轮内关闭本 Task，清理认领锁、工作树与分支

## 实施与验证记录
- PR：待创建
- 当前调度状态：READY
`;
  return { title: `[Task][P1] 验收反馈：${headline}`, body };
}

/** Never retried after an unknown result: only a definite failure may be sent again. */
export async function createFixTask(
  writer: FixWriter, item: AcceptanceItem, feedback: string, canSend: () => boolean = () => true,
): Promise<AcceptanceFix> {
  const task = buildFixTask(item, feedback);
  try {
    if (!canSend()) return { sync: 'failed' };
    const result = await writer.createIssue({ repo: item.repo, title: task.title, body: task.body, parentSpec: item.issue });
    const created = result.steps.some((step) => step.step === 'create_issue' && step.state === 'confirmed');
    // The Task exists and is claimable whenever create_issue is confirmed with a number; an unconfirmed or
    // failed parent link is not a reason to forget it or to create it again.
    if (created && Number.isSafeInteger(result.issueNumber) && result.status !== 'failed') {
      return { sync: 'confirmed', issue: result.issueNumber, ...(result.url ? { url: result.url } : {}) };
    }
    return { sync: result.status === 'failed' ? 'failed' : 'unconfirmed' };
  } catch { return { sync: 'unconfirmed' }; }
}

export function fixProgress(record: AcceptanceRecord | undefined, states: IssueStates | undefined): FixProgress | undefined {
  const fix = record?.fix;
  if (!record || record.kind !== 'feedback' || !fix) return undefined;
  if (fix.sync === 'ready') return 'notStarted';
  if (fix.sync === 'pending') return 'creating';
  if (fix.sync !== 'confirmed' || fix.issue === undefined) return fix.sync === 'failed' ? 'failed' : 'unknown';
  const current = states?.[issueStateKey(record.repo, fix.issue)];
  if (!current) return 'queued';
  if (current.state === 'open') return 'working';
  return current.reason === 'not_planned' ? 'dropped' : 'done';
}
/** A fixed or dropped feedback needs a fresh user decision; every other state keeps the card locked. */
export const needsNewDecision = (progress: FixProgress | undefined): boolean => progress === 'done' || progress === 'dropped';
