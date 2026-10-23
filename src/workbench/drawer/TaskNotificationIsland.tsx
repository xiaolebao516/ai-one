import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../../i18n/resolve';
import { isNeedsYou, pickText, type HudTask } from '../../ui/taskHudModel';
import { taskHudText } from '../../ui/taskHudText';
import { Badge, Button, Icon, IconButton } from '../../ui/v2';

export interface TaskNotificationIslandProps {
  task?: HudTask;
  tasks?: readonly HudTask[];
  locale: Locale;
  currentTaskId?: string;
  onNavigate?: (task?: HudTask) => void;
}

export function TaskNotificationIsland({
  task,
  tasks,
  locale,
  currentTaskId,
  onNavigate,
}: TaskNotificationIslandProps) {
  const isZh = locale.startsWith('zh');
  const hud = taskHudText(locale);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set());
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const notifiedKeysRef = useRef<Set<string>>(new Set());

  // Aggregate candidate tasks from `tasks` or `task`
  const allTasks: readonly HudTask[] = tasks && tasks.length > 0 ? tasks : task ? [task] : [];
  const needsYouTasks = allTasks.filter((t) => isNeedsYou(t.status));

  // Desktop notifications: monitor all needs-you tasks independently
  useEffect(() => {
    if (needsYouTasks.length === 0) return;

    const triggerNotifications = () => {
      if (typeof document === 'undefined' || !document.hidden) return;
      if (typeof window === 'undefined' || !('Notification' in window)) return;

      for (const t of needsYouTasks) {
        const key = `${t.id}:${t.status}`;
        if (notifiedKeysRef.current.has(key)) continue;

        const category = t.status === 'blocked'
          ? (isZh ? '【阻塞】' : '[Blocked]')
          : t.status === 'accept'
          ? (isZh ? '【验收】' : '[Acceptance]')
          : (isZh ? '【决策】' : '[Decision]');

        const title = isZh
          ? `${category} ai-one: 任务需要你处理`
          : `${category} ai-one: Task needs you`;
        const body = `${t.repo} · ${pickText(t.title, locale)}`;

        const show = () => {
          try {
            notifiedKeysRef.current.add(key);
            const n = new Notification(title, { body });
            n.onclick = () => {
              window.focus();
              onNavigateRef.current?.(t);
            };
          } catch {
            /* ignore notification error */
          }
        };

        if (Notification.permission === 'granted') {
          show();
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then((perm) => {
            if (perm === 'granted') show();
          });
        }
      }
    };

    triggerNotifications();
    document.addEventListener('visibilitychange', triggerNotifications);
    return () => {
      document.removeEventListener('visibilitychange', triggerNotifications);
    };
  }, [needsYouTasks, locale, isZh]);

  // For on-screen UI island: pick the first candidate that isn't dismissed and not currently viewed
  const visibleTasks = needsYouTasks.filter((t) => !dismissedKeys.has(`${t.id}:${t.status}`) && t.id !== currentTaskId);
  if (visibleTasks.length === 0) return null;

  const currentItem = visibleTasks[0];
  const moreCount = visibleTasks.length - 1;

  const handleDismiss = () => {
    setDismissedKeys((prev) => {
      const next = new Set(prev);
      next.add(`${currentItem.id}:${currentItem.status}`);
      return next;
    });
  };

  const handleView = () => {
    onNavigateRef.current?.(currentItem);
  };

  return (
    <aside
      data-testid="notification-island"
      aria-label={isZh ? '任务需要你通知' : 'Task needs you notification'}
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-v2-sm rounded-v2-lg border border-v2-line bg-v2-ink p-v2-sm text-v2-bg shadow-xl"
    >
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-v2-xs">
          <Badge tone={currentItem.status === 'blocked' ? 'block' : 'you'}>
            {hud.needKind(currentItem.status)}
          </Badge>
          <span className="text-v2-micro opacity-75">{currentItem.repo}</span>
          {moreCount > 0 ? (
            <Badge tone="neutral" className="text-v2-micro">
              +{moreCount}
            </Badge>
          ) : null}
        </div>
        <p className="line-clamp-1 text-v2-meta font-medium">{pickText(currentItem.title, locale)}</p>
      </div>

      <div className="flex items-center gap-1">
        {onNavigate ? (
          <Button size="sm" variant="ghost" onClick={handleView}>
            {isZh ? '查看' : 'View'}
          </Button>
        ) : null}
        <IconButton
          size="sm"
          variant="ghost"
          label={isZh ? '忽略通知' : 'Dismiss'}
          icon={<Icon name="close" size={14} />}
          onClick={handleDismiss}
        />
      </div>
    </aside>
  );
}
