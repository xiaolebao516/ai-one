import { useState } from 'react';
import type { Locale } from '../../i18n/resolve';
import { Button, Card, Notice } from '../../ui/v2';
import { workbenchText } from '../workbenchText';
import type { AcceptanceState } from '../useUserAcceptance';
import { host } from '../../host';
import { hasChoice } from '../acceptanceActions';
import { needsNewDecision, type FixProgress } from '../acceptanceFix';

const FIX_TEXT: Record<FixProgress, 'acceptanceFixNotStarted' | 'acceptanceFixCreating' | 'acceptanceFixUnknown' | 'acceptanceFixFailed' | 'acceptanceFixQueued' | 'acceptanceFixWorking' | 'acceptanceFixDone' | 'acceptanceFixDropped'> = {
  notStarted: 'acceptanceFixNotStarted', creating: 'acceptanceFixCreating', unknown: 'acceptanceFixUnknown', failed: 'acceptanceFixFailed',
  queued: 'acceptanceFixQueued', working: 'acceptanceFixWorking', done: 'acceptanceFixDone', dropped: 'acceptanceFixDropped',
};

const copyToClipboard = async (value: string): Promise<void> => {
  if (!navigator.clipboard) throw new Error('Clipboard unavailable');
  await navigator.clipboard.writeText(value);
};
export function UserAcceptanceSection({ locale, state, demo, onCopy = copyToClipboard, onOpen = host.app.openExternal }: {
  locale: Locale; state: AcceptanceState; demo: boolean;
  onCopy?: (value: string) => Promise<void>; onOpen?: (url: string) => Promise<void>;
}) {
  const text = workbenchText(locale);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const note = (key: string, value: string) => setNotes((current) => ({ ...current, [key]: value }));
  const [editing, setEditing] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const visible = state.items.filter((item) => !state.records[item.key] || state.records[item.key].kind === 'feedback');
  // A local decision must remain visible as an unsynced notice even after its card disappears.
  const pending = Object.values(state.records).filter((r) => r.sync !== 'confirmed');
  if (demo) return null;
  if (!visible.length && !pending.length && !state.loading && !state.partial && !state.storageError) return null;
  return (
    <section aria-labelledby="home-acceptances" className="rounded-v2-xl border-2 border-v2-you bg-v2-surface p-v2-lg">
      <h2 id="home-acceptances" className="font-v2-serif text-v2-lead font-bold text-v2-ink">
        {text.t('acceptanceHeading', { n: state.loading ? '?' : state.partial ? `≥${visible.length}` : visible.length })}
      </h2>
      <p className="mt-v2-xs text-v2-meta text-v2-ink-2">{text.t('acceptanceHint')}</p>
      {state.loading ? <p role="status" className="mt-v2-sm">{text.t('acceptanceLoading')}</p> : null}
      {state.partial ? <Notice tone="unknown" className="mt-v2-sm" title={text.t('acceptancePartial')} /> : null}
      {state.storageError ? <Notice tone="block" live="assertive" className="mt-v2-sm" title={text.t(state.storageErrorPhase === 'after-write' ? 'acceptanceResultStorageFailed' : 'acceptanceStorageFailed')} /> : null}
      {pending.length ? (
        <Notice tone="unknown" live="polite" className="mt-v2-sm" title={text.t('acceptanceNotSynced')}>
          {pending.map((r) => <p key={r.key}>{r.repo} #{r.issue}: {r.title} — {r.sync === 'unconfirmed' ? text.t('acceptanceUncertain') : text.t('acceptanceUnsynced')}</p>)}
        </Notice>
      ) : null}
      {visible.length ? (
        <ul className="mt-v2-md grid gap-v2-sm">
          {visible.map((item) => {
            const progress = state.progress[item.key];
            const record = needsNewDecision(progress) ? undefined : state.records[item.key];
            const fixNumber = state.records[item.key]?.fix?.issue;
            return <li key={item.key}>
              <Card accent="you" className="grid gap-v2-sm">
                <div className="flex flex-wrap items-center gap-v2-sm">
                  <strong className="text-v2-body text-v2-ink">{item.title}</strong>
                  <span className="text-v2-micro text-v2-ink-3">{item.repo} #{item.issue}</span>
                </div>
                {item.raw ? (
                  <div className="whitespace-pre-wrap break-words text-v2-body text-v2-ink-2">{item.raw}</div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-v2-body text-v2-ink-2"><strong>{text.t('acceptanceSteps')}：</strong>{item.steps}</p>
                    <p className="whitespace-pre-wrap text-v2-body text-v2-ink-2"><strong>{text.t('acceptanceExpected')}：</strong>{item.expected}</p>
                  </>
                )}
                {progress && fixNumber !== undefined && needsNewDecision(progress) ? (
                  <Notice tone="you" live="polite" title={text.t(FIX_TEXT[progress], { n: fixNumber })} />
                ) : null}
                {record ? (
                  <>
                    <p role="status" className="text-v2-meta text-v2-ink-2">
                      {progress ? text.t(FIX_TEXT[progress], { n: fixNumber ?? '?' })
                        : record.sync === 'confirmed' ? text.t('acceptanceFeedbackSent') : text.t('acceptanceNotSynced')}
                    </p>
                    {progress === 'failed' || progress === 'notStarted' ? (
                      <div><Button size="sm" disabled={state.storageError} onClick={() => { void state.retryFix(item); }}>{text.t(progress === 'notStarted' ? 'acceptanceFixContinue' : 'acceptanceFixRetry')}</Button></div>
                    ) : null}
                  </>
                ) : (
                  <>
                    {item.actions?.map((action, index) => {
                      const id = `${item.key}:${index}`;
                      if (action.kind === 'command') return (
                        <div key={id} className="grid gap-v2-xs">
                          <code className="block overflow-x-auto whitespace-pre rounded-v2-md border border-v2-line bg-v2-bg p-v2-sm text-v2-meta text-v2-ink">{action.value}</code>
                          <div className="flex flex-wrap items-center gap-v2-sm">
                            <Button size="sm" onClick={() => { void onCopy(action.value).then(() => note(id, text.t('acceptanceCopied')), () => note(id, text.t('acceptanceCopyFailed'))); }}>
                              {text.t('acceptanceCopy')}
                            </Button>
                            {notes[id] ? <span role="status" className="text-v2-meta text-v2-ink-2">{notes[id]}</span> : null}
                          </div>
                        </div>
                      );
                      if (action.kind === 'open') return action.url ? (
                        <div key={id} className="flex flex-wrap items-center gap-v2-sm">
                          <Button size="sm" onClick={() => { void onOpen(action.url!).then(() => note(id, ''), () => note(id, text.t('acceptanceOpenFailed', { value: action.url! }))); }}>
                            {text.t('acceptanceOpen')}
                          </Button>
                          <span className="break-all text-v2-micro text-v2-ink-3">{action.value}</span>
                          {notes[id] ? <span role="status" className="text-v2-meta text-v2-ink-2">{notes[id]}</span> : null}
                        </div>
                      ) : <p key={id} className="text-v2-body text-v2-ink-2">{text.t('acceptanceLocation', { value: action.value })}</p>;
                      if (action.kind === 'manual') return (
                        <Notice key={id} tone="you" title={text.t('acceptanceManual', { value: action.value })}>
                          <p>{text.t('acceptanceManualHint')}</p>
                        </Notice>
                      );
                      return (
                        <div key={id} className="flex flex-wrap gap-v2-sm">
                          {action.options.map((option) => (
                            <Button key={option} size="sm" variant="attention" disabled={state.storageError}
                              onClick={() => { void state.submit(item, 'choice', option); }}>{option}</Button>
                          ))}
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap gap-v2-sm">
                      {hasChoice(item.actions) ? null : (
                        <Button size="sm" variant="attention" disabled={state.storageError}
                          onClick={() => { void state.submit(item, item.actions?.length ? 'done' : 'approved'); }}>
                          {text.t(item.actions?.length ? 'acceptanceDone' : 'acceptanceApprove')}
                        </Button>
                      )}
                      <Button size="sm" disabled={state.storageError} onClick={() => { setEditing(item.key); setFeedback(''); }}>
                        {text.t(item.actions?.length ? 'acceptanceCannot' : 'acceptanceReport')}
                      </Button>
                    </div>
                    {editing === item.key ? (
                      <div className="grid gap-v2-sm">
                        <label className="text-v2-meta font-semibold text-v2-ink" htmlFor={`acceptance-feedback-${item.key}`}>{text.t('acceptanceFeedbackLabel')}</label>
                        <textarea id={`acceptance-feedback-${item.key}`} value={feedback} onChange={(event) => setFeedback(event.target.value)}
                          rows={2} maxLength={3000} className="w-full rounded-v2-md border border-v2-line bg-v2-bg p-v2-sm text-v2-body text-v2-ink" />
                        <div className="flex gap-v2-sm">
                          <Button size="sm" disabled={!feedback.trim() || state.storageError} onClick={() => {
                            void state.submit(item, 'feedback', (item.actions?.length ? `${text.t('acceptanceCannot')}：` : '') + feedback); setEditing(null);
                          }}>{text.t('acceptanceSend')}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{text.t('acceptanceCancel')}</Button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </Card>
            </li>;
          })}
        </ul>
      ) : null}
    </section>
  );
}
export function pendingAcceptanceCount(state: AcceptanceState): number {
  return state.items.filter((item) => !state.records[item.key] || state.records[item.key].kind === 'feedback').length;
}
export function acceptanceIssueKeys(state: AcceptanceState): Set<string> {
  return new Set(state.items.map((item) => item.repo.toLowerCase() + ':' + item.issue));
}
