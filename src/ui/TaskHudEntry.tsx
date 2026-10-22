import { forwardRef } from 'react';
import type { Locale } from '../i18n/resolve';
import { summarize, type HudTask } from './taskHudModel';
import { TASK_HUD_MOCK_TASKS } from './taskHudMockData';
import { githubEntryState, githubTasks, useGitHubData, useHudPrefs, type GitHubEntryState } from './taskHudSource';
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
      githubState={github ? githubEntryState(gh) : undefined}
      tasks={github ? githubTasks(gh) : (tasks ?? TASK_HUD_MOCK_TASKS)}
    />
  );
});

export interface TaskHudEntryViewProps {
  locale: Locale;
  onOpen: () => void;
  source: 'demo' | 'github';
  /** GitHub read state; counts are only shown for complete or partial reads. */
  githubState?: GitHubEntryState;
  tasks?: readonly HudTask[];
}

export const TaskHudEntryView = forwardRef<HTMLButtonElement, TaskHudEntryViewProps>(function TaskHudEntryView({ locale, onOpen, source, githubState = 'idle', tasks }, ref) {
  const text = taskHudText(locale);
  // A failed, unread or in-flight GitHub read has no trustworthy counts: show the state instead of 0/0/0.
  const countable = source === 'demo' || githubState === 'complete' || githubState === 'partial';
  const summary = countable && tasks ? summarize(tasks) : undefined;
  const counts = summary ? { inProgress: summary.inProgress, needsYou: summary.needsYou, attention: summary.attention } : undefined;
  const label =
    source === 'demo'
      ? text.t('entryAria', counts ?? { inProgress: 0, needsYou: 0, attention: 0 })
      : githubState === 'complete' && counts
        ? text.t('entryAriaGithub', counts)
        : githubState === 'partial' && counts
          ? text.t('entryAriaGithubPartial', counts)
          : githubState === 'error'
            ? text.t('entryAriaGithubFailed')
            : githubState === 'loading'
              ? text.t('entryAriaGithubLoading')
              : text.t('entryAriaGithubIdle');
  const stateText =
    githubState === 'error' ? text.t('entryFailed') : githubState === 'loading' ? text.t('entryLoading') : text.t('entryNotLoaded');
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
              {source === 'github' && githubState === 'partial' ? <Badge tone="you">{text.t('entryPartial')}</Badge> : null}
            </>
          ) : githubState === 'error' ? (
            <Badge tone="block">{stateText}</Badge>
          ) : (
            <span className="text-v2-meta text-v2-ink-3">{stateText}</span>
          )}
        </span>
      </Button>
    </V2Scope>
  );
});
