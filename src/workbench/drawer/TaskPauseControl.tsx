import { useEffect, useState } from 'react';
import type { Locale } from '../../i18n/resolve';
import { githubWrite, type GithubWriteResult } from '../../host/githubWrite';
import { isInProgress, type HudTask } from '../../ui/taskHudModel';
import { Badge, Button, Icon, Notice } from '../../ui/v2';

export type PauseState = 'paused' | 'running' | 'none' | 'unknown';

export interface TaskPauseControlProps {
  task: HudTask;
  locale: Locale;
  initialPauseState?: PauseState;
  onStateChange?: (state: PauseState) => void;
}

export function TaskPauseControl({
  task,
  locale,
  initialPauseState = 'none',
  onStateChange,
}: TaskPauseControlProps) {
  const isZh = locale.startsWith('zh');
  const [pauseState, setPauseState] = useState<PauseState>(initialPauseState);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GithubWriteResult | null>(null);
  const [ghAvailable, setGhAvailable] = useState(false);
  const [_probed, setProbed] = useState(false);

  useEffect(() => {
    let active = true;
    githubWrite.status().then((s) => {
      if (active) {
        setGhAvailable(s.available);
        setProbed(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setPauseState(initialPauseState);
  }, [initialPauseState]);

  // Only show when in progress and has a GitHub issue
  if (!isInProgress(task.status) || !task.issue) return null;

  const isMock = task.dataSource === 'mock';
  const isPaused = pauseState === 'paused';
  const isCommentsIncomplete =
    pauseState === 'unknown' ||
    (task.commentsCompleteness !== undefined && task.commentsCompleteness !== 'complete');
  const canWrite = !isMock && ghAvailable && !isCommentsIncomplete;

  const handleToggle = async () => {
    if (!canWrite || submitting) return;
    setSubmitting(true);
    setResult(null);

    const nextState: 'paused' | 'running' = isPaused ? 'running' : 'paused';

    try {
      const res = await githubWrite.setPause({
        repo: task.repo,
        issue: task.issue!,
        state: nextState,
      });
      setResult(res);

      if (res.status === 'confirmed') {
        setPauseState(nextState);
        onStateChange?.(nextState);
      }
    } catch (err: unknown) {
      setResult({
        status: 'unconfirmed',
        code: 'unconfirmed',
        message: typeof err === 'string' ? err : '暂停操作异常，请先回读，不要重试',
        steps: [],
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-v2-xs">
        {isCommentsIncomplete ? (
          <Badge tone="unknown">{isZh ? '暂停状态未确认' : 'Pause unconfirmed'}</Badge>
        ) : isPaused ? (
          <Badge tone="paused">{isZh ? '已暂停' : 'Paused'}</Badge>
        ) : null}

        <Button
          data-testid="pause-toggle-button"
          size="sm"
          variant={isPaused ? 'primary' : 'secondary'}
          disabled={!canWrite || submitting}
          onClick={handleToggle}
          icon={<Icon name={isPaused ? 'play' : 'pause'} size={14} />}
        >
          {submitting
            ? isZh
              ? '提交中…'
              : 'Updating…'
            : isCommentsIncomplete
            ? isZh
              ? '暂停状态未确认'
              : 'Status unconfirmed'
            : isPaused
            ? isZh
              ? '继续'
              : 'Resume'
            : isZh
            ? '暂停'
              : 'Pause'}
        </Button>

        <span className="text-v2-micro text-v2-ink-3">
          {isCommentsIncomplete
            ? isZh
              ? '评论未完整读取，禁止反向写入；请先刷新以获取完整记录。'
              : 'Comments incomplete; pause toggle disabled to prevent conflicting state. Please refresh.'
            : isMock
            ? isZh
              ? '演示数据，不会真正暂停'
              : 'Demo mode: pause disabled'
            : isZh
            ? 'CC 正在执行的这一步会跑完；下一步起读到暂停就停。'
            : 'CC will finish the ongoing step, then halt at the next.'}
        </span>
      </div>

      {result && result.status !== 'confirmed' ? (
        <Notice
          tone={result.status === 'unconfirmed' ? 'unknown' : 'block'}
        >
          {result.status === 'unconfirmed'
            ? isZh
              ? '已发出，但没能确认（未改动暂停状态，请刷新检查）'
              : 'Command sent but could not be confirmed'
            : result.message}
        </Notice>
      ) : null}
    </div>
  );
}
