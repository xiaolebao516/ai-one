import { useEffect, useState } from 'react';
import type { Locale } from '../../i18n/resolve';
import { githubWrite, type GithubWriteResult } from '../../host/githubWrite';
import type { HudTask } from '../../ui/taskHudModel';
import { Button, Icon, Notice } from '../../ui/v2';

export interface TaskAcceptanceActionsProps {
  task: HudTask;
  locale: Locale;
  currentHeadSha?: string;
  onAccepted?: () => void;
  onRequestChangesSent?: () => void;
}

export function TaskAcceptanceActions({
  task,
  locale,
  currentHeadSha,
  onAccepted,
  onRequestChangesSent,
}: TaskAcceptanceActionsProps) {
  const isZh = locale.startsWith('zh');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectText, setRejectText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GithubWriteResult | null>(null);
  const [ghAvailable, setGhAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    githubWrite.status().then((s) => {
      if (active) setGhAvailable(s.available);
    });
    return () => {
      active = false;
    };
  }, []);

  const pr = task.pr;
  const isMock = task.dataSource === 'mock';

  if (!task.issue || !pr || task.status !== 'accept') return null;

  const expectedHead = pr.headSha;

  // Check if live HEAD has changed compared to expectedHead from the task PR
  const headMismatch = Boolean(
    currentHeadSha && expectedHead && currentHeadSha.toLowerCase() !== expectedHead.toLowerCase()
  );

  const canWrite = !isMock && ghAvailable && !headMismatch && Boolean(expectedHead);

  const handleAccept = async () => {
    if (!canWrite || submitting || !expectedHead) return;
    setSubmitting(true);
    setResult(null);

    try {
      const res = await githubWrite.accept({
        repo: task.repo,
        issue: task.issue!,
        pr: pr.number,
        expectedHead,
      });
      setResult(res);
      if (res.status === 'confirmed') {
        onAccepted?.();
      }
    } catch (err: unknown) {
      setResult({
        status: 'unconfirmed',
        code: 'unconfirmed',
        message: typeof err === 'string' ? err : '验收操作异常，请先回读，不要重试',
        steps: [],
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!canWrite || submitting || !expectedHead || !rejectText.trim()) return;
    setSubmitting(true);
    setResult(null);

    try {
      const res = await githubWrite.requestChanges({
        repo: task.repo,
        issue: task.issue!,
        pr: pr.number,
        expectedHead,
        text: rejectText.trim(),
      });
      setResult(res);
      if (res.status === 'confirmed') {
        setRejectText('');
        setShowRejectForm(false);
        onRequestChangesSent?.();
      }
    } catch (err: unknown) {
      setResult({
        status: 'unconfirmed',
        code: 'unconfirmed',
        message: typeof err === 'string' ? err : '要求修改操作异常，请先回读，不要重试',
        steps: [],
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-v2-sm flex flex-col gap-v2-sm border-t border-v2-line/60 pt-v2-sm">
      {!ghAvailable && !isMock ? (
        <Notice tone="block">
          {isZh
            ? '未安装 GitHub CLI 或未登录 GitHub，写回操作已禁用。'
            : 'GitHub CLI is not installed or not logged in; write actions are disabled.'}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-v2-sm">
        <div className="flex flex-wrap items-center gap-v2-xs">
          <Button
            data-testid="accept-pass-button"
            size="sm"
            variant="primary"
            disabled={!canWrite || submitting}
            onClick={handleAccept}
            icon={<Icon name="check" size={14} />}
          >
            {headMismatch
              ? isZh
                ? 'HEAD 已更新，先刷新'
                : 'HEAD updated, refresh first'
              : submitting
              ? isZh
                ? '处理中…'
                : 'Processing…'
              : isZh
              ? '验收通过'
              : 'Accept'}
          </Button>

          <Button
            data-testid="request-changes-button"
            size="sm"
            variant="secondary"
            disabled={!canWrite || submitting}
            onClick={() => setShowRejectForm(!showRejectForm)}
            icon={<Icon name="edit" size={14} />}
          >
            {isZh ? '要求修改…' : 'Request changes…'}
          </Button>
        </div>

        <span className="text-v2-micro text-v2-ink-3">
          {isZh ? '验收通过（不会合并）' : 'Acceptance (will not merge)'}
          {expectedHead ? ` · HEAD: ${expectedHead.slice(0, 7)}` : ''}
        </span>
      </div>

      {showRejectForm ? (
        <div className="grid gap-v2-xs rounded-v2-md bg-v2-sunken p-v2-sm">
          <label className="text-v2-meta font-medium text-v2-ink">
            {isZh ? '修改意见（必填，将作为评论发出并附带完整 HEAD）：' : 'Change request notes (Required):'}
          </label>
          <textarea
            data-testid="request-changes-input"
            value={rejectText}
            disabled={submitting}
            onChange={(e) => setRejectText(e.target.value)}
            rows={3}
            placeholder={isZh ? '说明哪些地方不符合要求、期望怎么修改…' : 'Explain what needs fixing…'}
            className="w-full rounded border border-v2-line bg-v2-panel p-v2-xs text-v2-body text-v2-ink focus:border-v2-accent focus:outline-none"
          />
          <div className="flex justify-end gap-v2-xs">
            <Button size="sm" variant="ghost" onClick={() => setShowRejectForm(false)}>
              {isZh ? '取消' : 'Cancel'}
            </Button>
            <Button
              data-testid="request-changes-submit"
              size="sm"
              variant="primary"
              disabled={!rejectText.trim() || submitting || !canWrite}
              onClick={handleRequestChanges}
            >
              {submitting ? (isZh ? '提交中…' : 'Submitting…') : isZh ? '提交修改要求' : 'Submit changes'}
            </Button>
          </div>
        </div>
      ) : null}

      {result ? (
        <Notice
          tone={
            result.status === 'confirmed'
              ? 'done'
              : result.status === 'partial'
              ? 'rework'
              : result.status === 'unconfirmed'
              ? 'unknown'
              : 'block'
          }
        >
          <span className="font-medium">
            {result.status === 'confirmed' && (isZh ? '已确认：' : 'Confirmed: ')}
            {result.status === 'partial' && (isZh ? '部分成功：' : 'Partial: ')}
            {result.status === 'unconfirmed' && (isZh ? '状态未知：' : 'Unconfirmed: ')}
            {result.status === 'failed' && (isZh ? '失败：' : 'Failed: ')}
          </span>
          {result.message}
        </Notice>
      ) : null}
    </div>
  );
}
