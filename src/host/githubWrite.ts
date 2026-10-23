import { hostInvoke } from './invoke';

export type GithubWriteState = 'confirmed' | 'partial' | 'unconfirmed' | 'failed';

export type GithubWriteCode =
  | 'ok'
  | 'invalid_input'
  | 'not_allowed'
  | 'head_mismatch'
  | 'pr_issue_mismatch'
  | 'gh_missing'
  | 'no_login'
  | 'timeout'
  | 'github_failed'
  | 'unconfirmed'
  | 'sub_issue_failed';

export interface GithubWriteStep {
  readonly step: 'comment' | 'label' | 'create_issue' | 'sub_issue';
  readonly state: 'confirmed' | 'unconfirmed' | 'failed' | 'skipped';
}

export interface GithubWriteResult {
  readonly status: GithubWriteState;
  readonly code: GithubWriteCode;
  readonly message: string;
  readonly steps: readonly GithubWriteStep[];
  readonly issueNumber?: number;
  readonly url?: string;
  readonly commentUrl?: string;
  readonly currentHead?: string;
}

export interface GithubWriteStatus {
  readonly installed: boolean;
  readonly loggedIn: boolean;
  readonly reason: 'ok' | 'gh_missing' | 'not_logged_in' | 'failed';
  readonly message: string;
}

export interface CreateIssueArgs {
  readonly repo: string;
  readonly title: string;
  readonly body: string;
  readonly parentSpec?: number;
}

export interface CommentArgs {
  readonly repo: string;
  readonly issue: number;
  readonly text: string;
}

export interface SetPauseArgs {
  readonly repo: string;
  readonly issue: number;
  readonly paused: boolean;
}

export interface AcceptArgs {
  readonly repo: string;
  readonly pr: number;
  readonly issue: number;
  readonly expectedHead: string;
}

export interface RequestChangesArgs {
  readonly repo: string;
  readonly pr: number;
  readonly issue: number;
  readonly expectedHead: string;
  readonly text: string;
}

const COMMENT_PREFIX = '> 【ai-one】由用户在本地 AI 协作工作台触发并确认。';
const PAUSE_MARKER = '<!-- ai-one:set_pause:v1 -->';
const MARKER_PREFIX = '<!-- ai-one:';
const MAX_TEXT_CHARS = 10_000;
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const SHA_RE = /^[0-9a-f]{40}$/iu;

const MESSAGES: Record<GithubWriteCode, string> = {
  ok: '已确认写入 GitHub',
  invalid_input: '输入参数不合法',
  not_allowed: '当前配置不允许该操作',
  head_mismatch: 'HEAD 已更新，先刷新',
  pr_issue_mismatch: '该 PR 与这个 Issue 没有关联，已拒绝',
  gh_missing: '未安装 GitHub CLI',
  no_login: '没有可用的 GitHub 登录',
  timeout: '请求超时，写入结果可能不确定，请先回读，不要重试',
  github_failed: 'GitHub 操作失败，请检查权限、网络和 API 限额',
  unconfirmed: '已发出，但没能确认；请先回读，不要重试',
  sub_issue_failed: 'Issue 已创建，但没能挂到父 Spec 下',
};

const PRE_WRITE_TIMEOUT_MESSAGE = '请求超时，尚未发出写入，可稍后重试';
const PR_NOT_OPEN_MESSAGE = 'PR 不存在或当前不是开放状态，已拒绝';
const LABEL_FAILED_MESSAGE = '评论已确认，但标签未能更新';
const SUB_ISSUE_UNCONFIRMED_MESSAGE = 'Issue 已创建，但子 Issue 关系已发出，暂未确认；请先回读，不要重试';

const ALLOWED_MESSAGES = new Set<string>([
  ...Object.values(MESSAGES),
  PRE_WRITE_TIMEOUT_MESSAGE,
  PR_NOT_OPEN_MESSAGE,
  LABEL_FAILED_MESSAGE,
  SUB_ISSUE_UNCONFIRMED_MESSAGE,
]);

const STEP_NAMES = new Set<GithubWriteStep['step']>(['comment', 'label', 'create_issue', 'sub_issue']);
const STEP_STATES = new Set<GithubWriteStep['state']>(['confirmed', 'unconfirmed', 'failed', 'skipped']);
const RESULT_STATES = new Set<GithubWriteResult['status']>(['confirmed', 'partial', 'unconfirmed', 'failed']);
const RESULT_CODES = new Set<GithubWriteCode>(Object.keys(MESSAGES) as GithubWriteCode[]);
const STATUS_REASONS = new Set<GithubWriteStatus['reason']>(['ok', 'gh_missing', 'not_logged_in', 'failed']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function validRepo(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  if (parts.length !== 2) return false;
  const [owner, name] = parts;
  if (!owner || !name || owner.length > 39 || name.length > 100) return false;
  const segRe = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
  return segRe.test(owner) && segRe.test(name);
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && Number.isSafeInteger(value);
}

function validSha(value: unknown): value is string {
  return typeof value === 'string' && SHA_RE.test(value);
}

function validString(
  value: unknown,
  maxChars: number,
  allowEmpty: boolean,
  rejectMarker: boolean,
): value is string {
  if (typeof value !== 'string') return false;
  const length = characterCount(value);
  return (allowEmpty || length > 0)
    && length <= maxChars
    && !CONTROL_CHAR_RE.test(value)
    && (!rejectMarker || !value.includes(MARKER_PREFIX));
}

function validTitle(value: unknown): value is string {
  if (typeof value !== 'string' || /[\n\r\t]/u.test(value)) return false;
  const trimmedLength = characterCount(value.trim());
  return trimmedLength >= 1
    && trimmedLength <= 256
    && characterCount(value) <= 256
    && validString(value, MAX_TEXT_CHARS, false, true);
}

function validBody(value: unknown): value is string {
  return validString(value, MAX_TEXT_CHARS, true, true);
}

function validText(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return characterCount(trimmed) >= 1 && validString(value, MAX_TEXT_CHARS, false, true);
}

function invalidInputResult(): GithubWriteResult {
  return {
    status: 'failed',
    code: 'invalid_input',
    message: MESSAGES.invalid_input,
    steps: [],
  };
}

function unconfirmedResult(): GithubWriteResult {
  return {
    status: 'unconfirmed',
    code: 'unconfirmed',
    message: MESSAGES.unconfirmed,
    steps: [],
  };
}

function normalizeStatus(value: unknown): GithubWriteStatus {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['installed', 'loggedIn', 'reason', 'message'])
    || typeof value.installed !== 'boolean'
    || typeof value.loggedIn !== 'boolean'
    || typeof value.reason !== 'string'
    || !STATUS_REASONS.has(value.reason as GithubWriteStatus['reason'])
    || typeof value.message !== 'string'
  ) {
    return {
      installed: false,
      loggedIn: false,
      reason: 'failed',
      message: 'GitHub 写入桥状态未知',
    };
  }

  // Consistent status invariant: ok means installed and logged in.
  if (value.reason === 'ok' && (!value.installed || !value.loggedIn)) {
    return {
      installed: false,
      loggedIn: false,
      reason: 'failed',
      message: 'GitHub 写入桥状态异常',
    };
  }
  if (value.reason === 'gh_missing' && value.installed) {
    return {
      installed: false,
      loggedIn: false,
      reason: 'failed',
      message: 'GitHub 写入桥状态异常',
    };
  }
  if (value.reason === 'not_logged_in' && (!value.installed || value.loggedIn)) {
    return {
      installed: false,
      loggedIn: false,
      reason: 'failed',
      message: 'GitHub 写入桥状态异常',
    };
  }

  return {
    installed: value.installed,
    loggedIn: value.loggedIn,
    reason: value.reason as GithubWriteStatus['reason'],
    message: value.message,
  };
}

function validStep(value: unknown): value is GithubWriteStep {
  return isRecord(value)
    && hasExactKeys(value, ['step', 'state'])
    && typeof value.step === 'string'
    && STEP_NAMES.has(value.step as GithubWriteStep['step'])
    && typeof value.state === 'string'
    && STEP_STATES.has(value.state as GithubWriteStep['state']);
}

function normalizeResult(value: unknown): GithubWriteResult {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['status', 'code', 'message', 'steps'], ['issueNumber', 'url', 'commentUrl', 'currentHead'])
    || typeof value.status !== 'string'
    || !RESULT_STATES.has(value.status as GithubWriteResult['status'])
    || typeof value.code !== 'string'
    || !RESULT_CODES.has(value.code as GithubWriteCode)
    || typeof value.message !== 'string'
    || !ALLOWED_MESSAGES.has(value.message)
    || !Array.isArray(value.steps)
    || !value.steps.every(validStep)
  ) {
    return unconfirmedResult();
  }
  if (value.issueNumber !== undefined && !validNumber(value.issueNumber)) return unconfirmedResult();
  if (value.url !== undefined && typeof value.url !== 'string') return unconfirmedResult();
  if (value.commentUrl !== undefined && typeof value.commentUrl !== 'string') return unconfirmedResult();
  if (value.currentHead !== undefined && !validSha(value.currentHead)) return unconfirmedResult();

  // Self-contradictory results must never read as success: confirmed needs ok plus at least one step,
  // all confirmed; failed cannot contain a confirmed step; partial needs a confirmed and a failed step.
  const steps = value.steps as GithubWriteStep[];
  const hasConfirmed = steps.some((step) => step.state === 'confirmed');
  const hasFailed = steps.some((step) => step.state === 'failed');
  if ((value.code === 'ok') !== (value.status === 'confirmed')) return unconfirmedResult();
  if (value.status === 'confirmed' && (steps.length === 0 || !steps.every((step) => step.state === 'confirmed'))) {
    return unconfirmedResult();
  }
  if (value.status === 'partial' && !(hasConfirmed && hasFailed)) return unconfirmedResult();
  if (value.status === 'failed' && hasConfirmed) return unconfirmedResult();
  // Any unknown step means the write may have happened: only an unconfirmed total is honest.
  if (steps.some((step) => step.state === 'unconfirmed') && value.status !== 'unconfirmed') return unconfirmedResult();
  // An explicit "unconfirmed" code can only travel with an unconfirmed total (never read as failed).
  if (value.code === 'unconfirmed' && value.status !== 'unconfirmed') return unconfirmedResult();
  // sub_issue_failed means: the issue was created and confirmed, only the parent link failed.
  if (
    value.code === 'sub_issue_failed'
    && !(
      value.status === 'partial'
      && steps.some((step) => step.step === 'create_issue' && step.state === 'confirmed')
      && steps.some((step) => step.step === 'sub_issue' && step.state === 'failed')
    )
  ) {
    return unconfirmedResult();
  }
  // Fixed wordings carry a contract: an uncertain wording only travels with an unconfirmed total,
  // "comment confirmed, label failed" only with a matching partial, and so on. Anything else is a
  // contradiction and is reported as unconfirmed (never as a safe-to-retry failure).
  const hasStep = (name: GithubWriteStep['step'], state: GithubWriteStep['state']) =>
    steps.some((step) => step.step === name && step.state === state);
  if (
    (value.message === MESSAGES.unconfirmed || value.message === SUB_ISSUE_UNCONFIRMED_MESSAGE)
    && value.status !== 'unconfirmed'
  ) {
    return unconfirmedResult();
  }
  if (
    value.message === SUB_ISSUE_UNCONFIRMED_MESSAGE
    && !(hasStep('create_issue', 'confirmed') && hasStep('sub_issue', 'unconfirmed'))
  ) {
    return unconfirmedResult();
  }
  if (
    value.message === LABEL_FAILED_MESSAGE
    && !(value.status === 'partial' && hasStep('comment', 'confirmed') && hasStep('label', 'failed'))
  ) {
    return unconfirmedResult();
  }
  if (value.message === PR_NOT_OPEN_MESSAGE && value.status !== 'failed') return unconfirmedResult();
  // A timeout either happened before any write (failed, nothing sent) or after one started (unconfirmed).
  if (
    (value.message === PRE_WRITE_TIMEOUT_MESSAGE)
    !== (value.code === 'timeout' && value.status === 'failed')
  ) {
    return unconfirmedResult();
  }
  if (value.code === 'timeout' && value.status !== 'failed' && value.status !== 'unconfirmed') {
    return unconfirmedResult();
  }
  if (value.message === PRE_WRITE_TIMEOUT_MESSAGE && steps.length > 0) return unconfirmedResult();
  if (value.message === MESSAGES.timeout && value.status !== 'unconfirmed') return unconfirmedResult();
  if (
    (value.code === 'head_mismatch' || value.code === 'pr_issue_mismatch' || value.code === 'invalid_input'
      || value.code === 'not_allowed')
    && value.status !== 'failed'
  ) {
    return unconfirmedResult();
  }
  // The success wording is reserved for confirmed results.
  if ((value.message === MESSAGES.ok) !== (value.status === 'confirmed')) return unconfirmedResult();

  return {
    status: value.status as GithubWriteResult['status'],
    code: value.code as GithubWriteCode,
    message: value.message,
    steps: steps.map((s) => ({ step: s.step, state: s.state })),
    ...(value.issueNumber !== undefined ? { issueNumber: value.issueNumber as number } : {}),
    ...(value.url !== undefined ? { url: value.url as string } : {}),
    ...(value.commentUrl !== undefined ? { commentUrl: value.commentUrl as string } : {}),
    ...(value.currentHead !== undefined ? { currentHead: value.currentHead as string } : {}),
  };
}

async function invokeBridge(cmd: string, args: Record<string, unknown>): Promise<GithubWriteResult> {
  try {
    const raw = await hostInvoke(cmd, args);
    return normalizeResult(raw);
  } catch {
    // If the Tauri IPC fails after the Rust command was dispatched, the process may have completed
    // the write on GitHub before IPC response failed. Return unconfirmed to avoid blind retries.
    return unconfirmedResult();
  }
}

export async function status(): Promise<GithubWriteStatus> {
  try {
    const raw = await hostInvoke('github_write_status');
    return normalizeStatus(raw);
  } catch {
    return {
      installed: false,
      loggedIn: false,
      reason: 'failed',
      message: 'GitHub 写入桥状态未知',
    };
  }
}

export async function createIssue(args: CreateIssueArgs): Promise<GithubWriteResult> {
  if (
    !validRepo(args.repo)
    || !validTitle(args.title)
    || !validBody(args.body)
    || (args.parentSpec !== undefined && !validNumber(args.parentSpec))
  ) {
    return invalidInputResult();
  }
  return invokeBridge('github_write_create_issue', {
    repo: args.repo,
    title: args.title,
    body: args.body,
    ...(args.parentSpec !== undefined ? { parentSpec: args.parentSpec } : {}),
  });
}

export async function comment(args: CommentArgs): Promise<GithubWriteResult> {
  if (!validRepo(args.repo) || !validNumber(args.issue) || !validText(args.text)) {
    return invalidInputResult();
  }
  return invokeBridge('github_write_comment', {
    repo: args.repo,
    issue: args.issue,
    text: args.text,
  });
}

export async function setPause(args: SetPauseArgs): Promise<GithubWriteResult> {
  if (!validRepo(args.repo) || !validNumber(args.issue) || typeof args.paused !== 'boolean') {
    return invalidInputResult();
  }
  return invokeBridge('github_write_set_pause', {
    repo: args.repo,
    issue: args.issue,
    paused: args.paused,
  });
}

export async function accept(args: AcceptArgs): Promise<GithubWriteResult> {
  if (
    !validRepo(args.repo)
    || !validNumber(args.pr)
    || !validNumber(args.issue)
    || !validSha(args.expectedHead)
  ) {
    return invalidInputResult();
  }
  return invokeBridge('github_write_accept', {
    repo: args.repo,
    pr: args.pr,
    issue: args.issue,
    expectedHead: args.expectedHead,
  });
}

export async function requestChanges(args: RequestChangesArgs): Promise<GithubWriteResult> {
  if (
    !validRepo(args.repo)
    || !validNumber(args.pr)
    || !validNumber(args.issue)
    || !validSha(args.expectedHead)
    || !validText(args.text)
  ) {
    return invalidInputResult();
  }
  return invokeBridge('github_write_request_changes', {
    repo: args.repo,
    pr: args.pr,
    issue: args.issue,
    expectedHead: args.expectedHead,
    text: args.text,
  });
}

export function derivePauseState(comments: { body: string }[]): { paused: boolean } {
  let paused = false;
  for (const comment of comments) {
    if (typeof comment?.body !== 'string') continue;
    const lines = comment.body.split(/\r?\n/u);
    if (lines.length === 5 && lines[0] === COMMENT_PREFIX && lines[1] === '' && lines[3] === '' && lines[4] === PAUSE_MARKER) {
      if (lines[2] === '用户已暂停：请停止派发新工作，正在进行的一步可完成。') paused = true;
      else if (lines[2] === '用户已恢复：可继续派发。') paused = false;
    } else if (lines.length === 3 && lines[0] === COMMENT_PREFIX && lines[2] === PAUSE_MARKER) {
      if (lines[1] === '用户已暂停：请停止派发新工作，正在进行的一步可完成。') paused = true;
      else if (lines[1] === '用户已恢复：可继续派发。') paused = false;
    }
  }
  return { paused };
}

export const AI_ONE_COMMENT_PREFIX = COMMENT_PREFIX;
export const COMMENT_MARKER = '<!-- ai-one:comment:v1 -->';
export { PAUSE_MARKER };

export function formatCommentBody(text: string): string {
  return `${COMMENT_PREFIX}\n\n${text.trim()}\n\n<!-- ai-one:comment:v1 -->`;
}

export function formatPauseBody(state: 'paused' | 'running'): string {
  const text = state === 'paused'
    ? '用户已暂停：请停止派发新工作，正在进行的一步可完成。'
    : '用户已恢复：可继续派发。';
  return `${COMMENT_PREFIX}\n\n${text}\n\n${PAUSE_MARKER}`;
}

export function formatAcceptBody(expectedHead: string): string {
  return `${COMMENT_PREFIX}\n\n【ai-one】用户验收通过（针对 HEAD ${expectedHead.toLowerCase()}）。\n\n<!-- ai-one:accept:v1 -->`;
}

export function formatRequestChangesBody(expectedHead: string, text: string): string {
  return `${COMMENT_PREFIX}\n\n【ai-one】用户要求修改（针对 HEAD ${expectedHead.toLowerCase()}）：\n\n${text.trim()}\n\n<!-- ai-one:request_changes:v1 -->`;
}

export const githubWrite = {
  status,
  createIssue,
  comment,
  setPause,
  accept,
  requestChanges,
};
