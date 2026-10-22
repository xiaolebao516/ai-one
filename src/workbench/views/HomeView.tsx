import { useState } from 'react';
import type { Locale } from '../../i18n/resolve';
import { formatAge, inProgressTasks, needsYouTasks, pickText, type HudTask } from '../../ui/taskHudModel';
import { taskHudText } from '../../ui/taskHudText';
import { Badge, Button, Card, EmptyState, Icon, SectionHeader, SegmentedControl } from '../../ui/v2';
import { TaskRow, TaskStatus } from '../TaskBits';
import type { DataHealth } from '../useWorkbenchData';
import { headline } from '../workbenchModel';
import { workbenchText } from '../workbenchText';

type ComposerMode = 'chat' | 'grill' | 'cc' | 'flow';

export interface HomeViewProps {
  locale: Locale;
  tasks: readonly HudTask[];
  health: DataHealth;
  onOpenTask: (task: HudTask) => void;
  onShowTasks: () => void;
}

export function HomeView({ locale, tasks, health, onOpenTask, onShowTasks }: HomeViewProps) {
  const text = workbenchText(locale);
  const lead = headline(tasks);
  const needsYou = needsYouTasks(tasks);
  const moving = inProgressTasks(tasks);
  // Counts and "nothing here" only mean something after a successful read.
  const known = health === 'demo' || health === 'ok';
  const title =
    health === 'loading'
      ? text.t('headlineLoading')
      : health === 'failed'
        ? text.t('headlineFailed')
        : lead.kind === 'empty'
      ? text.t('headlineEmpty')
      : lead.kind === 'quiet'
        ? text.t('headlineQuiet')
        : lead.kind === 'moving'
          ? text.t('headlineMoving', { inProgress: lead.inProgress })
          : text.t('headlineWaiting', { inProgress: lead.inProgress, needsYou: lead.needsYou });

  return (
    <div className="mx-auto grid max-w-[1180px] gap-v2-lg p-v2-page">
      <header>
        <h1 className="text-[24px] font-semibold leading-tight text-v2-ink">{title}</h1>
        <p className="mt-v2-xs text-v2-meta text-v2-ink-2">
          {text.t(health === 'demo' ? 'headlineSubDemo' : health === 'failed' ? 'headlineSubFailed' : 'headlineSubGithub')}
        </p>
      </header>

      <Composer locale={locale} />

      <div className="grid gap-v2-lg min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid content-start gap-v2-lg">
          <section aria-labelledby="home-needs-you">
            <SectionHeader id="home-needs-you" title={text.t('needsYou')} count={known ? needsYou.length : undefined} description={text.t('needsYouHint')} />
            {needsYou.length ? (
              <ul className="mt-v2-sm grid gap-v2-sm">
                {needsYou.map((task) => (
                  <NeedsYouCard key={task.id} task={task} locale={locale} onOpen={onOpenTask} />
                ))}
              </ul>
            ) : null}
          </section>

          <section aria-labelledby="home-in-progress">
            <SectionHeader
              id="home-in-progress"
              title={text.t('inProgress')}
              count={known ? moving.length : undefined}
              actions={
                <Button size="sm" variant="ghost" onClick={onShowTasks}>
                  {text.t('allTasks')}
                </Button>
              }
            />
            {moving.length ? (
              <Card padding="none" className="mt-v2-sm">
                <ul className="divide-y divide-v2-line p-v2-xs">
                  {moving.map((task) => (
                    <TaskRow key={task.id} task={task} locale={locale} onOpen={onOpenTask} />
                  ))}
                </ul>
              </Card>
            ) : (
              <EmptyState
                className="mt-v2-sm"
                tone={known ? 'neutral' : 'unknown'}
                title={!known ? text.t(health === 'loading' ? 'headlineLoading' : 'headlineFailed') : tasks.length ? text.t('noActiveTasks') : text.t('headlineEmpty')}
              />
            )}
          </section>
        </div>

        <aside className="grid content-start gap-v2-lg">
          <section aria-labelledby="home-resources">
            <SectionHeader id="home-resources" title={text.t('resources')} />
            <Card className="mt-v2-sm">
              <Badge tone="unknown">{text.t('plannedBadge')}</Badge>
              <p className="mt-v2-sm text-v2-meta text-v2-ink-2">{text.t('resourcesPending')}</p>
            </Card>
          </section>
          <section aria-labelledby="home-auto">
            <SectionHeader id="home-auto" title={text.t('autoHandled')} />
            <Card className="mt-v2-sm">
              <Badge tone="unknown">{text.t('plannedBadge')}</Badge>
              <p className="mt-v2-sm text-v2-meta text-v2-ink-2">{text.t('autoHandledPending')}</p>
            </Card>
          </section>
        </aside>
      </div>
    </div>
  );
}

function NeedsYouCard({ task, locale, onOpen }: { task: HudTask; locale: Locale; onOpen: (task: HudTask) => void }) {
  const hud = taskHudText(locale);
  const text = workbenchText(locale);
  return (
    <li>
      <Card accent="you" className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-v2-md">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-v2-sm">
            <Badge tone={task.status === 'blocked' ? 'block' : 'you'}>{hud.needKind(task.status)}</Badge>
            <span className="font-semibold text-v2-ink">{pickText(task.title, locale)}</span>
          </div>
          <p className="mt-v2-xs text-v2-body text-v2-ink-2">{pickText(task.summary, locale)}</p>
          <p className="mt-v2-xs text-v2-meta text-v2-ink-3">
            {task.repo}
            {task.issue ? ` #${task.issue}` : ''} · {formatAge(task.updatedMinutesAgo, locale)}
          </p>
        </div>
        <div className="flex items-center gap-v2-sm">
          <TaskStatus task={task} locale={locale} hideLabel />
          <Button size="sm" variant="attention" onClick={() => onOpen(task)} icon={<Icon name="chevronRight" size={14} />}>
            {text.t('open')}
          </Button>
        </div>
      </Card>
    </li>
  );
}

/**
 * The one input from the design (§0.2). Nothing here can dispatch yet, so the start button is
 * disabled with the reason written out instead of pretending (Spec #79 v2).
 */
function Composer({ locale }: { locale: Locale }) {
  const text = workbenchText(locale);
  const [mode, setMode] = useState<ComposerMode>('cc');
  const [draft, setDraft] = useState('');
  return (
    <Card className="grid gap-v2-sm">
      <label className="sr-only" htmlFor="workbench-composer">
        {text.t('composerPlaceholder')}
      </label>
      <textarea
        id="workbench-composer"
        rows={2}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={text.t('composerPlaceholder')}
        className="w-full resize-none bg-transparent text-v2-lead text-v2-ink placeholder:text-v2-ink-3 focus:outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-v2-sm">
        <SegmentedControl
          idBase="home-composer-mode"
          label={text.t('composerPlaceholder')}
          value={mode}
          onChange={(value) => setMode(value as ComposerMode)}
          options={[
            { value: 'chat', label: text.t('composerModeChat') },
            { value: 'grill', label: text.t('composerModeGrill') },
            { value: 'cc', label: text.t('composerModeCc') },
            { value: 'flow', label: text.t('composerModeFlow') },
          ]}
        />
        <Button variant="primary" disabled disabledReason={text.t('composerNotYet')}>
          {text.t('composerStart')}
        </Button>
      </div>
      <p className="text-v2-meta text-v2-ink-3">{text.t('composerNotYet')}</p>
    </Card>
  );
}
