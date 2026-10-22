import { forwardRef } from 'react';
import type { Locale } from '../i18n/resolve';
import { summarize, type HudTask } from './taskHudModel';
import { TASK_HUD_MOCK_TASKS } from './taskHudMockData';
import { taskHudText } from './taskHudText';
import { Badge, Button, Icon, StatusIndicator, V2Scope } from './v2';

export interface TaskHudEntryProps {
  locale: Locale;
  onOpen: () => void;
  tasks?: readonly HudTask[];
}

/**
 * Compact HUD entry for the chat toolbar (#40): in progress / needs you / failed-or-unknown counts
 * from the same (demo) data the HUD shows, marked as demo. One button; it opens the HUD overview,
 * whose counters lead to the filtered list. The v2 scope follows the app theme.
 */
export const TaskHudEntry = forwardRef<HTMLButtonElement, TaskHudEntryProps>(function TaskHudEntry(
  { locale, onOpen, tasks = TASK_HUD_MOCK_TASKS },
  ref,
) {
  const text = taskHudText(locale);
  const summary = summarize(tasks);
  const label = text.t('entryAria', { inProgress: summary.inProgress, needsYou: summary.needsYou, attention: summary.attention });
  return (
    <V2Scope className="inline-flex">
      <Button ref={ref} size="sm" onClick={onOpen} aria-label={label} title={label} icon={<Icon name="layers" size={14} />} data-testid="task-hud-entry">
        <span className="inline-flex items-center gap-1.5">
          <span>{text.t('entryLabel')}</span>
          <Badge>{text.t('entryDemo')}</Badge>
          <StatusIndicator tone="run" label={String(summary.inProgress)} />
          <StatusIndicator tone="you" label={String(summary.needsYou)} />
          <StatusIndicator tone="unknown" label={String(summary.attention)} />
        </span>
      </Button>
    </V2Scope>
  );
});
