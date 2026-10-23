import { useEffect, useState } from 'react';
import type { Locale } from '../../i18n/resolve';
import { isNeedsYou, pickText, type HudTask } from '../../ui/taskHudModel';
import { taskHudText } from '../../ui/taskHudText';
import { Badge, Button, Icon, IconButton } from '../../ui/v2';

export interface TaskNotificationIslandProps {
  task: HudTask;
  locale: Locale;
  onNavigate?: () => void;
}

export function TaskNotificationIsland({ task, locale, onNavigate }: TaskNotificationIslandProps) {
  const isZh = locale.startsWith('zh');
  const hud = taskHudText(locale);
  const [dismissed, setDismissed] = useState(false);

  const needsAction = isNeedsYou(task.status);

  // Reset dismissed state if task status changes to another needsYou
  useEffect(() => {
    setDismissed(false);
  }, [task.status]);

  // When window is in background / hidden, trigger desktop notification if available
  useEffect(() => {
    if (!needsAction || dismissed) return;
    if (typeof document !== 'undefined' && document.hidden) {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(isZh ? 'ai-one: 任务需要你处理' : 'ai-one: Task needs you', {
            body: pickText(task.title, locale),
          });
          n.onclick = () => {
            window.focus();
            onNavigate?.();
          };
        } catch {
          // ignore notification errors
        }
      }
    }
  }, [needsAction, dismissed, task.title, locale, isZh, onNavigate]);

  if (!needsAction || dismissed) return null;

  return (
    <aside
      data-testid="notification-island"
      aria-label={isZh ? '任务需要你通知' : 'Task needs you notification'}
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-v2-sm rounded-v2-lg border border-v2-line bg-v2-ink p-v2-sm text-v2-bg shadow-xl"
    >
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-v2-xs">
          <Badge tone={task.status === 'blocked' ? 'block' : 'you'}>
            {hud.needKind(task.status)}
          </Badge>
          <span className="text-v2-micro opacity-75">{task.repo}</span>
        </div>
        <p className="line-clamp-1 text-v2-meta font-medium">{pickText(task.title, locale)}</p>
      </div>

      <div className="flex items-center gap-1">
        {onNavigate ? (
          <Button size="sm" variant="ghost" onClick={onNavigate}>
            {isZh ? '查看' : 'View'}
          </Button>
        ) : null}
        <IconButton
          size="sm"
          variant="ghost"
          label={isZh ? '忽略通知' : 'Dismiss'}
          icon={<Icon name="close" size={14} />}
          onClick={() => setDismissed(true)}
        />
      </div>
    </aside>
  );
}
