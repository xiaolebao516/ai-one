import { forwardRef } from 'react';
import type { Locale } from '../i18n/resolve';
import { summarize, type HudTask } from './taskHudModel';
import { TASK_HUD_MOCK_TASKS } from './taskHudMockData';
import { githubTasks, useGitHubData, useHudPrefs } from './taskHudSource';
import { taskHudText } from './taskHudText';
import { Badge, Button, Icon, StatusIndicator, V2Scope } from './v2';

export interface TaskHudEntryProps {
  locale: Locale;
  onOpen: () => void;
  /** Fixed task list (tests / previews); otherwise the HUD's current data source is used. */
  tasks?: readonly HudTask[];
}

/**
 * Compact HUD entry for the chat toolbar (#40, #53): in progress / needs you / failed-or-unknown
 * counts from the data the HUD currently shows, labelled with its source (demo or GitHub). One
 * button; it opens the HUD overview, whose counters lead to the filtered list.
 */
export const TaskHudEntry = forwardRef<HTMLButtonElement, TaskHudEntryProps>(function TaskHudEntry({ locale, onOpen, tasks }, ref) {
  const prefs = useHudPrefs();
  const gh = useGitHubData();
  const github = !tasks && prefs.source === 'github';
  return (
    <TaskHudEntryView
      ref={ref}
      locale={locale}
      onOpen={onOpen}
      source={github ? 'github' : 'demo'}
      tasks={github ? (gh.phase === 'done' ? githubTasks(gh) : undefined) : (tasks ?? TASK_HUD_MOCK_TASKS)}
    />
  );
});

export interface TaskHudEntryViewProps {
  locale: Locale;
  onOpen: () => void;
  source: 'demo' | 'github';
  /** Undefined while GitHub has not been read: no counts are shown rather than zeros. */
  tasks?: readonly HudTask[];
}

export const TaskHudEntryView = forwardRef<HTMLButtonElement, TaskHudEntryViewProps>(function TaskHudEntryView({ locale, onOpen, source, tasks }, ref) {
  const text = taskHudText(locale);
  const summary = tasks ? summarize(tasks) : undefined;
  const counts = summary ? { inProgress: summary.inProgress, needsYou: summary.needsYou, attention: summary.attention } : undefined;
  const label =
    source === 'demo'
      ? text.t('entryAria', counts ?? { inProgress: 0, needsYou: 0, attention: 0 })
      : counts
        ? text.t('entryAriaGithub', counts)
        : text.t('entryAriaGithubIdle');
  return (
    <V2Scope className="inline-flex">
      <Button ref={ref} size="sm" onClick={onOpen} aria-label={label} title={label} icon={<Icon name="layers" size={14} />} data-testid="task-hud-entry">
        <span className="inline-flex items-center gap-1.5">
          <span>{text.t('entryLabel')}</span>
          <Badge tone={source === 'github' ? 'run' : 'neutral'}>{source === 'github' ? text.t('entryGithub') : text.t('entryDemo')}</Badge>
          {summary ? (
            <>
              <StatusIndicator tone="run" label={String(summary.inProgress)} />
              <StatusIndicator tone="you" label={String(summary.needsYou)} />
              <StatusIndicator tone="unknown" label={String(summary.attention)} />
            </>
          ) : (
            <span className="text-v2-meta text-v2-ink-3">{text.t('entryNotLoaded')}</span>
          )}
        </span>
      </Button>
    </V2Scope>
  );
});
