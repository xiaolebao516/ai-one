import { useCallback, useEffect, useRef, useState } from 'react';
import { host } from '../host';
import { TASK_HUD_MOCK_TASKS } from '../ui/taskHudMockData';
import { loadGitHubTasks, type GitHubApi, type GitHubRepoTasks } from '../ui/taskHudGithub';
import type { HudTask } from '../ui/taskHudModel';
import { MAX_REPOS, normalizeRepo, type ThemePreference, type WorkbenchSource } from './workbenchModel';
import { loadPrefs, savePrefs, type WorkbenchPrefs } from './workbenchStorage';

export type RepoNotice =
  | { kind: 'error'; repo: string; message: string }
  | { kind: 'partial'; repo: string }
  | { kind: 'more'; repo: string };

/** What the UI must say about each repository read, so a failed read never looks like "no tasks". */
export function repoNotices(results: readonly GitHubRepoTasks[]): RepoNotice[] {
  const notices: RepoNotice[] = [];
  for (const result of results) {
    if (result.status === 'error') {
      notices.push({ kind: 'error', repo: result.repo, message: result.errors[0]?.message ?? '' });
      continue;
    }
    if (result.status === 'partial') notices.push({ kind: 'partial', repo: result.repo });
    if (Object.values(result.pagination).some((page) => page && page.more !== 'no')) notices.push({ kind: 'more', repo: result.repo });
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
 * Whether the task list can be read as "this is all there is". Only `demo` and `ok` can; while
 * loading, or when every repository failed, an empty list means "unknown", never "nothing to do".
 */
export type DataHealth = 'demo' | 'loading' | 'failed' | 'ok';

export function dataHealth(source: WorkbenchSource, github: GitHubReadState): DataHealth {
  if (source === 'demo') return 'demo';
  if (github.results.length === 0) return 'loading';
  if (github.results.every((result) => result.status === 'error')) return github.loading ? 'loading' : 'failed';
  return 'ok';
}

export interface GitHubReadState {
  loading: boolean;
  results: GitHubRepoTasks[];
}

export interface WorkbenchData {
  prefs: WorkbenchPrefs;
  tasks: readonly HudTask[];
  health: DataHealth;
  github: GitHubReadState;
  setSource: (source: WorkbenchSource) => void;
  setTheme: (theme: ThemePreference) => void;
  /** Returns false when the input is not a repository. */
  addRepo: (input: string) => boolean;
  removeRepo: (repo: string) => void;
  refresh: () => void;
}

export function useWorkbenchData(api: GitHubApi = host.github): WorkbenchData {
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
    // A slower earlier request must not overwrite a newer one (source flip, repo edit, refresh).
    const request = ++requestRef.current;
    setGithub((current) => ({ ...current, loading: true }));
    void loadGitHubTasks(reposKey.split('\n').filter(Boolean), api, { limit: 20 }).then((results) => {
      if (request === requestRef.current) setGithub({ loading: false, results });
    });
  }, [api, prefs.source, reposKey, refreshToken]);

  const tasks = prefs.source === 'github' ? github.results.flatMap((result) => result.tasks) : TASK_HUD_MOCK_TASKS;

  return {
    prefs,
    tasks,
    health: dataHealth(prefs.source, github),
    github,
    setSource: (source) => update({ source }),
    setTheme: (theme) => update({ theme }),
    addRepo: (input) => {
      const repo = normalizeRepo(input);
      if (!repo) return false;
      if (!prefs.repos.includes(repo) && prefs.repos.length < MAX_REPOS) update({ repos: [...prefs.repos, repo] });
      return true;
    },
    removeRepo: (repo) => {
      const repos = prefs.repos.filter((item) => item !== repo);
      if (repos.length) update({ repos });
    },
    refresh: () => setRefreshToken((token) => token + 1),
  };
}
