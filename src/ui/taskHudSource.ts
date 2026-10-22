import { useSyncExternalStore } from 'react';
import type { GitHubRepoTasks } from './taskHudGithub';
import type { HudTask } from './taskHudModel';

/**
 * Task HUD data source (#53, Spec #50 v1): demo data or a read-only GitHub snapshot per repository.
 * Preferences live in localStorage per viewer; storage failures only mean nothing is remembered.
 * The GitHub result is an in-memory store shared by the HUD and the chat-toolbar entry.
 */

export type HudSource = 'demo' | 'github';

export interface HudPrefs {
  source: HudSource;
  repos: string[];
}

export const DEFAULT_HUD_REPOS: readonly string[] = ['xiaolebao516/ai-one'];
export const MAX_HUD_REPOS = 8;
const PREFS_KEY = 'ai-one.hud.prefs';

/** Same rule as scripts/task-status/snapshot.mjs and the Rust bridge (no dot-only names). */
export function isValidRepoName(repo: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo)) return false;
  return !/^\.+$/.test(repo.split('/')[1]);
}

/** Accepts `owner/repo` or a github.com repository URL; returns `owner/repo` or undefined. */
export function parseRepoInput(input: string): string | undefined {
  let text = input.trim();
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)/i.exec(text);
  if (url) text = `${url[1]}/${url[2]}`;
  text = text.replace(/\.git$/i, '');
  return isValidRepoName(text) ? text : undefined;
}

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function normalizePrefs(value: unknown): HudPrefs {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const source: HudSource = record.source === 'github' ? 'github' : 'demo';
  const repos = Array.isArray(record.repos)
    ? [...new Set(record.repos.filter((repo): repo is string => typeof repo === 'string' && isValidRepoName(repo)))].slice(0, MAX_HUD_REPOS)
    : [...DEFAULT_HUD_REPOS];
  return { source, repos };
}

function readPrefs(): HudPrefs {
  try {
    const raw = storage()?.getItem(PREFS_KEY);
    return normalizePrefs(raw ? JSON.parse(raw) : undefined);
  } catch {
    return normalizePrefs(undefined);
  }
}

let prefs: HudPrefs = readPrefs();
const prefListeners = new Set<() => void>();

export function getHudPrefs(): HudPrefs {
  return prefs;
}

export function setHudPrefs(next: Partial<HudPrefs>): void {
  prefs = normalizePrefs({ ...prefs, ...next });
  try {
    storage()?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not persisted; the in-memory value still applies.
  }
  for (const listener of [...prefListeners]) listener();
}

function subscribePrefs(listener: () => void): () => void {
  prefListeners.add(listener);
  return () => prefListeners.delete(listener);
}

const SERVER_PREFS = normalizePrefs(undefined);

export function useHudPrefs(): HudPrefs {
  return useSyncExternalStore(subscribePrefs, getHudPrefs, () => SERVER_PREFS);
}

// ---------------------------------------------------------------------------------------------
// GitHub snapshot store

export interface GitHubDataState {
  phase: 'idle' | 'loading' | 'done';
  results: GitHubRepoTasks[];
  /** Repositories the current results (or the running load) are for. */
  repos: string[];
  finishedAt?: string;
}

export type GitHubLoader = (repos: readonly string[]) => Promise<GitHubRepoTasks[]>;

const IDLE: GitHubDataState = { phase: 'idle', results: [], repos: [] };
let github: GitHubDataState = IDLE;
let generation = 0;
const githubListeners = new Set<() => void>();

function setGitHub(next: GitHubDataState): void {
  github = next;
  for (const listener of [...githubListeners]) listener();
}

export function getGitHubData(): GitHubDataState {
  return github;
}

/**
 * Loads every repository once. A newer request supersedes an older one: a slow earlier response
 * never overwrites newer results. The loader itself isolates per-repository failures.
 */
export async function refreshGitHubData(repos: readonly string[], loader: GitHubLoader, now: () => Date = () => new Date()): Promise<void> {
  const mine = ++generation;
  const list = [...repos];
  setGitHub({ ...github, phase: 'loading', repos: list });
  let results: GitHubRepoTasks[];
  try {
    results = await loader(list);
  } catch {
    const observedAt = now().toISOString();
    results = list.map((repo) => ({
      repo,
      tasks: [],
      status: 'error' as const,
      errors: [{ url: '', observedAt, message: 'GitHub snapshot could not be collected.' }],
      pagination: {},
      observedAt,
    }));
  }
  if (mine !== generation) return;
  setGitHub({ phase: 'done', results, repos: list, finishedAt: now().toISOString() });
}

export function resetGitHubData(): void {
  generation += 1;
  setGitHub(IDLE);
}

function subscribeGitHub(listener: () => void): () => void {
  githubListeners.add(listener);
  return () => githubListeners.delete(listener);
}

export function useGitHubData(): GitHubDataState {
  return useSyncExternalStore(subscribeGitHub, getGitHubData, () => IDLE);
}

// ---------------------------------------------------------------------------------------------
// Derived views

export type GitHubOverall = 'none' | 'complete' | 'partial' | 'error';

export function githubTasks(state: GitHubDataState): HudTask[] {
  return state.results.flatMap((result) => result.tasks);
}

/** `error` only when nothing could be read; any mix of failures and data is `partial`. */
export function githubOverall(state: GitHubDataState): GitHubOverall {
  if (state.phase !== 'done' || state.results.length === 0) return 'none';
  if (state.results.every((result) => result.status === 'error')) return 'error';
  if (state.results.every((result) => result.status === 'complete')) return 'complete';
  return 'partial';
}

/** Pagination says more items may exist for this repository. */
export function mayHaveMore(result: GitHubRepoTasks): boolean {
  return Object.values(result.pagination).some((entry) => entry && (entry.more !== 'no' || entry.earlierPagesOmitted));
}

/** Distinct error messages for display; the bridge only ever returns fixed sentences. */
export function errorMessages(result: GitHubRepoTasks): string[] {
  return [...new Set(result.errors.map((error) => error.message))];
}
