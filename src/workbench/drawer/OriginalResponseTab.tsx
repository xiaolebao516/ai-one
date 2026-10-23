import type { Locale } from '../../i18n/resolve';
import { pickText, type HudTask } from '../../ui/taskHudModel';
import { taskHudText } from '../../ui/taskHudText';
import { Badge, Card, Notice } from '../../ui/v2';

export interface OriginalResponseTabProps {
  task: HudTask;
  locale: Locale;
}

export function OriginalResponseTab({ task, locale }: OriginalResponseTabProps) {
  const isZh = locale.startsWith('zh');
  const hud = taskHudText(locale);

  // Evidence items that carry raw verbatim text or readback material
  const rawEvidences = task.evidence.filter((item) => item.raw || item.kind === 'readback');

  return (
    <div className="grid content-start gap-v2-md">
      <Notice tone="neutral">
        {isZh
          ? '原始回复仅显示回读到的 GitHub 评论与 PR 内容，不含 AI 网页对话正文（任务检查器不读取网页内容）。'
          : 'Original responses show only read-back GitHub comments and PR content; AI web chat bodies are excluded.'}
      </Notice>

      {task.review && task.review.verdict !== 'none' ? (
        <Card padding="md" className="grid content-start gap-v2-xs">
          <div className="flex flex-wrap items-center justify-between gap-v2-sm">
            <span className="font-semibold text-v2-ink">
              {isZh ? 'GitHub 独立审计评论' : 'GitHub Independent Review Comment'}
            </span>
            <Badge tone={task.review.verdict === 'pass' ? 'done' : task.review.verdict === 'revise' ? 'rework' : task.review.verdict === 'blocked' ? 'block' : 'neutral'}>
              {hud.verdict(task.review.verdict)}
            </Badge>
          </div>
          {task.review.truncated ? (
            <Notice tone="you">
              {isZh
                ? '审查记录未读全（受分页上限或读取错误影响），不能确认最新裁定。'
                : 'Review history is incomplete (truncated or read error); cannot confirm latest verdict.'}
            </Notice>
          ) : null}
          {task.review.by ? (
            <p className="text-v2-micro text-v2-ink-3">
              {isZh ? '评审者' : 'Reviewer'}: {pickText(task.review.by, locale)}
            </p>
          ) : null}
          {task.review.headSha ? (
            <p className="font-v2-mono text-v2-micro text-v2-ink-2">HEAD: {task.review.headSha}</p>
          ) : null}
        </Card>
      ) : null}

      {rawEvidences.length > 0 ? (
        <div className="grid gap-v2-sm">
          <h4 className="text-v2-meta font-medium text-v2-ink-2">
            {isZh ? '已回读的记录与原文' : 'Read-back records and verbatim material'}
          </h4>
          {rawEvidences.map((item) => (
            <Card key={item.id} padding="sm" className="grid content-start gap-v2-xs">
              <div className="flex flex-wrap items-center justify-between gap-v2-sm">
                <span className="text-v2-body text-v2-ink">{pickText(item.text, locale)}</span>
                <Badge tone={item.kind === 'readback' ? 'done' : 'neutral'}>
                  {hud.evidence(item.kind, task.dataSource)}
                </Badge>
              </div>
              {item.raw ? (
                <pre className="mt-v2-xs max-h-60 overflow-auto whitespace-pre-wrap rounded-v2-sm bg-v2-sunken p-v2-sm font-v2-mono text-v2-micro text-v2-ink-2">
                  {item.raw}
                </pre>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}

      {!task.review && rawEvidences.length === 0 ? (
        <Card padding="md" className="grid content-start gap-v2-xs text-center text-v2-meta text-v2-ink-3">
          <p>{isZh ? '暂无已回读的 GitHub 回复原文' : 'No read-back GitHub verbatim responses available.'}</p>
        </Card>
      ) : null}
    </div>
  );
}
