import { useEffect, useState } from 'react';
import type { Locale } from '../../i18n/resolve';
import { formatCommentBody, githubWrite, type GithubWriteResult } from '../../host/githubWrite';
import type { HudTask } from '../../ui/taskHudModel';
import { Button, Card, Icon, Notice } from '../../ui/v2';

export interface TaskCommentBoxProps {
  task: HudTask;
  locale: Locale;
  onCommentSent?: (text: string) => void;
}

export function TaskCommentBox({ task, locale, onCommentSent }: TaskCommentBoxProps) {
  const isZh = locale.startsWith('zh');
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GithubWriteResult | null>(null);
  const [ghAvailable, setGhAvailable] = useState(false);
  const [probed, setProbed] = useState(false);

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

  if (!task.issue) return null;

  const isMock = task.dataSource === 'mock';
  const preview = text.trim() ? formatCommentBody(text.trim()) : '';
  const canWrite = !isMock && ghAvailable;

  const handleSubmit = async () => {
    if (!text.trim() || !canWrite || submitting) return;
    setSubmitting(true);
    setResult(null);

    try {
      const res = await githubWrite.comment({
        repo: task.repo,
        issue: task.issue!,
        text: text.trim(),
      });
      setResult(res);
      if (res.status === 'confirmed') {
        setText('');
        onCommentSent?.(text.trim());
      }
    } catch (err: unknown) {
      setResult({
        status: 'unconfirmed',
        code: 'unconfirmed',
        message: typeof err === 'string' ? err : '留言操作异常，请先回读，不要重试',
        steps: [],
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card padding="md" className="grid content-start gap-v2-sm border-t border-v2-line">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-v2-xs">
          <Icon name="chat" size={16} />
          <h3 className="font-semibold text-v2-ink">{isZh ? '给 CC 留言' : 'Leave a message for CC'}</h3>
        </div>
        <span className="text-v2-micro text-v2-ink-3">
          {isZh ? '写成 Issue 评论，注明来自你；CC 下次读到 Issue 时会看到。' : 'Appends as an Issue comment for CC.'}
        </span>
      </div>

      {probed && !ghAvailable && !isMock ? (
        <Notice tone="block">
          {isZh
            ? '未安装 GitHub CLI 或未登录 GitHub，留言功能已禁用。'
            : 'GitHub CLI is not installed or not logged in; commenting is disabled.'}
        </Notice>
      ) : null}

      <div className="grid gap-v2-xs">
        <textarea
          data-testid="comment-input"
          value={text}
          disabled={!canWrite || submitting}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            isMock
              ? isZh
                ? '演示数据，留言功能已禁用'
                : 'Demo mode: commenting disabled'
              : !ghAvailable
              ? isZh
                ? 'GitHub CLI 未就绪，无法留言'
                : 'GitHub CLI not ready, commenting disabled'
              : isZh
              ? '输入给 CC 的留言或指令…（评论发出后不能撤回）'
              : 'Message or instructions for CC... (Cannot be undone)'
          }
          rows={3}
          className="w-full resize-none rounded-v2-md border border-v2-line bg-v2-sunken p-v2-sm text-v2-body text-v2-ink placeholder:text-v2-ink-3 focus:border-v2-accent focus:outline-none disabled:opacity-50"
        />

        {preview ? (
          <details className="text-v2-micro text-v2-ink-3">
            <summary className="cursor-pointer hover:text-v2-ink">
              {isZh ? '将发出的评论预览（只读提示）' : 'Preview of comment to be posted (Read-only)'}
            </summary>
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-v2-sunken/80 p-2 font-v2-mono text-v2-micro text-v2-ink-2">
              {preview}
            </pre>
          </details>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-v2-sm">
        <span className="text-v2-micro text-v2-ink-3">
          {isMock
            ? isZh
              ? '演示数据，不会真的发出'
              : 'Demo data: will not actually send'
            : isZh
            ? '评论发出后不能撤回'
            : 'Comments cannot be retracted once posted'}
        </span>

        <Button
          data-testid="comment-submit"
          size="sm"
          variant="primary"
          disabled={!text.trim() || !canWrite || submitting}
          onClick={handleSubmit}
          icon={<Icon name="arrowRight" size={14} />}
        >
          {submitting ? (isZh ? '发送中…' : 'Sending…') : isZh ? '留言' : 'Post comment'}
        </Button>
      </div>

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
            {result.status === 'unconfirmed' && (isZh ? '已发出未确认：' : 'Unconfirmed: ')}
            {result.status === 'failed' && (isZh ? '发送失败：' : 'Failed: ')}
          </span>
          {result.message}
        </Notice>
      ) : null}
    </Card>
  );
}
