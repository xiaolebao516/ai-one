import { useEffect, useState } from 'react';
import { host } from '../../host';
import { normalizeRepo } from '../workbenchModel';
import type { Locale } from '../../i18n/resolve';
import { Badge, Button, Card, Notice, SectionHeader } from '../../ui/v2';
import { DiscussionMatrix } from '../../stages/DiscussionMatrix';
import { SummaryCard } from '../../stages/SummaryCard';
import { discussionText } from '../../stages/discussionText';
import { discussionIssueBody, discussionSummary, type LocalTask } from '../../stages/localTasks';
import type { LocalTasksState } from '../../stages/useLocalTasks';
import type { WorkbenchSource } from '../workbenchModel';

export function DiscussionTaskView({ task, store, locale, source, defaultRepo, onBack }: {
  task: LocalTask; store: LocalTasksState; locale: Locale; source: WorkbenchSource;
  defaultRepo: string; onBack: () => void;
}) {
  const t = discussionText(locale);
  const [repo, setRepo] = useState(defaultRepo);
  const [parent, setParent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [handoff, setHandoff] = useState('');
  const handoffText = handoff || (task.issueCreation?.issueNumber ?
    `按 AGENTS.md 快速开发模式接手 ${task.issueCreation.repo} 的 Issue #${task.issueCreation.issueNumber}` : '');
  const [copied, setCopied] = useState(false);
  const summary = discussionSummary(task);
  const planEnabled = source === 'github' && host.app.isDesktop() && (task.status === 'needs-you' || task.status === 'ended' || task.status === 'completed') && !task.issueCreation;
  const confirmedIssue = task.issueCreation?.issueNumber && task.issueCreation.url;
  useEffect(() => { setError(''); }, [task.id]);

  const finish = async () => {
    const ok = await store.update(task.id, (current) => {
      const summary = discussionSummary(current).summary;
      const field = (f: typeof summary.nextSteps) => f.kind === 'value' ? f.text : t.unavailable;
      const text = [
        summary.conclusion.kind === 'value' ? summary.conclusion.text : t.unavailable,
        t.disagreements + ': ' + field(summary.disagreements),
        t.gaps + ': ' + field(summary.evidenceGaps),
        t.next + ': ' + field(summary.nextSteps),
      ].join('\n');
      return {
        ...current, status: 'ended', updatedAt: new Date().toISOString(),
        rounds: current.rounds.map((round, index) => index === current.rounds.length - 1
          ? { ...round, summary: text } : round),
      };
    });
    if (!ok) setError(t.storageError);
  };
  const remove = async () => {
    if (task.status === 'running' || store.busy) return;
    if (!window.confirm(t.deleteConfirm)) return;
    if (await store.remove(task.id)) onBack();
    else setError(t.storageError);
  };
  const plan = async () => {
    if (!planEnabled || sending) return;
    const normalized = normalizeRepo(repo);
    if (!normalized) { setError(t.planRepo); return; }
    const parentSpec = parent.trim() ? Number(parent) : undefined;
    if (parentSpec !== undefined && (!Number.isSafeInteger(parentSpec) || parentSpec <= 0)) { setError(t.parent); return; }
    let body: string;
    try {
      body = discussionIssueBody(task);
      if (parentSpec) body = body.replace('- Parent Spec: 无', '- Parent Spec: #' + parentSpec)
        .replace('- Reviewed Spec Revision: 不适用', '- Reviewed Spec Revision: 待 CC 核对');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    // Persist the in-flight marker BEFORE sending anything external. A crash then means
    // "result unknown" and must never cause an automatic retry.
    setSending(true);
    setError('');
    const marker = { status: 'pending' as const, repo: normalized, startedAt: new Date().toISOString() };
    if (!(await store.update(task.id, (current) => ({ ...current, issueCreation: marker })))) {
      setSending(false); setError(t.storageError); return;
    }
    try {
      const result = await host.githubWrite.createIssue({
        repo: normalized, title: '[Task] 定方案：' + task.title.slice(0, 170),
        body, ...(parentSpec ? { parentSpec } : {}),
      });
      const status = result.status;
      const ok = await store.update(task.id, (current) => ({
        ...current,
        issueCreation: { ...marker, status, ...(result.issueNumber ? { issueNumber: result.issueNumber } : {}),
          ...(result.url ? { url: result.url } : {}) },
      }));
      if (!ok) setError(t.planSent);
      else if (status !== 'confirmed') setError(status === 'partial' ? t.planPartial : t.planError);
      if (result.issueNumber) {
        const instruction = `按 AGENTS.md 快速开发模式接手 ${normalized} 的 Issue #${result.issueNumber}`;
        setHandoff(instruction);
        try { await navigator.clipboard.writeText(instruction); setCopied(true); } catch { setCopied(false); }
      }
    } catch {
      // The persisted pending marker remains and prevents duplicate create_issue.
      setError(t.planSent);
    } finally { setSending(false); }
  };

  return (
    <div className="mx-auto grid w-full max-w-[1180px] gap-v2-section p-v2-page-narrow min-[1100px]:p-v2-page-mid min-[1320px]:p-v2-page">
      <nav><Button size="sm" variant="ghost" onClick={onBack}>← {t.group}</Button></nav>
      <header className="grid gap-v2-sm">
        <h1 className="font-v2-serif text-v2-title text-v2-ink">{task.title}</h1>
        <div className="flex flex-wrap gap-v2-sm"><Badge tone={task.status === 'interrupted' ? 'block' : task.status === 'running' ? 'run' : 'done'}>{task.stage}</Badge><Badge>{task.status}</Badge></div>
        <p className="text-v2-meta text-v2-ink-2">{task.question}</p>
      </header>
      {store.error ? <Notice tone="block" title={t.storageError}>{store.error}</Notice> : null}
      {error ? <Notice tone="block" title={t.storageError}>{error}</Notice> : null}
      {task.status === 'running' ? <Notice title={t.active}>{t.statusRunning}</Notice> : null}
      {task.status === 'interrupted' ? <Notice tone="unknown" title={t.interrupted}>{t.noResume}</Notice> : null}
      <DiscussionMatrix model={summary.matrix} locale={locale} />
      {task.rounds.some((round) => round.steps.length > 0) ? <SummaryCard
        model={summary.summary} locale={locale}
        onPlan={() => { document.getElementById('discussion-plan-repo')?.focus(); }}
        onFinishAndSave={task.status !== 'running' && task.status !== 'ended' ? () => { void finish(); } : undefined}
      /> : null}
      {task.rounds.map((round) => (
        <section key={round.id} className="grid gap-v2-sm">
          <SectionHeader level={3} title={`${t.step} · ${new Date(round.startedAt).toLocaleString()}`} count={round.steps.length} />
          {round.steps.map((step) => (
            <details key={step.id} className="min-w-0 rounded-v2-md border border-v2-line bg-v2-surface p-v2-md">
              <summary className="cursor-pointer break-words text-v2-meta text-v2-ink">{step.name} · {step.speaker} · {step.status} — {t.raw}</summary>
              <pre className="mt-v2-sm whitespace-pre-wrap break-words text-v2-body text-v2-ink-2">{step.text}</pre>
              <p className="mt-v2-sm text-v2-micro text-v2-ink-3">{t.rawHint}</p>
            </details>
          ))}
        </section>
      ))}
      <Card className="grid gap-v2-sm">
        <SectionHeader level={3} title={t.plan} />
        <p className="text-v2-meta text-v2-ink-2">{t.planHint}</p>
        <div className="grid gap-v2-sm sm:grid-cols-2">
          <label className="grid gap-v2-xs text-v2-meta">{t.planRepo}<input id="discussion-plan-repo" className="rounded-v2-md border border-v2-line bg-v2-surface p-v2-sm text-v2-ink" value={repo} onChange={(e) => setRepo(e.target.value)} disabled={!planEnabled} /></label>
          <label className="grid gap-v2-xs text-v2-meta">{t.parent}<input className="rounded-v2-md border border-v2-line bg-v2-surface p-v2-sm text-v2-ink" value={parent} onChange={(e) => setParent(e.target.value)} disabled={!planEnabled} /></label>
        </div>
        <Button disabled={!planEnabled || sending || store.busy} disabledReason={task.issueCreation ? t.planSent : t.planDisabled} onClick={() => { void plan(); }}>{sending ? t.running : t.prepare}</Button>
        {task.issueCreation ? <Notice title={task.issueCreation.status === 'confirmed' ? t.planConfirmed : t.planSent}>
          {task.issueCreation.status === 'partial' ? t.planPartial : task.issueCreation.status === 'confirmed' ? t.planConfirmed : t.planError}
          {confirmedIssue ? <Button size="sm" variant="ghost" onClick={() => { void host.app.openExternal(task.issueCreation!.url!); }}>{t.openIssue}</Button> : null}
        </Notice> : null}
        {handoffText ? <div className="grid gap-v2-sm"><Button onClick={() => { void navigator.clipboard.writeText(handoffText).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{t.handoff}</Button><textarea readOnly value={handoffText} aria-label={t.copyFailed} className="w-full rounded-v2-md border border-v2-line bg-v2-surface p-v2-sm text-v2-body text-v2-ink" />{!copied ? <span className="text-v2-meta text-v2-ink-3">{t.copyFailed}</span> : null}</div> : null}
      </Card>
      <Card className="grid gap-v2-sm">
        <p className="text-v2-meta text-v2-ink-2">{t.noIssue}</p>
        <div className="flex flex-wrap gap-v2-sm">
          <Button disabled disabledReason={t.noFollowUp}>{t.followUp}</Button>
          <Button disabled disabledReason={t.noResume}>{t.restart}</Button>
          <Button variant="ghost" disabled={task.status === 'running' || store.busy} disabledReason={t.statusRunning} onClick={() => { void remove(); }}>{t.delete}</Button>
        </div>
      </Card>
    </div>
  );
}
