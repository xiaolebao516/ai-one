import type { Locale } from '../../i18n/resolve';
import type { HudTask } from '../../ui/taskHudModel';
import { Badge, Button, Card, Icon } from '../../ui/v2';

export interface DiffTabProps {
  task: HudTask;
  locale: Locale;
}

export function DiffTab({ task, locale }: DiffTabProps) {
  const isZh = locale.startsWith('zh');
  const pr = task.pr;

  const diffUrl = pr
    ? `https://github.com/${task.repo}/pull/${pr.number}/files`
    : undefined;

  return (
    <div className="grid content-start gap-v2-md">
      {pr ? (
        <Card padding="md" className="grid content-start gap-v2-sm">
          <div className="flex flex-wrap items-center justify-between gap-v2-sm">
            <span className="font-semibold text-v2-ink">
              PR #{pr.number} {pr.draft ? `(${isZh ? '草稿' : 'Draft'})` : ''}
            </span>
            <Badge tone="run">{isZh ? '有变更' : 'Has diff'}</Badge>
          </div>

          {pr.headSha ? (
            <div className="grid gap-1">
              <span className="text-v2-micro text-v2-ink-3">HEAD SHA</span>
              <code className="overflow-x-auto rounded-v2-sm bg-v2-sunken p-1 font-v2-mono text-v2-micro text-v2-ink-2 select-all">
                {pr.headSha}
              </code>
            </div>
          ) : null}

          <p className="text-v2-meta text-v2-ink-3">
            {isZh
              ? '本期不在 ai-one 内直接渲染文件 Diff。请在 GitHub 查看完整变更对比与代码行：'
              : 'Diff rendering inside ai-one is not supported in this phase. View the full diff on GitHub:'}
          </p>

          {diffUrl ? (
            <div>
              <Button
                variant="secondary"
                size="sm"
                icon={<Icon name="externalLink" size={14} />}
                onClick={() => {
                  window.open(diffUrl, '_blank', 'noopener,noreferrer');
                }}
              >
                {isZh ? '在 GitHub 打开 PR Files' : 'Open PR Files on GitHub'}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card padding="md" className="grid content-start gap-v2-xs text-center text-v2-meta text-v2-ink-3">
          <p>{isZh ? '当前任务尚未关联或未创建 Pull Request' : 'No Pull Request associated with this task.'}</p>
          <p className="text-v2-micro">
            {isZh
              ? '当调度 agent 或 CC 创建 PR 并建立关联后，此处可直接跳转查看 Diff。'
              : 'Once a PR is opened, you can jump directly to its diff from here.'}
          </p>
        </Card>
      )}
    </div>
  );
}
