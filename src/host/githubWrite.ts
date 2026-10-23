import { invoke } from '@tauri-apps/api/core';

export type GithubWriteStatus = {
  available: boolean;
  reason: 'ok' | 'gh_missing' | 'not_logged_in' | 'failed';
};

export type GithubWriteCode =
  | 'ok'
  | 'not_allowed'
  | 'invalid_input'
  | 'head_mismatch'
  | 'pr_issue_mismatch'
  | 'gh_missing'
  | 'no_login'
  | 'timeout'
  | 'github_failed'
  | 'unconfirmed'
  | 'sub_issue_failed';

export type GithubWriteStep = {
  step: 'comment' | 'label' | 'create_issue' | 'sub_issue';
  state: 'confirmed' | 'unconfirmed' | 'failed' | 'skipped';
};

export type GithubWriteResult = {
  status: 'confirmed' | 'partial' | 'unconfirmed' | 'failed';
  code: GithubWriteCode;
  message: string;
  steps: GithubWriteStep[];
  issueNumber?: number;
  url?: string;
  commentUrl?: string;
  currentHead?: string;
};

export type GithubWriteCreateIssueArgs = {
  repo: string;
  title: string;
  body: string;
  parentSpec?: number;
};

export type GithubWriteCommentArgs = {
  repo: string;
  issue: number;
  text: string;
};

export type GithubWriteSetPauseArgs = {
  repo: string;
  issue: number;
  state: 'paused' | 'running';
};

export type GithubWriteAcceptArgs = {
  repo: string;
  issue: number;
  pr: number;
  expectedHead: string;
};

export type GithubWriteRequestChangesArgs = GithubWriteAcceptArgs & {
  text: string;
};

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const MAX_TEXT_CHARS = 60_000;
const MARKER_PREFIX = '<!-- ai-one:';
const COMMENT_PREFIX = '【ai-one 代用户发出】';
const PAUSE_MARKER = '<!-- ai-one:set_pause:v1 -->';
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const SHA_RE = /^[0-9a-fA-F]{40}$/u;

const MESSAGES: Record<GithubWriteCode, string> = {
  ok: '已确认写入 GitHub',
  not_allowed: '仅控制面窗口可执行此操作',
  invalid_input: '参数无效，已拒绝',
  head_mismatch: 'HEAD 已更新，先刷新',
  pr_issue_mismatch: '该 PR 与这个 Issue 没有关联，已拒绝',
  gh_missing: '未安装 GitHub CLI',
  no_login: '没有可用的 GitHub 登录',
  timeout: '请求超时，写入结果可能不确定，请先回读，不要重试',
  github_failed: 'GitHub 操作失败，请检查权限、网络和 API 限额',
  unconfirmed: '已发出，但没能确认；请先回读，不要重试',
  sub_issue_failed: 'Issue 已创建，但没能挂到父 Spec 下',
};

const ALLOWED_MESSAGES = new Set<string>([
  ...Object.values(MESSAGES),
  'PR 不存在或当前不是开放状态，已拒绝',
  '评论已确认，但标签未能更新',
  'Issue 已创建，但子 Issue 关系已发出，暂未确认；请先回读，不要重试',
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

function validNumber(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= MAX_SAFE_INTEGER;
}

function validRepo(value: unknown): value is string {
  if (typeof value !== 'string' || CONTROL_CHAR_RE.test(value)) return false;
  const parts = value.split('/');
  if (parts.length !== 2) return false;
  const [owner, name] = parts;
  return /^[A-Za-z0-9][A-Za-z0-9-]*$/u.test(owner)
    && /^[A-Za-z0-9_.-]+$/u.test(name)
    && !/^\.+$/u.test(name);
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
    && validString(value, MAX_TEXT_CHARS, false, true);
}

function validBody(value: unknown): value is string {
  return validString(value, MAX_TEXT_CHARS, true, true);
}

function validText(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && validString(value, MAX_TEXT_CHARS, false, true);
}

function validSha(value: unknown): value is string {
  return typeof value === 'string' && SHA_RE.test(value);
}

function validCreateIssueArgs(value: unknown): value is GithubWriteCreateIssueArgs {
  if (!isRecord(value) || !hasExactKeys(value, ['repo', 'title', 'body'], ['parentSpec'])) return false;
  return validRepo(value.repo)
    && validTitle(value.title)
    && validBody(value.body)
    && (value.parentSpec === undefined || validNumber(value.parentSpec));
}

function validCommentArgs(value: unknown): value is GithubWriteCommentArgs {
  return isRecord(value)
    && hasExactKeys(value, ['repo', 'issue', 'text'])
    && validRepo(value.repo)
    && validNumber(value.issue)
    && validText(value.text);
}

function validPauseArgs(value: unknown): value is GithubWriteSetPauseArgs {
  return isRecord(value)
    && hasExactKeys(value, ['repo', 'issue', 'state'])
    && validRepo(value.repo)
    && validNumber(value.issue)
    && (value.state === 'paused' || value.state === 'running');
}

function validAcceptArgs(value: unknown): value is GithubWriteAcceptArgs {
  return isRecord(value)
    && hasExactKeys(value, ['repo', 'issue', 'pr', 'expectedHead'])
    && validRepo(value.repo)
    && validNumber(value.issue)
    && validNumber(value.pr)
    && validSha(value.expectedHead);
}

function validRequestChangesArgs(value: unknown): value is GithubWriteRequestChangesArgs {
  return isRecord(value)
    && hasExactKeys(value, ['repo', 'issue', 'pr', 'expectedHead', 'text'])
    && validRepo(value.repo)
    && validNumber(value.issue)
    && validNumber(value.pr)
    && validSha(value.expectedHead)
    && validText(value.text);
}

function failedResult(code: GithubWriteCode = 'github_failed'): GithubWriteResult {
  return {
    status: 'failed',
    code,
    message: MESSAGES[code],
    steps: [],
  };
}

function invalidResult(): GithubWriteResult {
  return failedResult('invalid_input');
}

function unconfirmedResult(): GithubWriteResult {
  return {
    status: 'unconfirmed',
    code: 'unconfirmed',
    message: MESSAGES.unconfirmed,
    steps: [],
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
  // The success wording is reserved for confirmed results.
  if ((value.message === MESSAGES.ok) !== (value.status === 'confirmed')) return unconfirmedResult();

  return {
    status: value.status as GithubWriteResult['status'],
    code: value.code as GithubWriteCode,
    message: value.message,
    steps: value.steps as GithubWriteStep[],
    ...(value.issueNumber === undefined ? {} : { issueNumber: value.issueNumber as number }),
    ...(value.url === undefined ? {} : { url: value.url as string }),
    ...(value.commentUrl === undefined ? {} : { commentUrl: value.commentUrl as string }),
    ...(value.currentHead === undefined ? {} : { currentHead: (value.currentHead as string).toLowerCase() }),
  };
}

async function invokeResult(command: string, args: Record<string, unknown>): Promise<GithubWriteResult> {
  try {
    return normalizeResult(await invoke<unknown>(command, args));
  } catch {
    return unconfirmedResult();
  }
}

async function status(): Promise<GithubWriteStatus> {
  try {
    const value = await invoke<unknown>('github_write_status');
    if (
      !isRecord(value)
      || !hasExactKeys(value, ['available', 'reason'])
      || typeof value.available !== 'boolean'
      || typeof value.reason !== 'string'
      || !STATUS_REASONS.has(value.reason as GithubWriteStatus['reason'])
      || value.available !== (value.reason === 'ok')
    ) {
      return { available: false, reason: 'failed' };
    }
    return { available: value.available, reason: value.reason as GithubWriteStatus['reason'] };
  } catch {
    return { available: false, reason: 'failed' };
  }
}

async function createIssue(args: GithubWriteCreateIssueArgs): Promise<GithubWriteResult> {
  if (!validCreateIssueArgs(args)) return invalidResult();
  const payload: Record<string, unknown> = { repo: args.repo, title: args.title, body: args.body };
  if (args.parentSpec !== undefined) payload.parentSpec = args.parentSpec;
  return invokeResult('github_write_create_issue', payload);
}

async function comment(args: GithubWriteCommentArgs): Promise<GithubWriteResult> {
  if (!validCommentArgs(args)) return invalidResult();
  return invokeResult('github_write_comment', {
    repo: args.repo,
    issue: args.issue,
    text: args.text,
  });
}

async function setPause(args: GithubWriteSetPauseArgs): Promise<GithubWriteResult> {
  if (!validPauseArgs(args)) return invalidResult();
  return invokeResult('github_write_set_pause', {
    repo: args.repo,
    issue: args.issue,
    state: args.state,
  });
}

async function accept(args: GithubWriteAcceptArgs): Promise<GithubWriteResult> {
  if (!validAcceptArgs(args)) return invalidResult();
  return invokeResult('github_write_accept', {
    repo: args.repo,
    issue: args.issue,
    pr: args.pr,
    expectedHead: args.expectedHead,
  });
}

async function requestChanges(args: GithubWriteRequestChangesArgs): Promise<GithubWriteResult> {
  if (!validRequestChangesArgs(args)) return invalidResult();
  return invokeResult('github_write_request_changes', {
    repo: args.repo,
    issue: args.issue,
    pr: args.pr,
    expectedHead: args.expectedHead,
    text: args.text,
  });
}

export function derivePauseState(comments: { body: string }[]): { paused: boolean } {
  let paused = false;
  for (const comment of comments) {
    if (typeof comment?.body !== 'string') continue;
    const lines = comment.body.split(/\r?\n/u);
    if (lines.length !== 3 || lines[0] !== COMMENT_PREFIX || lines[2] !== PAUSE_MARKER) continue;
    if (lines[1] === '用户已暂停：请停止派发新工作，正在进行的一步可完成。') paused = true;
    else if (lines[1] === '用户已恢复：可继续派发。') paused = false;
    else continue;
  }
  return { paused };
}

export const githubWrite = {
  status,
  createIssue,
  comment,
  setPause,
  accept,
  requestChanges,
};
