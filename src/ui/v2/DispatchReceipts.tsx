import type { DispatchSnapshot, DispatchStatus } from '../../dispatch/types';
import { Badge, Card, EmptyState, Notice, StatusIndicator, type V2StatusTone } from '.';

const STATES: Record<DispatchStatus, { label: string; tone: V2StatusTone }> = {
  running: { label: '进行中', tone: 'run' }, completed: { label: '已完成', tone: 'done' },
  timeout: { label: '超时', tone: 'block' }, request_mismatch: { label: '请求不匹配', tone: 'block' },
  recovered: { label: '已恢复', tone: 'done' }, blocked: { label: '已阻塞', tone: 'block' },
  preview: { label: '待发送', tone: 'paused' }, unknown: { label: '待核实', tone: 'unknown' },
};
const SLOT_LABEL = { idle: '无占用记录', claimed: '有占用记录', stale: '心跳已过期', unknown: '记录不可用' };
const formatTime = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未记录';

/** Presentational component: supply parsed metadata from host.dispatch.snapshot(repoPath).
 * Local observations only; no reply access, dispatch, or recovery actions. */
export function DispatchReceipts({ snapshot, source }: { snapshot: DispatchSnapshot; source: 'demo' | 'local' }) {
  return (
    <div className="flex min-w-0 flex-col gap-v2-md" data-testid="dispatch-receipts">
      <div className="flex flex-wrap items-center gap-v2-sm">
        <Badge tone={source === 'demo' ? 'neutral' : 'run'}>{source === 'demo' ? '演示数据' : '本机元数据'}</Badge>
        <span className="text-v2-meta text-v2-ink-2">只读 · {snapshot.events.length} 条记录 · 不包含回复正文</span>
      </div>
      {snapshot.warnings.map((warning) => <Notice key={warning} tone="block" title={warning} />)}
      <div className="flex flex-wrap gap-v2-sm" aria-label="派工槽位">
        {snapshot.slots.map((slot) => (
          <Card key={slot.id} className="min-w-40 flex-1 p-v2-md">
            <div className="flex flex-wrap items-center gap-v2-sm"><strong className="text-v2-body">槽位 {slot.id}</strong><Badge>{SLOT_LABEL[slot.state]}</Badge></div>
            <div className="mt-v2-sm break-all text-v2-meta text-v2-ink-2">{slot.task ?? '任务未记录'} · {slot.sessionKey ?? '会话未记录'}</div>
            <div className="text-v2-meta text-v2-ink-2">端口 {slot.port} · 浏览器未探测</div>
            {slot.pid ? <div className="text-v2-meta text-v2-ink-2">PID {slot.pid} · {formatTime(slot.startedAt)}</div> : null}
            {slot.threadUrl ? <details className="text-v2-meta text-v2-ink-2"><summary>线程已记录</summary><span className="block break-all font-v2-mono">{slot.threadUrl}</span></details> : null}
          </Card>
        ))}
      </div>
      {snapshot.events.length === 0 ? <EmptyState title="还没有可显示的派工记录" description="选择派工时使用的本机仓库目录；没有记录时不会创建文件。" /> : (
        <div className="flex flex-col gap-v2-sm" aria-label="派工回执列表">
          {snapshot.events.map((event) => (
            <Card key={event.id} className="p-v2-md">
              <div className="flex flex-wrap items-center gap-v2-sm">
                <StatusIndicator tone={STATES[event.status].tone} label={STATES[event.status].label} variant="pill" />
                {event.issue ? <Badge>{event.issue}</Badge> : null}
                <span className="ml-auto text-v2-meta text-v2-ink-2">{formatTime(event.updatedAt ?? event.createdAt)}</span>
              </div>
              <div className="mt-v2-sm break-all font-v2-mono text-v2-meta">{event.taskId}</div>
              <dl className="m-0 mt-v2-sm grid grid-cols-[auto_1fr] gap-x-v2-md gap-y-1 text-v2-meta">
                <dt className="text-v2-ink-2">会话</dt><dd className="m-0 break-all">{event.sessionKey ?? event.sessionId ?? '未记录'}</dd>
                <dt className="text-v2-ink-2">request_id</dt><dd className="m-0 break-all font-v2-mono">{event.requestId ?? '未记录'}</dd>
                <dt className="text-v2-ink-2">线程</dt><dd className="m-0 break-all font-v2-mono">{event.threadUrl ? <details><summary>已记录（展开查看）</summary>{event.threadUrl}</details> : '未记录'}</dd>
              </dl>
              {event.status === 'recovered' ? <p className="mb-0 text-v2-meta text-v2-ink-2">恢复任务已有完成回执；未与旧超时记录自动合并。</p> : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
