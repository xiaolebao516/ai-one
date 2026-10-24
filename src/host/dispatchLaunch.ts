import { invoke } from '@tauri-apps/api/core';

/** One-click dispatch (Spec #155 C). Rust builds the prompt, program and arguments; the page only names them. */
export type DispatchAgent = 'claude' | 'codex';
export type DispatchMode = 'desktop' | 'cli';
export interface DispatchLaunchArgs {
  agent: DispatchAgent;
  mode: DispatchMode;
  repo: string;
  issue: number;
  workdir: string;
}
export type DispatchCode =
  | 'launched' | 'opened' | 'invalid_input' | 'workdir_invalid' | 'program_not_found'
  | 'spawn_failed' | 'open_failed' | 'unavailable';
export interface DispatchLaunchResult { ok: boolean; code: DispatchCode; prompt?: string; runId?: string; pid?: number }
export type DispatchRunState = 'running' | 'exited' | 'lost';
export interface DispatchRun {
  runId: string; agent: DispatchAgent; repo: string; issue: number; pid: number;
  startedAt: number; state: DispatchRunState; exitCode: number | null; tail: string;
}
export interface DispatchRuns { runs: DispatchRun[]; defaultWorkdir?: string }

const CODES = new Set<DispatchCode>([
  'launched', 'opened', 'invalid_input', 'workdir_invalid', 'program_not_found', 'spawn_failed', 'open_failed',
]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function parseLaunchResult(raw: unknown): DispatchLaunchResult {
  try {
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!isRecord(value) || typeof value.ok !== 'boolean' || !CODES.has(value.code as DispatchCode)) {
      return { ok: false, code: 'unavailable' };
    }
    const code = value.code as DispatchCode;
    // Success wording is reserved for the two success codes, never for a failure that claims ok.
    if (value.ok !== (code === 'launched' || code === 'opened')) return { ok: false, code: 'unavailable' };
    return {
      ok: value.ok, code,
      ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
      ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
      ...(Number.isSafeInteger(value.pid) ? { pid: value.pid as number } : {}),
    };
  } catch { return { ok: false, code: 'unavailable' }; }
}

export function parseRuns(raw: unknown): DispatchRuns {
  try {
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!isRecord(value) || !Array.isArray(value.runs)) return { runs: [] };
    const runs = value.runs.filter((run): run is Record<string, unknown> => isRecord(run)
      && typeof run.runId === 'string' && (run.agent === 'claude' || run.agent === 'codex')
      && typeof run.repo === 'string' && Number.isSafeInteger(run.issue) && Number.isSafeInteger(run.pid)
      && ['running', 'exited', 'lost'].includes(run.state as string))
      .map((run) => ({
        runId: run.runId as string, agent: run.agent as DispatchAgent, repo: run.repo as string,
        issue: run.issue as number, pid: run.pid as number,
        startedAt: Number.isFinite(run.startedAt) ? (run.startedAt as number) : 0,
        state: run.state as DispatchRunState,
        exitCode: Number.isSafeInteger(run.exitCode) ? (run.exitCode as number) : null,
        tail: typeof run.tail === 'string' ? run.tail : '',
      }));
    return { runs, ...(typeof value.defaultWorkdir === 'string' ? { defaultWorkdir: value.defaultWorkdir } : {}) };
  } catch { return { runs: [] }; }
}

export interface DispatchLaunchApi {
  launch(args: DispatchLaunchArgs): Promise<DispatchLaunchResult>;
  runs(): Promise<DispatchRuns>;
}

export const dispatchLaunch: DispatchLaunchApi = {
  async launch(args) {
    try { return parseLaunchResult(await invoke<unknown>('dispatch_launch', { args })); }
    catch { return { ok: false, code: 'unavailable' }; }
  },
  async runs() {
    try { return parseRuns(await invoke<unknown>('dispatch_runs')); }
    catch { return { runs: [] }; }
  },
};
