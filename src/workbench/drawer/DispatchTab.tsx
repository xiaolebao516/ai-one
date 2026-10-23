import type { DispatchSnapshot } from '../../dispatch/types';
import type { Locale } from '../../i18n/resolve';
import type { HudTask } from '../../ui/taskHudModel';
import { Card, Notice } from '../../ui/v2';
import { DispatchReceipts } from '../../ui/v2/DispatchReceipts';

export interface DispatchTabProps {
  task: HudTask;
  locale: Locale;
  snapshot?: DispatchSnapshot;
}

export function DispatchTab({ task, locale, snapshot }: DispatchTabProps) {
  const isZh = locale.startsWith('zh');

  return (
    <div className="grid content-start gap-v2-md">
      <Notice tone="neutral">
        {isZh
          ? '派工单仅显示 Prodex 槽位与请求回执元数据，不含 AI 网页对话正文。'
          : 'Dispatch tab displays Prodex slot and receipt metadata only; AI web conversation bodies are excluded.'}
      </Notice>

      {snapshot ? (
        <DispatchReceipts
          snapshot={snapshot}
          source={task.dataSource === 'mock' ? 'demo' : 'local'}
          locale={locale}
        />
      ) : (
        <Card padding="md" className="grid content-start gap-v2-xs text-center text-v2-meta text-v2-ink-3">
          <p>{isZh ? '暂无关联的派工回执记录' : 'No associated dispatch receipt records.'}</p>
          <p className="text-v2-micro">
            {isZh
              ? '任务尚未产生 Prodex 派工回执，或派工元数据保存在本机其他目录。'
              : 'No Prodex dispatch receipts recorded yet, or records are saved in another local directory.'}
          </p>
        </Card>
      )}
    </div>
  );
}
