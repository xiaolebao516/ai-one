import { useState } from 'react';
import type { Locale } from '../../i18n/resolve';
import type { HudTask } from '../../ui/taskHudModel';
import { Card, EmptyState, SectionHeader, SegmentedControl } from '../../ui/v2';
import { TaskRow } from '../TaskBits';
import type { DataHealth } from '../useWorkbenchData';
import { filterTasks, groupByRepo, type TaskFilter } from '../workbenchModel';
import { workbenchText } from '../workbenchText';

export interface TasksViewProps {
  locale: Locale;
  tasks: readonly HudTask[];
  health: DataHealth;
  onOpenTask: (task: HudTask) => void;
}

const FILTERS: readonly TaskFilter[] = ['all', 'active', 'needsYou', 'done'];
const FILTER_KEY = { all: 'filterAll', active: 'filterActive', needsYou: 'filterNeedsYou', done: 'filterDone' } as const;

export function TasksView({ locale, tasks, health, onOpenTask }: TasksViewProps) {
  const text = workbenchText(locale);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const groups = groupByRepo(filterTasks(tasks, filter));
  return (
    <div className="mx-auto grid max-w-[1180px] gap-v2-lg p-v2-page">
      <header className="flex flex-wrap items-end justify-between gap-v2-md">
        <h1 className="text-[24px] font-semibold leading-tight text-v2-ink">{text.t('tasksTitle')}</h1>
        <SegmentedControl
          idBase="tasks-filter"
          label={text.t('filterAria')}
          value={filter}
          onChange={(value) => setFilter(value as TaskFilter)}
          options={FILTERS.map((value) => ({ value, label: text.t(FILTER_KEY[value]), count: filterTasks(tasks, value).length }))}
        />
      </header>
      {groups.length === 0 ? (
        health === 'loading' || health === 'failed' ? (
          <EmptyState tone="unknown" title={text.t(health === 'loading' ? 'headlineLoading' : 'headlineFailed')} description={health === 'failed' ? text.t('headlineSubFailed') : undefined} />
        ) : health === 'partial' ? (
          <EmptyState tone="unknown" title={text.t('partialNone')} />
        ) : (
          <EmptyState title={text.t('emptyFilter')} description={health === 'complete' && tasks.length === 0 ? text.t('emptyGithub') : undefined} />
        )
      ) : (
        groups.map((group) => (
          <section key={group.repo} aria-label={group.repo}>
            <SectionHeader level={3} title={group.repo} count={group.tasks.length} />
            <Card padding="none" className="mt-v2-sm">
              <ul className="divide-y divide-v2-line p-v2-xs">
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} locale={locale} onOpen={onOpenTask} />
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}
    </div>
  );
}
