import { useState } from 'react';
import type { Locale } from '../i18n/resolve';
import { STATUS_TONE, effectiveCi, formatAge, pickText, type HudStage, type HudTask } from '../ui/taskHudModel';
import { taskHudText } from '../ui/taskHudText';
import { Badge, Button, Icon, StatusIndicator, cx } from '../ui/v2';
import { DispatchPanel } from './DispatchPanel';
import { workbenchText } from './workbenchText';

/** Status as shape + colour + text (design §6). */
export function TaskStatus({ task, locale, hideLabel = false }: { task: HudTask; locale: Locale; hideLabel?: boolean }) {
  const hud = taskHudText(locale);
  const label = task.statusNote ? `${hud.status(task.status)} · ${pickText(task.statusNote, locale)}` : hud.status(task.status);
  return <StatusIndicator tone={STATUS_TONE[task.status]} label={label} hideLabel={hideLabel} />;
}

const STAGE_BAR: Record<HudStage['state'], string> = {
  done: 'bg-v2-done',
  active: 'bg-v2-run',
  todo: 'bg-v2-line-strong',
  skipped: 'bg-v2-line',
};

/** Compact progress: one bar per stage. The names are in the accessible label. */
export function StageBars({ stages, locale }: { stages: readonly HudStage[]; locale: Locale }) {
  if (stages.length === 0) return null;
  const hud = taskHudText(locale);
  const label = stages.map((stage) => `${pickText(stage.name, locale)}: ${hud.stage(stage.state)}`).join('; ');
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex items-center gap-1">
      {stages.map((stage, index) => (
        <span key={index} className={cx('h-1 w-4 rounded-v2-pill', STAGE_BAR[stage.state])} />
      ))}
    </span>
  );
}

/** Full stage strip for the task page. */
export function StageStrip({ stages, locale }: { stages: readonly HudStage[]; locale: Locale }) {
  const hud = taskHudText(locale);
  return (
    <ol className="grid gap-v2-sm" style={{ gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(0, 1fr))` }}>
      {stages.map((stage, index) => (
        <li key={index} className="min-w-0">
          <span className={cx('block h-1 rounded-v2-pill', STAGE_BAR[stage.state])} />
          <span className={cx('mt-v2-xs block truncate text-v2-meta', stage.state === 'active' ? 'font-semibold text-v2-ink' : 'text-v2-ink-2')}>
            {pickText(stage.name, locale)}
          </span>
          <span className="block truncate text-v2-micro text-v2-ink-3">{hud.stage(stage.state)}</span>
        </li>
      ))}
    </ol>
  );
}

/** One task line, used by the overview and the task list. The whole row opens the task. */
export function TaskRow({ task, locale, onOpen, canDispatch = false }: {
  task: HudTask; locale: Locale; onOpen: (task: HudTask) => void;
  /** Real GitHub data only: a demo task has nothing to hand over. */
  canDispatch?: boolean;
}) {
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const dispatchable = canDispatch && Boolean(task.issue);
  const hud = taskHudText(locale);
  const text = workbenchText(locale);
  const ci = effectiveCi(task);
  return (
    <li>
      <div className="flex items-center gap-v2-xs">
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-v2-md rounded-v2-md px-v2-sm py-v2-sm text-left hover:bg-v2-hover"
      >
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-v2-sm">
            <TaskStatus task={task} locale={locale} hideLabel />
            <span className="truncate font-semibold text-v2-ink">{pickText(task.title, locale)}</span>
          </span>
          <span className="mt-0.5 block truncate text-v2-meta text-v2-ink-3">
            {task.repo}
            {task.issue ? ` #${task.issue}` : ''} · {hud.status(task.status)}
            {task.statusNote ? ` · ${pickText(task.statusNote, locale)}` : ''}
          </span>
        </span>
        <span className="flex items-center gap-v2-sm text-v2-meta text-v2-ink-3">
          <StageBars stages={task.stages} locale={locale} />
          {task.pr ? (
            <Badge icon={<Icon name="gitPr" size={12} />}>
              #{task.pr.number}
              {task.pr.draft ? ` ${text.t('prDraft')}` : ''}
            </Badge>
          ) : null}
          {task.pr ? <Badge tone={ci.state === 'success' ? 'done' : ci.state === 'failure' ? 'block' : ci.state === 'running' ? 'run' : 'unknown'}>{hud.ci(ci.state)}</Badge> : null}
          <span className="hidden w-20 text-right xl:inline">{formatAge(task.updatedMinutesAgo, locale)}</span>
        </span>
      </button>
      {dispatchable ? (
        <Button size="sm" aria-expanded={dispatchOpen} aria-label={`${text.t('launchButton')} #${task.issue}`} onClick={() => setDispatchOpen((value) => !value)}>
          {text.t('launchButton')}
        </Button>
      ) : null}
      </div>
      {dispatchable && dispatchOpen ? (
        <div className="px-v2-sm pb-v2-sm">
          <DispatchPanel locale={locale} repo={task.repo} issue={task.issue!} open onOpenChange={setDispatchOpen} />
        </div>
      ) : null}
    </li>
  );
}
