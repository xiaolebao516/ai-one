import { useState } from 'react';
import type { Locale } from '../../i18n/resolve';
import { formatAge, inProgressTasks, needsYouTasks, pickText, type HudTask } from '../../ui/taskHudModel';
import { taskHudText } from '../../ui/taskHudText';
import { Badge, Button, Card, EmptyState, Icon, SectionHeader, SegmentedControl } from '../../ui/v2';
import { TaskRow, TaskStatus } from '../TaskBits';
import { CHANNEL_BADGE, type ChannelView } from '../dispatchView';
import { categoryHealth, countLabel, isCountable, isExact, type DataHealth } from '../useWorkbenchData';
import { headline } from '../workbenchModel';
import { workbenchText } from '../workbenchText';

type ComposerMode = 'chat' | 'grill' | 'cc' | 'flow';

/** Exact counts go in the header's count slot; "at least" / unknown ones are written into the title. */
function sectionTitle(label: string, n: number, health: DataHealth): string {
  return isExact(health) ? label : `${label} ${countLabel(n, health)}`;
}

export interface HomeViewProps {
  locale: Locale;
  tasks: readonly HudTask[];
  health: DataHealth;
  onOpenTask: (task: HudTask) => void;
  onShowTasks: () => void;
  /** What the Prodex channel looks like right now; the rest of the resources is not readable yet. */
  channel?: ChannelView;
  onShowResources?: () => void;
  /** One-shot draft handoff from Chat; it is never submitted automatically. */
  prefill?: { text: string; mode: 'grill' };
}

export function HomeView({ locale, tasks, health, channel, onOpenTask, onShowTasks, onShowResources, prefill }: HomeViewProps) {
  const text = workbenchText(locale);
  const lead = headline(tasks);
  const needsYou = needsYouTasks(tasks);
  const moving = inProgressTasks(tasks);
  const countable = isCountable(health);
  const byState = categoryHealth(health, tasks);
  let title: string;
  if (health === 'loading') title = text.t('headlineLoading');
  else if (health === 'failed') title = text.t('headlineFailed');
  // A partial read never supports "nothing else": what was not read may hold work for the user.
  else if (health === 'partial' && lead.kind === 'waiting')
    title = text.t('headlinePartialWaiting', { inProgress: lead.inProgress, needsYou: lead.needsYou });
  else if (health === 'partial' && lead.kind === 'moving') title = text.t('headlinePartialMoving', { inProgress: lead.inProgress });
  else if (health === 'partial' && lead.kind === 'unclear') title = text.t('headlinePartialUnclear', { unknown: lead.unknown });
  else if (lead.kind === 'waiting')
    title = text.t(lead.unknown ? 'headlineWaitingUnknown' : 'headlineWaiting', { inProgress: lead.inProgress, needsYou: lead.needsYou, unknown: lead.unknown });
  // "nothing waiting for you" is only said when every task's state was read.
  else if (lead.kind === 'moving') title = text.t(lead.unknown ? 'headlineMovingUnknown' : 'headlineMoving', { inProgress: lead.inProgress, unknown: lead.unknown });
  else if (lead.kind === 'unclear') title = text.t('headlineUnclear', { unknown: lead.unknown });
  else if (health === 'partial') title = text.t('partialNone');
  else title = text.t(lead.kind === 'quiet' ? 'headlineQuiet' : 'headlineEmpty');
  const sub =
    health === 'demo'
      ? 'headlineSubDemo'
      : health === 'failed'
        ? 'headlineSubFailed'
        : health === 'partial'
          ? 'headlineSubPartial'
          : 'headlineSubGithub';
  // "In progress" is a group by state: its empty state follows the by-state precision.
  const emptyTitle = !countable
    ? text.t(health === 'loading' ? 'headlineLoading' : 'headlineFailed')
    : health === 'partial'
      ? text.t('partialNone')
      : byState === 'partial'
        ? text.t('categoryNone')
        : tasks.length
          ? text.t('noActiveTasks')
          : text.t('headlineEmpty');

  return (
    <div className="mx-auto grid max-w-[1180px] gap-v2-section p-v2-page-narrow min-[1100px]:p-v2-page-mid min-[1320px]:p-v2-page">
      <header>
        <h1 className="font-v2-serif text-v2-title text-v2-ink">{title}</h1>
        <p className="mt-v2-xs text-v2-meta text-v2-ink-2">
          {text.t(sub)}
        </p>
      </header>

      <Composer locale={locale} prefill={prefill} />

      <div className="grid gap-v2-lg min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid content-start gap-v2-lg">
          <section aria-labelledby="home-needs-you">
            <SectionHeader id="home-needs-you" title={sectionTitle(text.t('needsYou'), needsYou.length, byState)} count={isExact(byState) ? needsYou.length : undefined} description={text.t('needsYouHint')} />
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
              title={sectionTitle(text.t('inProgress'), moving.length, byState)}
              count={isExact(byState) ? moving.length : undefined}
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
                tone={isExact(byState) ? 'neutral' : 'unknown'}
                title={emptyTitle}
              />
            )}
          </section>
        </div>

        <aside className="grid content-start gap-v2-lg">
          <section aria-labelledby="home-resources">
            <SectionHeader
              id="home-resources"
              title={text.t('resources')}
              actions={
                onShowResources ? (
                  <Button size="sm" variant="ghost" onClick={onShowResources}>
                    {text.t('open')}
                  </Button>
                ) : undefined
              }
            />
            <Card className="mt-v2-sm grid gap-v2-xs">
              {channel ? (
                <div className="flex flex-wrap items-center gap-v2-sm">
                  <span className="font-semibold text-v2-ink">Prodex</span>
                  <Badge tone={CHANNEL_BADGE[channel.tone]}>{text.t(channel.labelKey)}</Badge>
                </div>
              ) : null}
              {channel?.summary ? (
                <p className="text-v2-meta text-v2-ink-2">
                  {text.t('channelSlots', channel.summary.slots)}
                </p>
              ) : null}
              <p className="text-v2-meta text-v2-ink-3">{text.t('resourcesPending')}</p>
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
function Composer({ locale, prefill }: { locale: Locale; prefill?: { text: string; mode: 'grill' } }) {
  const text = workbenchText(locale);
  const [mode, setMode] = useState<ComposerMode>(prefill?.mode ?? 'cc');
  const [draft, setDraft] = useState(prefill?.text ?? '');
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
