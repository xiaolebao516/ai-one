import { DispatchPanel } from '../DispatchPanel';
import type { ReactNode } from 'react';
import type { Locale } from '../../i18n/resolve';
import { effectiveCi, formatAge, isNeedsYou, pickText, reviewIsCurrent, shortSha, type HudTask } from '../../ui/taskHudModel';
import { taskHudText } from '../../ui/taskHudText';
import { Badge, Button, Card, Icon, Notice, SectionHeader } from '../../ui/v2';
import { StageStrip, TaskStatus } from '../TaskBits';
import { workbenchText } from '../workbenchText';

export interface TaskViewProps {
  locale: Locale;
  task: HudTask;
  onBack: () => void;
}

const EVIDENCE_TONE = { readback: 'done', local: 'run', self: 'neutral', unverified: 'unknown' } as const;

/** Task page (design §5): now → needs you → stages and evidence, with delivery facts on the right. */
export function TaskView({ locale, task, onBack }: TaskViewProps) {
  const text = workbenchText(locale);
  const hud = taskHudText(locale);
  return (
    <div className="grid min-h-full min-[1320px]:grid-cols-[minmax(0,1fr)_300px]">
      <div className="mx-auto grid w-full max-w-[920px] content-start gap-v2-section p-v2-page-narrow min-[1100px]:p-v2-page-mid min-[1320px]:p-v2-page">
        <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-v2-sm text-v2-meta text-v2-ink-3">
          <Button size="sm" variant="ghost" onClick={onBack} icon={<Icon name="arrowLeft" size={14} />}>
            {text.t('backToTasks')}
          </Button>
          <span>{task.repo}</span>
          {task.issue ? <Badge>#{task.issue}</Badge> : null}
          {task.pr ? <Badge icon={<Icon name="gitPr" size={12} />}>PR #{task.pr.number}</Badge> : null}
        </nav>

        <header className="flex flex-wrap items-start justify-between gap-v2-md">
          <h1 className="min-w-0 font-v2-serif text-v2-heading text-v2-ink">{pickText(task.title, locale)}</h1>
          <TaskStatus task={task} locale={locale} />
        </header>

        {task.issue ? <DispatchPanel locale={locale} repo={task.repo} issue={task.issue} /> : null}

        {task.stages.length ? <StageStrip stages={task.stages} locale={locale} /> : null}

        <Card accent={isNeedsYou(task.status) ? 'you' : undefined} className="grid gap-v2-xs">
          <span className="text-v2-meta text-v2-ink-3">{text.t('now')}</span>
          <p className="font-v2-serif text-v2-lead font-medium leading-snug text-v2-ink">{pickText(task.summary, locale)}</p>
          {task.nextStep ? (
            <p className="text-v2-meta text-v2-ink-2">
              {text.t('nextStep')}: {pickText(task.nextStep, locale)}
              {task.owner ? ` · ${text.t('owner')}: ${pickText(task.owner, locale)}` : ''}
            </p>
          ) : null}
          <p className="text-v2-micro text-v2-ink-3">{text.t('updated', { age: formatAge(task.updatedMinutesAgo, locale) })}</p>
        </Card>

        {isNeedsYou(task.status) ? (
          <section aria-labelledby="task-needs-you">
            <Card accent="you" className="grid gap-v2-xs">
              <div className="flex flex-wrap items-center gap-v2-sm">
                <h2 id="task-needs-you" className="font-semibold text-v2-ink">
                  {text.t('taskNeedsYou')}
                </h2>
                <Badge tone={task.status === 'blocked' ? 'block' : 'you'}>{hud.needKind(task.status)}</Badge>
              </div>
              <p className="text-v2-body text-v2-ink">{task.nextStep ? pickText(task.nextStep, locale) : text.t('taskNeedsYouNone')}</p>
              {task.owner ? (
                <p className="text-v2-meta text-v2-ink-2">
                  {text.t('owner')}: {pickText(task.owner, locale)}
                </p>
              ) : null}
              <p className="text-v2-meta text-v2-ink-3">{text.t('taskNeedsYouWhere')}</p>
            </Card>
          </section>
        ) : null}

        {task.gap ? (
          <Notice tone="unknown" title={text.t('gap')}>
            {pickText(task.gap, locale)}
          </Notice>
        ) : null}

        <section aria-labelledby="task-evidence">
          <SectionHeader id="task-evidence" title={text.t('evidence')} count={task.evidence.length} description={text.t('evidenceHint')} />
          <ul className="mt-v2-sm grid gap-v2-sm">
            {task.evidence.map((item) => (
              <li key={item.id}>
                <Card padding="sm" className="grid gap-v2-xs">
                  <div className="flex flex-wrap items-center justify-between gap-v2-sm">
                    <span className="text-v2-body text-v2-ink">{pickText(item.text, locale)}</span>
                    <span className="flex items-center gap-v2-sm text-v2-micro text-v2-ink-3">
                      <Badge tone={EVIDENCE_TONE[item.kind]}>{hud.evidence(item.kind, task.dataSource)}</Badge>
                      {formatAge(item.observedMinutesAgo, locale)}
                    </span>
                  </div>
                  {item.raw ? (
                    <details>
                      <summary className="cursor-pointer text-v2-micro text-v2-ink-3">{text.t('rawEvidence')}</summary>
                      <pre className="mt-v2-xs overflow-auto whitespace-pre-wrap rounded-v2-sm bg-v2-sunken p-v2-sm font-v2-mono text-v2-micro text-v2-ink-2">{item.raw}</pre>
                    </details>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside aria-label={text.t('delivery')} className="border-v2-line bg-v2-panel p-v2-page-narrow min-[1100px]:p-v2-page-mid min-[1320px]:p-v2-page min-[1320px]:border-l">
        <SectionHeader level={3} title={text.t('delivery')} />
        <dl className="mt-v2-sm grid gap-v2-sm text-v2-meta">
          <Fact label={text.t('issue')}>{task.issue ? `#${task.issue}` : text.t('unknownValue')}</Fact>
          <Fact label={text.t('pr')}>
            {task.pr ? `#${task.pr.number}${task.pr.draft ? ` · ${text.t('prDraft')}` : ''}` : text.t('unknownValue')}
          </Fact>
          <Fact label={text.t('head')}>
            {task.pr?.headSha ? <code className="font-v2-mono">{shortSha(task.pr.headSha)}</code> : text.t('unknownValue')}
          </Fact>
          <Fact label={text.t('ci')}>
            <CiFact task={task} locale={locale} />
          </Fact>
          <Fact label={text.t('review')}>
            {task.review && task.review.verdict !== 'none'
              ? `${hud.verdict(task.review.verdict)}${reviewIsCurrent(task) ? '' : ` · ${text.t('reviewStale')}`}`
              : text.t('reviewNone')}
          </Fact>
        </dl>
      </aside>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-baseline gap-v2-sm">
      <dt className="text-v2-ink-3">{label}</dt>
      <dd className="min-w-0 text-v2-ink">{children}</dd>
    </div>
  );
}

function CiFact({ task, locale }: { task: HudTask; locale: Locale }) {
  const hud = taskHudText(locale);
  const ci = effectiveCi(task);
  const tone = ci.state === 'success' ? 'done' : ci.state === 'failure' ? 'block' : ci.state === 'running' ? 'run' : 'unknown';
  return (
    <span className="grid gap-0.5">
      <Badge tone={tone}>{hud.ci(ci.state)}</Badge>
      {ci.state === 'unknown' ? <span className="text-v2-micro text-v2-ink-3">{hud.ciReason(ci.reason)}</span> : null}
    </span>
  );
}
