import type { Locale } from '../i18n/resolve';
import type { V2StatusTone } from './v2';

/**
 * Task HUD view model (Issue #40, Spec #32 v1).
 *
 * Pure data + selectors. The first slice runs on clearly labelled demo data, so every record
 * carries a `dataSource` and the UI derives its wording from it instead of presuming that GitHub
 * was read. Wiring real data later (#36 JSON) means producing `HudTask[]` with
 * `dataSource: 'github'`; no component has to change what it claims.
 */

export type HudLocale = 'en' | 'zh';
export type LText = Readonly<Record<HudLocale, string>>;

/**
 * The HUD ships English and Simplified Chinese copy (#46: Simplified is the default Chinese). Every
 * Chinese app locale reads the Chinese copy; ja / de read English.
 */
export function hudLocale(locale: Locale): HudLocale {
  return String(locale).startsWith('zh') ? 'zh' : 'en';
}

export function pickText(text: LText, locale: Locale): string {
  return text[hudLocale(locale)];
}

export type TaskStatus = 'running' | 'rework' | 'review' | 'decide' | 'accept' | 'blocked' | 'done' | 'unknown';

export const TASK_STATUSES: readonly TaskStatus[] = ['running', 'rework', 'review', 'decide', 'accept', 'blocked', 'done', 'unknown'];

/** Semantic tone per status; colours stay in the v2 tokens. Amber (`you`) only where the user is needed. */
export const STATUS_TONE: Readonly<Record<TaskStatus, V2StatusTone>> = {
  running: 'run',
  rework: 'rework',
  review: 'run',
  decide: 'you',
  accept: 'you',
  blocked: 'block',
  done: 'done',
  unknown: 'unknown',
};

const NEEDS_YOU: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['decide', 'accept', 'blocked']);
const IN_PROGRESS: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['running', 'rework', 'review']);

/** Decisions first, then blockers, then acceptances (design §D). */
const NEEDS_YOU_ORDER: Readonly<Partial<Record<TaskStatus, number>>> = { decide: 0, blocked: 1, accept: 2 };

export type DataSource = 'mock' | 'github' | 'local';

export type CiState = 'success' | 'failure' | 'running' | 'unknown';

export interface HudCi {
  state: CiState;
  /** Full SHA the checks were read for. A CI result only means something next to the HEAD it ran on. */
  headSha?: string;
  /** e.g. "24 checks". */
  detail?: LText;
}

export interface HudPr {
  number: number;
  draft: boolean;
  /** Full 40-hex HEAD. Absent when it could not be read; never guessed. */
  headSha?: string;
}

/**
 * Evidence provenance (design §0.7): read back from GitHub, run on this machine, claimed by an
 * executor (not evidence), or not run / not verified.
 */
export type EvidenceKind = 'readback' | 'local' | 'self' | 'unverified';

export const EVIDENCE_KINDS: readonly EvidenceKind[] = ['readback', 'local', 'self', 'unverified'];

export interface HudEvidence {
  id: string;
  kind: EvidenceKind;
  text: LText;
  /** Minutes before the snapshot; undefined = unknown time. */
  observedMinutesAgo?: number;
  /** Verbatim material for the "raw evidence" disclosure. */
  raw?: string;
}

export interface HudStage {
  name: LText;
  state: 'done' | 'active' | 'todo' | 'skipped';
}

export interface HudTask {
  id: string;
  dataSource: DataSource;
  repo: string;
  issue?: number;
  title: LText;
  status: TaskStatus;
  /** Short status note shown next to the status, e.g. "round 2/3". */
  statusNote?: LText;
  stages: HudStage[];
  /** "Now" line in plain language. */
  summary: LText;
  nextStep?: LText;
  /** Who is expected to act next. */
  owner?: LText;
  updatedMinutesAgo?: number;
  pr?: HudPr;
  ci?: HudCi;
  review?: { verdict: 'pass' | 'revise' | 'blocked' | 'none'; headSha?: string; by?: LText };
  evidence: HudEvidence[];
  /** Plain-language reason data is missing, shown instead of an invented value. */
  gap?: LText;
}

export function isNeedsYou(status: TaskStatus): boolean {
  return NEEDS_YOU.has(status);
}

export function isInProgress(status: TaskStatus): boolean {
  return IN_PROGRESS.has(status);
}

export type CiView =
  | { state: 'success' | 'failure' | 'running'; headSha: string }
  | { state: 'unknown'; reason: 'no-ci' | 'no-head' | 'head-mismatch' | 'no-pr'; headSha?: string };

/**
 * CI verdict for the task's *current* HEAD. A result read for another SHA, a missing HEAD or a
 * missing CI record all degrade to `unknown`: "CI succeeded" never stands in for anything else.
 */
export function effectiveCi(task: HudTask): CiView {
  if (!task.pr) return { state: 'unknown', reason: 'no-pr' };
  const head = task.pr.headSha;
  if (!head) return { state: 'unknown', reason: 'no-head' };
  const ci = task.ci;
  if (!ci || ci.state === 'unknown') return { state: 'unknown', reason: 'no-ci', headSha: head };
  if (ci.headSha !== head) return { state: 'unknown', reason: 'head-mismatch', headSha: head };
  return { state: ci.state, headSha: head };
}

/** A review verdict only counts for the HEAD it was given on. */
export function reviewIsCurrent(task: HudTask): boolean {
  return Boolean(task.review && task.review.verdict !== 'none' && task.pr?.headSha && task.review.headSha === task.pr.headSha);
}

/** Failed or unreadable: things the user should not read as healthy. */
export function needsAttention(task: HudTask): boolean {
  if (task.status === 'unknown') return true;
  const ci = effectiveCi(task);
  if (ci.state === 'failure') return true;
  return ci.state === 'unknown' && ci.reason !== 'no-pr' && task.status !== 'done';
}

export interface HudSummary {
  total: number;
  inProgress: number;
  needsYou: number;
  attention: number;
}

/** Groups can overlap (a blocked task with failing CI is both "needs you" and "attention"). */
export function summarize(tasks: readonly HudTask[]): HudSummary {
  let inProgress = 0;
  let needsYou = 0;
  let attention = 0;
  for (const task of tasks) {
    if (isInProgress(task.status)) inProgress += 1;
    if (isNeedsYou(task.status)) needsYou += 1;
    if (needsAttention(task)) attention += 1;
  }
  return { total: tasks.length, inProgress, needsYou, attention };
}

export function needsYouTasks(tasks: readonly HudTask[]): HudTask[] {
  return tasks
    .filter((task) => isNeedsYou(task.status))
    .sort((a, b) => (NEEDS_YOU_ORDER[a.status] ?? 9) - (NEEDS_YOU_ORDER[b.status] ?? 9));
}

export function inProgressTasks(tasks: readonly HudTask[]): HudTask[] {
  return tasks.filter((task) => isInProgress(task.status));
}

export function otherTasks(tasks: readonly HudTask[]): HudTask[] {
  return tasks.filter((task) => !isInProgress(task.status) && !isNeedsYou(task.status));
}

export function repoList(tasks: readonly HudTask[]): string[] {
  return [...new Set(tasks.map((task) => task.repo))].sort((a, b) => a.localeCompare(b));
}

/** List filter: one status, or a group used by the overview counters. */
export type StatusFilter = 'all' | 'needsYou' | 'inProgress' | 'attention' | TaskStatus;
export const ALL = 'all' as const;

export function matchesStatus(task: HudTask, filter: StatusFilter): boolean {
  if (filter === ALL) return true;
  if (filter === 'needsYou') return isNeedsYou(task.status);
  if (filter === 'inProgress') return isInProgress(task.status);
  if (filter === 'attention') return needsAttention(task);
  return task.status === filter;
}

export function filterTasks(tasks: readonly HudTask[], repo: string, status: StatusFilter): HudTask[] {
  return tasks.filter((task) => (repo === ALL || task.repo === repo) && matchesStatus(task, status));
}

export function statusFilterCount(tasks: readonly HudTask[], repo: string, status: StatusFilter): number {
  return filterTasks(tasks, repo, status).length;
}

// ---------------------------------------------------------------------------------------------
// View state

export type HudView = 'overview' | 'list' | 'detail';
export type HudScenario = 'sample' | 'empty';

export interface HudState {
  view: HudView;
  /** Where "back" leaves the detail view to. */
  backTo: Exclude<HudView, 'detail'>;
  selectedId?: string;
  repo: string;
  status: StatusFilter;
  scenario: HudScenario;
}

export function initialHudState(overrides: Partial<HudState> = {}): HudState {
  return { view: 'overview', backTo: 'overview', repo: ALL, status: ALL, scenario: 'sample', ...overrides };
}

export type HudAction =
  | { type: 'overview' }
  | { type: 'list'; status?: StatusFilter }
  | { type: 'open'; id: string }
  | { type: 'back' }
  | { type: 'repo'; repo: string }
  | { type: 'status'; status: StatusFilter }
  | { type: 'clearFilters' }
  | { type: 'scenario'; scenario: HudScenario };

export function hudReducer(state: HudState, action: HudAction): HudState {
  switch (action.type) {
    case 'overview':
      return { ...state, view: 'overview', selectedId: undefined };
    case 'list':
      return { ...state, view: 'list', selectedId: undefined, status: action.status ?? state.status };
    case 'open':
      return { ...state, view: 'detail', selectedId: action.id, backTo: state.view === 'detail' ? state.backTo : state.view };
    case 'back':
      return state.view === 'detail' ? { ...state, view: state.backTo, selectedId: undefined } : state;
    case 'repo':
      return { ...state, repo: action.repo };
    case 'status':
      return { ...state, status: action.status };
    case 'clearFilters':
      return { ...state, repo: ALL, status: ALL };
    case 'scenario':
      // A different data set invalidates the open task and any filter that may no longer apply.
      return {
        ...state,
        scenario: action.scenario,
        view: state.view === 'detail' ? state.backTo : state.view,
        selectedId: undefined,
        repo: ALL,
        status: ALL,
      };
  }
}

/** Escape leaves the detail view first, then the HUD. */
export function escapeAction(state: HudState): 'back' | 'close' {
  return state.view === 'detail' ? 'back' : 'close';
}

/** The selected task; a stale id (data swapped underneath) yields undefined, never a guess. */
export function selectedTask(state: HudState, tasks: readonly HudTask[]): HudTask | undefined {
  return state.selectedId ? tasks.find((task) => task.id === state.selectedId) : undefined;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatAge(minutes: number | undefined, locale: Locale): string {
  const zh = hudLocale(locale) === 'zh';
  if (minutes === undefined) return zh ? '时间未知' : 'time unknown';
  if (minutes < 1) return zh ? '刚刚' : 'just now';
  if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return zh ? `${hours} 小时前` : `${hours} h ago`;
  return zh ? `${Math.floor(hours / 24)} 天前` : `${Math.floor(hours / 24)} d ago`;
}
