import type { Locale } from '../../i18n/resolve';
import { Button, Icon } from '../../ui/v2';

export interface TaskTakeoverBannerProps {
  participantName: string;
  locale: Locale;
  onExit: () => void;
}

export function TaskTakeoverBanner({ participantName, locale, onExit }: TaskTakeoverBannerProps) {
  const isZh = locale.startsWith('zh');

  return (
    <div
      data-testid="takeover-banner"
      className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-v2-sm border-b border-amber-500/30 bg-amber-500/10 px-v2-md py-v2-xs backdrop-blur-sm"
    >
      <div className="flex items-center gap-v2-xs text-v2-meta font-medium text-amber-700 dark:text-amber-300">
        <Icon name="alertTriangle" size={16} />
        <span>
          {isZh
            ? `你正在自己操作 ${participantName} 的网页。ai-one 不会读取网页内容。`
            : `You are manually operating the ${participantName} web page. ai-one does not read page content.`}
        </span>
      </div>
      <Button size="sm" variant="secondary" onClick={onExit}>
        {isZh ? '回到任务' : 'Back to task'}
      </Button>
    </div>
  );
}
