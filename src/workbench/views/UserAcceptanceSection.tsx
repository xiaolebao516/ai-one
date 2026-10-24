import { useState } from 'react';
import type { Locale } from '../../i18n/resolve';
import { Button, Card, Notice } from '../../ui/v2';
import { workbenchText } from '../workbenchText';
import type { AcceptanceState } from '../useUserAcceptance';
import { needsNewDecision, type FixProgress } from '../acceptanceFix';

const FIX_TEXT: Record<FixProgress, 'acceptanceFixCreating' | 'acceptanceFixUnknown' | 'acceptanceFixFailed' | 'acceptanceFixQueued' | 'acceptanceFixWorking' | 'acceptanceFixDone' | 'acceptanceFixDropped'> = {
  creating: 'acceptanceFixCreating', unknown: 'acceptanceFixUnknown', failed: 'acceptanceFixFailed',
  queued: 'acceptanceFixQueued', working: 'acceptanceFixWorking', done: 'acceptanceFixDone', dropped: 'acceptanceFixDropped',
};

export function UserAcceptanceSection({ locale, state, demo }: {
  locale: Locale; state: AcceptanceState; demo: boolean;
}) {
  const text = workbenchText(locale);
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
                    {progress === 'failed' ? (
                      <div><Button size="sm" disabled={state.storageError} onClick={() => { void state.retryFix(item); }}>{text.t('acceptanceFixRetry')}</Button></div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-v2-sm">
                      <Button size="sm" variant="attention" disabled={state.storageError} onClick={() => { void state.submit(item, 'approved'); }}>
                        {text.t('acceptanceApprove')}
                      </Button>
                      <Button size="sm" disabled={state.storageError} onClick={() => { setEditing(item.key); setFeedback(''); }}>
                        {text.t('acceptanceReport')}
                      </Button>
                    </div>
                    {editing === item.key ? (
                      <div className="grid gap-v2-sm">
                        <label className="text-v2-meta font-semibold text-v2-ink" htmlFor={`acceptance-feedback-${item.key}`}>{text.t('acceptanceFeedbackLabel')}</label>
                        <textarea id={`acceptance-feedback-${item.key}`} value={feedback} onChange={(event) => setFeedback(event.target.value)}
                          rows={2} maxLength={3000} className="w-full rounded-v2-md border border-v2-line bg-v2-bg p-v2-sm text-v2-body text-v2-ink" />
                        <div className="flex gap-v2-sm">
                          <Button size="sm" disabled={!feedback.trim() || state.storageError} onClick={() => {
                            void state.submit(item, 'feedback', feedback); setEditing(null);
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
