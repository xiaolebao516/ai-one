import type { Locale } from '../../i18n/resolve';
import { effectiveCi, pickText, type HudTask } from '../../ui/taskHudModel';
import { taskHudText } from '../../ui/taskHudText';
import { Badge, Card } from '../../ui/v2';

export interface TestsTabProps {
  task: HudTask;
  locale: Locale;
}

export function TestsTab({ task, locale }: TestsTabProps) {
  const isZh = locale.startsWith('zh');
  const hud = taskHudText(locale);
  const ci = effectiveCi(task);

  const localRuns = task.evidence.filter((item) => item.kind === 'local');

  const ciTone =
    ci.state === 'success'
      ? 'done'
      : ci.state === 'failure'
      ? 'block'
      : ci.state === 'running'
      ? 'run'
      : 'unknown';

  return (
    <div className="grid content-start gap-v2-md">
      <Card padding="md" className="grid content-start gap-v2-xs">
        <div className="flex flex-wrap items-center justify-between gap-v2-sm">
          <span className="font-semibold text-v2-ink">GitHub CI / Actions</span>
          <div className="flex items-center gap-v2-xs">
            <Badge tone={ciTone}>{hud.ci(ci.state)}</Badge>
            <Badge tone={ci.state === 'unknown' ? 'unknown' : 'done'}>
              {ci.state === 'unknown' ? (isZh ? '未运行' : 'Not run') : isZh ? '已回读' : 'Read back'}
            </Badge>
          </div>
        </div>
        {task.ci?.detail ? <p className="text-v2-meta text-v2-ink-2">{pickText(task.ci.detail, locale)}</p> : null}
        {ci.state === 'unknown' && ci.reason ? (
          <p className="text-v2-micro text-v2-ink-3">{hud.ciReason(ci.reason)}</p>
        ) : null}
        {ci.headSha ? (
          <p className="font-v2-mono text-v2-micro text-v2-ink-3">HEAD: {ci.headSha}</p>
        ) : null}
      </Card>

      <div className="grid gap-v2-sm">
        <h4 className="text-v2-meta font-medium text-v2-ink-2">
          {isZh ? '本机运行与执行证据' : 'Local machine test runs & evidence'}
        </h4>

        {localRuns.length > 0 ? (
          localRuns.map((item) => (
            <Card key={item.id} padding="sm" className="grid content-start gap-v2-xs">
              <div className="flex flex-wrap items-center justify-between gap-v2-sm">
                <span className="text-v2-body text-v2-ink">{pickText(item.text, locale)}</span>
                <Badge tone="run">{isZh ? 'CC 本机运行' : 'Local run'}</Badge>
              </div>
              {item.raw ? (
                <pre className="mt-v2-xs max-h-48 overflow-auto whitespace-pre-wrap rounded-v2-sm bg-v2-sunken p-v2-sm font-v2-mono text-v2-micro text-v2-ink-2">
                  {item.raw}
                </pre>
              ) : null}
            </Card>
          ))
        ) : (
          <Card padding="md" className="grid content-start gap-v2-xs text-center text-v2-meta text-v2-ink-3">
            <p>
              {task.dataSource === 'github'
                ? (isZh ? '本机运行测试记录不可用（GitHub 任务快照不包含本机执行日志）' : 'Local run records unavailable (GitHub task snapshot does not include local runner logs).')
                : (isZh ? '暂无本机运行测试记录（未运行）' : 'No local machine test run recorded (Not run).')}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
