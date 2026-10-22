import { useState } from 'react';
import type { Locale } from '../../i18n/resolve';
import type { HudTask } from '../../ui/taskHudModel';
import { Card, EmptyState, SectionHeader, SegmentedControl } from '../../ui/v2';
import { TaskRow } from '../TaskBits';
import { categoryHealth, countLabel, isExact, type DataHealth } from '../useWorkbenchData';
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
  // Repository subtotals follow the active filter: the total for "all", counts by state otherwise.
  const groupPrecision = filter === 'all' ? health : categoryHealth(health, tasks);
  return (
    <div className="mx-auto grid max-w-[1180px] gap-v2-lg p-v2-page">
      <header className="flex flex-wrap items-end justify-between gap-v2-md">
        <h1 className="text-[24px] font-semibold leading-tight text-v2-ink">{text.t('tasksTitle')}</h1>
        <SegmentedControl
          idBase="tasks-filter"
          label={text.t('filterAria')}
          value={filter}
          onChange={(value) => setFilter(value as TaskFilter)}
          options={FILTERS.map((value) => {
            const n = filterTasks(tasks, value).length;
            // "All" is the total; the others are counts by state, which unreadable states make "at least".
            const precision = value === 'all' ? health : categoryHealth(health, tasks);
            // Exact counts use the count badge; partial / unknown reads say "at least" or "?" in the label.
            return isExact(precision)
              ? { value, label: text.t(FILTER_KEY[value]), count: n }
              : { value, label: `${text.t(FILTER_KEY[value])} ${countLabel(n, precision)}` };
          })}
        />
      </header>
      {groups.length === 0 ? (
        health === 'loading' || health === 'failed' ? (
          <EmptyState tone="unknown" title={text.t(health === 'loading' ? 'headlineLoading' : 'headlineFailed')} description={health === 'failed' ? text.t('headlineSubFailed') : undefined} />
        ) : health === 'partial' ? (
          <EmptyState tone="unknown" title={text.t('partialNone')} />
        ) : filter !== 'all' && categoryHealth(health, tasks) === 'partial' ? (
          <EmptyState tone="unknown" title={text.t('categoryNone')} />
        ) : (
          <EmptyState title={text.t('emptyFilter')} description={health === 'complete' && tasks.length === 0 ? text.t('emptyGithub') : undefined} />
        )
      ) : (
        groups.map((group) => (
          <section key={group.repo} aria-label={group.repo}>
            <SectionHeader
              level={3}
              title={isExact(groupPrecision) ? group.repo : `${group.repo} ${countLabel(group.tasks.length, groupPrecision)}`}
              count={isExact(groupPrecision) ? group.tasks.length : undefined}
            />
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
