import { useEffect, useRef, useState } from 'react';
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
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const notifiedKeyRef = useRef<string>('');

  const needsAction = isNeedsYou(task.status);

  // Reset dismissed state if task ID or status changes to another needsYou
  useEffect(() => {
    setDismissed(false);
  }, [task.id, task.status]);

  // When window is in background / hidden, trigger desktop notification with category and action routing
  useEffect(() => {
    if (!needsAction || dismissed) return;

    const key = `${task.id}:${task.status}`;

    const triggerNotification = () => {
      if (typeof document === 'undefined' || !document.hidden) return;
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (notifiedKeyRef.current === key) return;

      const category = task.status === 'blocked'
        ? (isZh ? '【阻塞】' : '[Blocked]')
        : task.status === 'accept'
        ? (isZh ? '【验收】' : '[Acceptance]')
        : (isZh ? '【决策】' : '[Decision]');

      const title = isZh
        ? `${category} ai-one: 任务需要你处理`
        : `${category} ai-one: Task needs you`;
      const body = `${task.repo} · ${pickText(task.title, locale)}`;

      const show = () => {
        try {
          notifiedKeyRef.current = key;
          const n = new Notification(title, { body });
          n.onclick = () => {
            window.focus();
            onNavigateRef.current?.();
          };
        } catch { /* ignore */ }
      };

      if (Notification.permission === 'granted') {
        show();
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') show();
        });
      }
    };

    triggerNotification();
    document.addEventListener('visibilitychange', triggerNotification);
    return () => {
      document.removeEventListener('visibilitychange', triggerNotification);
    };
  }, [needsAction, dismissed, task.id, task.status, task.repo, task.title, locale, isZh]);

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
