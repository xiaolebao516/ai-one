import { useCallback, useEffect, useRef, useState } from 'react';
import { host } from '../host';
import { TASK_HUD_MOCK_TASKS } from '../ui/taskHudMockData';
import { loadGitHubTasks, type GitHubRepoTasks } from '../ui/taskHudGithub';
import type { HudTask } from '../ui/taskHudModel';
import { MAX_REPOS, normalizeRepo, type ThemePreference, type WorkbenchSource } from './workbenchModel';
import { loadPrefs, savePrefs, type WorkbenchPrefs } from './workbenchStorage';

export type RepoNotice =
  | { kind: 'error'; repo: string; message: string }
  | { kind: 'partial'; repo: string }
  | { kind: 'more'; repo: string };

function hasMore(result: GitHubRepoTasks): boolean {
  return Object.values(result.pagination).some((page) => page && page.more !== 'no');
}

/** What the UI must say about each repository read, so a failed read never looks like "no tasks". */
export function repoNotices(results: readonly GitHubRepoTasks[]): RepoNotice[] {
  const notices: RepoNotice[] = [];
  for (const result of results) {
    if (result.status === 'error') {
      notices.push({ kind: 'error', repo: result.repo, message: result.errors[0]?.message ?? '' });
      continue;
    }
    if (result.status === 'partial') notices.push({ kind: 'partial', repo: result.repo });
    if (hasMore(result)) notices.push({ kind: 'more', repo: result.repo });
  }
  return notices;
}

/** Latest successful observation across repositories; a failed read is not an observation. */
export function observedAt(results: readonly GitHubRepoTasks[]): string | undefined {
  return results
    .filter((result) => result.status !== 'error')
    .map((result) => result.observedAt)
    .sort()
    .at(-1);
}

/**
 * How far the task list can be trusted:
 * - `demo` / `complete`: the list is everything there is, so counts and "nothing here" are true.
 * - `partial`: some of it was read (a repository failed, a read was partial or has more pages);
 *   counts are "at least", and "nothing here" only means "nothing in what was read".
 * - `loading` / `failed`: nothing current is known; counts are unknown.
 */
export type DataHealth = 'demo' | 'loading' | 'failed' | 'partial' | 'complete';

export function dataHealth(source: WorkbenchSource, github: GitHubReadState, reposKey: string): DataHealth {
  if (source === 'demo') return 'demo';
  // A refresh, a repository edit or a source flip makes the stored snapshot old: not current facts.
  if (github.loading || github.reposKey !== reposKey) return 'loading';
  const { results } = github;
  if (results.length === 0 || results.every((result) => result.status === 'error')) return 'failed';
  if (results.some((result) => result.status !== 'complete' || hasMore(result))) return 'partial';
  return 'complete';
}

/** Counts and empty states are exact only for these. */
export function isExact(health: DataHealth): boolean {
  return health === 'demo' || health === 'complete';
}

/** Counts mean something (exactly or as "at least") only for these. */
export function isCountable(health: DataHealth): boolean {
  return isExact(health) || health === 'partial';
}

export interface GitHubReadState {
  loading: boolean;
  /** Which repository set `results` were read for; undefined before the first read. */
  reposKey?: string;
  results: GitHubRepoTasks[];
}

export type AddRepoResult = 'added' | 'present' | 'invalid' | 'full';

export interface WorkbenchData {
  prefs: WorkbenchPrefs;
  tasks: readonly HudTask[];
  health: DataHealth;
  github: GitHubReadState;
  setSource: (source: WorkbenchSource) => void;
  setTheme: (theme: ThemePreference) => void;
  addRepo: (input: string) => AddRepoResult;
  removeRepo: (repo: string) => void;
  refresh: () => void;
}

export type GitHubLoader = (repos: readonly string[]) => Promise<GitHubRepoTasks[]>;

const readGitHub: GitHubLoader = (repos) => loadGitHubTasks(repos, host.github, { limit: 20 });

export function useWorkbenchData(load: GitHubLoader = readGitHub): WorkbenchData {
  const [prefs, setPrefs] = useState<WorkbenchPrefs>(() => loadPrefs());
  const [github, setGithub] = useState<GitHubReadState>({ loading: false, results: [] });
  const [refreshToken, setRefreshToken] = useState(0);
  const requestRef = useRef(0);

  const update = useCallback((patch: Partial<WorkbenchPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  const reposKey = prefs.repos.join('\n');
  useEffect(() => {
    if (prefs.source !== 'github') return;
    const request = ++requestRef.current;
    setGithub((current) => ({ ...current, loading: true }));
    void load(reposKey.split('\n').filter(Boolean)).then((results) => {
      if (request === requestRef.current) setGithub({ loading: false, reposKey, results });
    });
    // Leaving GitHub, editing repositories or refreshing invalidates this request: a late answer
    // must not land after the user moved on.
    return () => {
      requestRef.current += 1;
    };
  }, [load, prefs.source, reposKey, refreshToken]);

  const health = dataHealth(prefs.source, github, reposKey);
  // Same repositories: the last snapshot stays visible while it refreshes (health says it is not
  // current). Different repositories: nothing is shown until they are read.
  const tasks =
    prefs.source === 'demo' ? TASK_HUD_MOCK_TASKS : github.reposKey === reposKey ? github.results.flatMap((result) => result.tasks) : [];

  return {
    prefs,
    tasks,
    health,
    github,
    setSource: (source) => update({ source }),
    setTheme: (theme) => update({ theme }),
    addRepo: (input) => {
      const repo = normalizeRepo(input);
      if (!repo) return 'invalid';
      if (prefs.repos.includes(repo)) return 'present';
      if (prefs.repos.length >= MAX_REPOS) return 'full';
      update({ repos: [...prefs.repos, repo] });
      return 'added';
    },
    removeRepo: (repo) => {
      const repos = prefs.repos.filter((item) => item !== repo);
      if (repos.length) update({ repos });
    },
    refresh: () => setRefreshToken((token) => token + 1),
  };
}
