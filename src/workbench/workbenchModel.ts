import type { HudTask, TaskStatus } from '../ui/taskHudModel';
import { inProgressTasks, isInProgress, isNeedsYou, needsYouTasks, summarize } from '../ui/taskHudModel';

/**
 * Workbench view model (#79): the new ai-one front end. Pure state and selectors; the React
 * components only render what these return, so navigation, grouping and the copy decisions that
 * depend on data are testable without a DOM.
 */

export const WORKBENCH_VIEWS = ['home', 'tasks', 'task', 'chat', 'flows', 'resources', 'chatled'] as const;
export type WorkbenchView = (typeof WORKBENCH_VIEWS)[number];

/** Views reachable from the sidebar; `task` is reached by opening a task. */
export const NAV_VIEWS = ['home', 'tasks', 'chat', 'flows', 'resources'] as const satisfies readonly WorkbenchView[];
export type NavView = (typeof NAV_VIEWS)[number];

export interface WorkbenchRoute {
  view: WorkbenchView;
  /** Only for `task`. */
  taskId?: string;
}

export const HOME_ROUTE: WorkbenchRoute = { view: 'home' };

export function isWorkbenchView(value: unknown): value is WorkbenchView {
  return typeof value === 'string' && (WORKBENCH_VIEWS as readonly string[]).includes(value);
}

/** The sidebar entry a route belongs to: a task page lights up "Tasks". */
export function navViewFor(route: WorkbenchRoute): NavView {
  if (route.view === 'task') return 'tasks';
  // Chat-led (#113) is reached from the command palette until the overview composer (L4) opens it.
  if (route.view === 'chatled') return 'chat';
  return route.view;
}

/** A task route whose task is gone (data source switched, refresh) falls back to the task list. */
export function resolveRoute(route: WorkbenchRoute, tasks: readonly HudTask[]): WorkbenchRoute {
  if (route.view !== 'task') return route;
  if (route.taskId && tasks.some((task) => task.id === route.taskId)) return route;
  return { view: 'tasks' };
}

// ---------------------------------------------------------------------------------------------
// Keyboard

interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/** Text the user is typing into: page shortcuts must not fire there. */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as TargetLike;
  if (element.isContentEditable) return true;
  const tag = String(element.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export type WorkbenchShortcut = { kind: 'palette' } | { kind: 'view'; view: NavView } | { kind: 'escape' };

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Ctrl/Cmd+K opens the palette, Ctrl/Cmd+1..5 switch views (design §7). */
export function shortcutFor(event: KeyLike): WorkbenchShortcut | undefined {
  if (event.key === 'Escape') return { kind: 'escape' };
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey || event.shiftKey) return undefined;
  if (event.key.toLowerCase() === 'k') return { kind: 'palette' };
  const index = Number(event.key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < NAV_VIEWS.length) return { kind: 'view', view: NAV_VIEWS[index] };
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Data source

export type WorkbenchSource = 'demo' | 'github';

export const DEFAULT_REPOS: readonly string[] = ['xiaolebao516/ai-one'];
export const MAX_REPOS = 8;

const REPO_SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** `owner/repo`, or a github.com URL to one; anything else is refused rather than guessed. */
export function normalizeRepo(input: string): string | undefined {
  let value = input.trim();
  const url = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(value);
  if (url) value = `${url[1]}/${url[2]}`;
  value = value.replace(/\.git$/i, '');
  if (!REPO_SLUG.test(value) || value.endsWith('/.') || value.endsWith('/..')) return undefined;
  return value;
}

// ---------------------------------------------------------------------------------------------
// Grouping and headlines

export interface RepoGroup {
  repo: string;
  tasks: HudTask[];
}

/** Keeps the order repositories first appear in, so the sidebar does not jump between refreshes. */
export function groupByRepo(tasks: readonly HudTask[]): RepoGroup[] {
  const groups = new Map<string, HudTask[]>();
  for (const task of tasks) {
    const list = groups.get(task.repo) ?? [];
    list.push(task);
    groups.set(task.repo, list);
  }
  return [...groups].map(([repo, list]) => ({ repo, tasks: list }));
}

/** Open work for the sidebar: needs-you first (decide, blocked, accept), then in progress. */
export function activeTasks(tasks: readonly HudTask[]): HudTask[] {
  return [...needsYouTasks(tasks), ...inProgressTasks(tasks)];
}

export type TaskFilter = 'all' | 'active' | 'needsYou' | 'done';

export function filterTasks(tasks: readonly HudTask[], filter: TaskFilter): HudTask[] {
  switch (filter) {
    case 'active':
      return tasks.filter((task) => isInProgress(task.status));
    case 'needsYou':
      return needsYouTasks(tasks);
    case 'done':
      return tasks.filter((task) => task.status === 'done');
    default:
      return [...tasks];
  }
}

export type HeadlineKind = 'empty' | 'quiet' | 'unclear' | 'moving' | 'waiting';

export interface Headline {
  kind: HeadlineKind;
  inProgress: number;
  needsYou: number;
  /** Tasks whose state could not be read; never counted as "nothing to do". */
  unknown: number;
}

/** What the overview leads with: one plain sentence about whether the user is needed. */
export function headline(tasks: readonly HudTask[]): Headline {
  const summary = summarize(tasks);
  const unknown = tasks.filter((task) => task.status === 'unknown').length;
  const counts = { inProgress: summary.inProgress, needsYou: summary.needsYou, unknown };
  if (summary.total === 0) return { kind: 'empty', ...counts };
  if (summary.needsYou > 0) return { kind: 'waiting', ...counts };
  if (summary.inProgress > 0) return { kind: 'moving', ...counts };
  if (unknown > 0) return { kind: 'unclear', ...counts };
  return { kind: 'quiet', ...counts };
}

/** Shape class for a status (design §6: colour + shape + text). */
export function statusShape(status: TaskStatus): 'pulse' | 'ring' | 'diamond' | 'square' | 'check' | 'dash' {
  if (status === 'running' || status === 'review') return 'pulse';
  if (status === 'rework') return 'ring';
  if (isNeedsYou(status) && status !== 'blocked') return 'diamond';
  if (status === 'blocked') return 'square';
  if (status === 'done') return 'check';
  return 'dash';
}

// ---------------------------------------------------------------------------------------------
// Command palette

export type PaletteAction =
  | { kind: 'go'; route: WorkbenchRoute }
  | { kind: 'source'; source: WorkbenchSource }
  | { kind: 'refresh' }
  | { kind: 'theme' }
  | { kind: 'classic' };

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  action: PaletteAction;
}

/** Case-insensitive match on label, hint and keywords; every whitespace-separated term must hit. */
export function filterCommands(commands: readonly PaletteCommand[], query: string): PaletteCommand[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...commands];
  return commands.filter((command) => {
    const haystack = `${command.label} ${command.hint ?? ''} ${command.keywords}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

// ---------------------------------------------------------------------------------------------
// Theme

export type ThemePreference = 'system' | 'light' | 'dark';

export function nextTheme(current: ThemePreference): ThemePreference {
  return current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}
