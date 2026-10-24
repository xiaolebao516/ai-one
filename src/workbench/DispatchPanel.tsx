import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '../i18n/resolve';
import { dispatchLaunch, type DispatchAgent, type DispatchCode, type DispatchLaunchApi, type DispatchLaunchResult, type DispatchMode, type DispatchRun } from '../host/dispatchLaunch';
import { Button, Notice } from '../ui/v2';
import { copyToClipboard } from './clipboard';
import { workbenchText } from './workbenchText';

const PREFS_KEY = 'ai-one.dispatch.launch.v1';
interface LaunchPrefs { agent: DispatchAgent; mode: DispatchMode; workdir: string }
const DEFAULT_PREFS: LaunchPrefs = { agent: 'claude', mode: 'desktop', workdir: '' };

function readPrefs(): LaunchPrefs {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null');
    if (value && typeof value === 'object') {
      const row = value as Partial<LaunchPrefs>;
      return {
        agent: row.agent === 'codex' ? 'codex' : 'claude',
        mode: row.mode === 'cli' ? 'cli' : 'desktop',
        workdir: typeof row.workdir === 'string' ? row.workdir.slice(0, 1024) : '',
      };
    }
  } catch { /* storage is a convenience only */ }
  return DEFAULT_PREFS;
}
function savePrefs(prefs: LaunchPrefs): void {
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

const FAILURE_TEXT: Record<Exclude<DispatchCode, 'launched' | 'opened'>, 'launchInvalid' | 'launchWorkdirInvalid' | 'launchNoProgram' | 'launchSpawnFailed' | 'launchOpenFailed' | 'launchAlreadyRunning' | 'launchIssueUnverified' | 'launchUnknown'> = {
  invalid_input: 'launchInvalid', workdir_invalid: 'launchWorkdirInvalid', program_not_found: 'launchNoProgram',
  spawn_failed: 'launchSpawnFailed', open_failed: 'launchOpenFailed', already_running: 'launchAlreadyRunning',
  issue_unverified: 'launchIssueUnverified', unavailable: 'launchUnknown',
};

export function DispatchPanel({ locale, repo, issue, api = dispatchLaunch, onCopy = copyToClipboard }: {
  locale: Locale; repo: string; issue: number; api?: DispatchLaunchApi; onCopy?: (value: string) => Promise<void>;
}) {
  const text = workbenchText(locale);
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<LaunchPrefs>(readPrefs);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DispatchLaunchResult & { copied?: boolean }>();
  const [runs, setRuns] = useState<DispatchRun[]>([]);
  const sending = useRef(false);
  const update = (patch: Partial<LaunchPrefs>) => setPrefs((current) => { const next = { ...current, ...patch }; savePrefs(next); return next; });

  const refresh = useCallback(async () => {
    const value = await api.runs();
    setRuns(value.runs.filter((run) => run.repo.toLowerCase() === repo.toLowerCase() && run.issue === issue));
    if (value.defaultWorkdir) setPrefs((current) => current.workdir ? current : { ...current, workdir: value.defaultWorkdir ?? '' });
  }, [api, repo, issue]);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  const running = runs.some((run) => run.state === 'running');
  useEffect(() => {
    if (!open || !running) return;
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [open, running, refresh]);

  const go = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setResult(undefined);
    try {
      const outcome = await api.launch({ agent: prefs.agent, mode: prefs.mode, repo, issue, workdir: prefs.workdir.trim() });
      let copied: boolean | undefined;
      if (outcome.ok && outcome.code === 'opened' && outcome.prompt) {
        copied = await onCopy(outcome.prompt).then(() => true, () => false);
      }
      setResult({ ...outcome, ...(copied === undefined ? {} : { copied }) });
      if (outcome.code === 'launched') void refresh();
    } finally { sending.current = false; setBusy(false); }
  };

  const name = prefs.agent === 'claude' ? 'Claude Code' : 'Codex';
  return (
    <div className="grid gap-v2-sm">
      <div>
        <Button size="sm" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {text.t('launchButton')}
        </Button>
      </div>
      {open ? (
        <div className="grid gap-v2-sm rounded-v2-md border border-v2-line bg-v2-bg p-v2-sm" role="group" aria-label={text.t('launchTitle')}>
          <fieldset className="flex flex-wrap items-center gap-v2-md">
            <legend className="mb-v2-xs text-v2-meta font-semibold text-v2-ink">{text.t('launchAgent')}</legend>
            {(['claude', 'codex'] as const).map((agent) => (
              <label key={agent} className="flex items-center gap-v2-xs text-v2-body text-v2-ink">
                <input type="radio" name={`launch-agent-${repo}-${issue}`} checked={prefs.agent === agent} onChange={() => update({ agent })} />
                {agent === 'claude' ? 'Claude Code' : 'Codex'}
              </label>
            ))}
          </fieldset>
          <fieldset className="grid gap-v2-xs">
            <legend className="mb-v2-xs text-v2-meta font-semibold text-v2-ink">{text.t('launchMode')}</legend>
            {(['desktop', 'cli'] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-v2-xs text-v2-body text-v2-ink">
                <input type="radio" name={`launch-mode-${repo}-${issue}`} checked={prefs.mode === mode} onChange={() => update({ mode })} />
                {text.t(mode === 'desktop' ? 'launchModeDesktop' : 'launchModeCli')}
              </label>
            ))}
            {prefs.mode === 'cli' ? (
              <>
                <p className="text-v2-meta text-v2-ink-2">{text.t(prefs.agent === 'claude' ? 'launchCliClaudeNote' : 'launchCliCodexNote')}</p>
                <p className="text-v2-meta text-v2-ink-2">{text.t('launchCliWarning')}</p>
              </>
            ) : null}
          </fieldset>
          <div className="grid gap-v2-xs">
            <label htmlFor={`launch-workdir-${repo}-${issue}`} className="text-v2-meta font-semibold text-v2-ink">{text.t('launchWorkdir')}</label>
            <input id={`launch-workdir-${repo}-${issue}`} value={prefs.workdir} onChange={(event) => update({ workdir: event.target.value })}
              maxLength={1024} className="w-full rounded-v2-md border border-v2-line bg-v2-surface p-v2-sm text-v2-body text-v2-ink" />
            <span className="text-v2-micro text-v2-ink-3">{text.t('launchWorkdirHint')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-v2-sm">
            <Button size="sm" variant="attention" disabled={busy || !prefs.workdir.trim()} onClick={() => { void go(); }}>
              {busy ? text.t('launchBusy') : text.t('launchGo', { agent: name })}
            </Button>
          </div>
          {result ? (
            result.ok ? (
              <Notice tone="done" live="polite" title={result.code === 'opened'
                ? text.t(result.copied === false ? 'launchOpenedNoCopy' : 'launchOpened')
                : text.t('launchLaunched', { pid: result.pid ?? '?' })}>
                {result.code === 'opened' && result.prompt ? <p className="mt-v2-xs whitespace-pre-wrap break-words text-v2-meta">{text.t('launchPromptLabel')}：{result.prompt}</p> : null}
              </Notice>
            ) : (
              <Notice tone="block" live="assertive" title={text.t(FAILURE_TEXT[result.code as keyof typeof FAILURE_TEXT] ?? 'launchUnknown')}>
                {result.prompt ? <p className="mt-v2-xs whitespace-pre-wrap break-words text-v2-meta">{text.t('launchPromptLabel')}：{result.prompt}</p> : null}
              </Notice>
            )
          ) : null}
          {runs.length ? (
            <div className="grid gap-v2-xs">
              <strong className="text-v2-meta text-v2-ink">{text.t('launchRuns')}</strong>
              {runs.map((run) => (
                <details key={run.runId} className="text-v2-meta text-v2-ink-2">
                  <summary>
                    {run.agent === 'claude' ? 'Claude Code' : 'Codex'} · {new Date(run.startedAt).toLocaleString(locale)} · {' '}
                    {run.state === 'running' ? text.t('launchRunRunning')
                      : run.state === 'exited' ? text.t('launchRunExited', { code: run.exitCode ?? '?' }) : text.t('launchRunLost')}
                  </summary>
                  <pre className="mt-v2-xs max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-v2-md bg-v2-surface p-v2-sm">{run.tail || text.t('launchRunNoOutput')}</pre>
                </details>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
