import { useState } from 'react';
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

  if (!task.issue) return null;

  const isMock = task.dataSource === 'mock';

  const preview = text.trim() ? formatCommentBody(text) : '';

  const handleSubmit = async () => {
    if (!text.trim() || isMock || submitting) return;
    setSubmitting(true);
    setResult(null);

    try {
      const res = await githubWrite.comment({
        repo: task.repo,
        issue: task.issue!,
        text: text.trim(),
      });
      setResult(res);
      if (res.outcome === 'confirmed') {
        setText('');
        onCommentSent?.(text.trim());
      }
    } catch (err: unknown) {
      setResult({
        outcome: 'failed',
        message: typeof err === 'string' ? err : '留言操作异常',
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

      <div className="grid gap-v2-xs">
        <textarea
          data-testid="comment-input"
          value={text}
          disabled={isMock || submitting}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            isMock
              ? isZh
                ? '演示数据，留言功能已禁用'
                : 'Demo mode: commenting disabled'
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
          disabled={!text.trim() || isMock || submitting}
          onClick={handleSubmit}
          icon={<Icon name="arrowRight" size={14} />}
        >
          {submitting ? (isZh ? '发送中…' : 'Sending…') : isZh ? '留言' : 'Post comment'}
        </Button>
      </div>

      {result ? (
        <Notice
          tone={
            result.outcome === 'confirmed'
              ? 'done'
              : result.outcome === 'partial'
              ? 'rework'
              : result.outcome === 'unconfirmed'
              ? 'unknown'
              : 'block'
          }
        >
          <span className="font-medium">
            {result.outcome === 'confirmed' && (isZh ? '已确认：' : 'Confirmed: ')}
            {result.outcome === 'partial' && (isZh ? '部分成功：' : 'Partial: ')}
            {result.outcome === 'unconfirmed' && (isZh ? '已发出未确认：' : 'Unconfirmed: ')}
            {result.outcome === 'failed' && (isZh ? '发送失败：' : 'Failed: ')}
          </span>
          {result.message}
        </Notice>
      ) : null}
    </Card>
  );
}
