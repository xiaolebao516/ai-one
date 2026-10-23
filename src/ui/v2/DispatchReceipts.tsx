import type { DispatchSnapshot, DispatchStatus } from '../../dispatch/types';
import type { Locale } from '../../i18n/resolve';
import { Badge, Card, EmptyState, Notice, StatusIndicator, type V2StatusTone } from '.';

const STATES: Record<DispatchStatus, { label: string; tone: V2StatusTone }> = {
  running: { label: '进行中', tone: 'run' }, completed: { label: '已完成', tone: 'done' },
  timeout: { label: '超时', tone: 'block' }, request_mismatch: { label: '请求不匹配', tone: 'block' },
  recovered: { label: '已恢复', tone: 'done' }, blocked: { label: '已阻塞', tone: 'block' },
  preview: { label: '待发送', tone: 'paused' }, unknown: { label: '待核实', tone: 'unknown' },
};
const EN_STATES: Record<DispatchStatus, string> = {
  running: 'In progress', completed: 'Completed', timeout: 'Timed out', request_mismatch: 'Request mismatch',
  recovered: 'Recovered', blocked: 'Blocked', preview: 'Pending send', unknown: 'Needs verification',
};
const SLOT_LABEL = { idle: '无占用记录', claimed: '有占用记录', stale: '心跳已过期', unknown: '记录不可用' };
const EN_SLOT_LABEL = { idle: 'No claim', claimed: 'Claim recorded', stale: 'Claim expired', unknown: 'Unavailable' };

const formatTime = (value: string | undefined, locale: Locale, fallback: string) =>
  value ? new Date(value).toLocaleString(locale, { hour12: false }) : fallback;

function warningText(warning: string, chinese: boolean): string {
  if (chinese) return warning;
  if (warning === '派工元数据格式无效') return 'Dispatch metadata format is invalid.';
  if (warning === '仅显示最近的部分记录') return 'Only the most recent records are shown.';
  const skipped = /^(\d+) 个元数据文件无法读取或格式无效$/.exec(warning);
  if (skipped) {
    const count = Number(skipped[1]);
    return count === 1
      ? '1 metadata file could not be read or had an invalid format'
      : count + ' metadata files could not be read or had an invalid format';
  }
  return warning;
}

/** Presentational component: local metadata only; no reply access, dispatch, or recovery actions. */
export function DispatchReceipts({ snapshot, source, locale = 'zh-CN' }: { snapshot: DispatchSnapshot; source: 'demo' | 'local'; locale?: Locale }) {
  const chinese = locale.startsWith('zh');
  const labels = chinese
    ? {
        demo: '演示数据', local: '本机元数据', readOnly: '只读',
        slotsAria: '派工槽位', receiptsAria: '派工回执列表', slot: '槽位', taskMissing: '任务未记录',
        sessionMissing: '会话未记录', port: '端口', browserUnprobed: '浏览器未探测', threadRecorded: '线程已记录',
        pid: 'PID', noRecords: '还没有可显示的派工记录',
        choosePath: '选择派工时使用的本机仓库目录；没有记录时不会创建文件。',
        session: '会话', requestId: 'request_id', thread: '线程', notRecorded: '未记录',
        threadExpand: '已记录（展开查看）',
        recoveredNote: '恢复任务已有完成回执；未与旧超时记录自动合并。',
      }
    : {
        demo: 'Demo data', local: 'Local metadata', readOnly: 'Read-only',
        slotsAria: 'Dispatch slots', receiptsAria: 'Dispatch receipts', slot: 'Slot', taskMissing: 'Task not recorded',
        sessionMissing: 'Session not recorded', port: 'Port', browserUnprobed: 'Browser not probed', threadRecorded: 'Thread recorded',
        pid: 'PID', noRecords: 'No dispatch records to display',
        choosePath: 'Choose the local repository directory used for dispatch; no files are created when there are no records.',
        session: 'Session', requestId: 'request_id', thread: 'Thread', notRecorded: 'Not recorded',
        threadExpand: 'Recorded (expand to view)',
        recoveredNote: 'The recovery task has a completion receipt; it is not automatically merged with the older timeout record.',
      };

  return (
    <div className="flex min-w-0 flex-col gap-v2-md" data-testid="dispatch-receipts">
      <div className="flex flex-wrap items-center gap-v2-sm">
        <Badge tone={source === 'demo' ? 'neutral' : 'run'}>{source === 'demo' ? labels.demo : labels.local}</Badge>
        <span className="text-v2-meta text-v2-ink-2">{labels.readOnly} · {chinese ? snapshot.events.length + ' 条记录' : snapshot.events.length + ' record' + (snapshot.events.length === 1 ? '' : 's')} · {chinese ? '不包含回复正文' : 'no reply text'}</span>
      </div>
      {snapshot.warnings.map((warning) => <Notice key={warning} tone="block" title={warningText(warning, chinese)} />)}
      <ul className="m-0 flex list-none flex-wrap gap-v2-sm p-0" aria-label={labels.slotsAria}>
        {snapshot.slots.map((slot) => (
          <Card as="li" key={slot.id} className="min-w-40 flex-1 p-v2-md">
            <div className="flex flex-wrap items-center gap-v2-sm"><strong className="text-v2-body">{labels.slot} {slot.id}</strong><Badge>{(chinese ? SLOT_LABEL : EN_SLOT_LABEL)[slot.state]}</Badge></div>
            <div className="mt-v2-sm break-all text-v2-meta text-v2-ink-2">{slot.task ?? labels.taskMissing} · {slot.sessionKey ?? labels.sessionMissing}</div>
            <div className="text-v2-meta text-v2-ink-2">{labels.port} {slot.port} · {labels.browserUnprobed}</div>
            {slot.pid ? <div className="text-v2-meta text-v2-ink-2">{labels.pid} {slot.pid} · {formatTime(slot.startedAt, locale, labels.notRecorded)}</div> : null}
            {slot.threadUrl ? <details className="text-v2-meta text-v2-ink-2"><summary>{labels.threadRecorded}</summary><span className="block break-all font-v2-mono">{slot.threadUrl}</span></details> : null}
          </Card>
        ))}
      </ul>
      {snapshot.events.length === 0 ? <EmptyState title={labels.noRecords} description={labels.choosePath} /> : (
        <ul className="m-0 flex list-none flex-col gap-v2-sm p-0" aria-label={labels.receiptsAria}>
          {snapshot.events.map((event) => (
            <Card as="li" key={event.id} className="p-v2-md">
              <div className="flex flex-wrap items-center gap-v2-sm">
                <StatusIndicator tone={STATES[event.status].tone} label={chinese ? STATES[event.status].label : EN_STATES[event.status]} variant="pill" />
                {event.issue ? <Badge>{event.issue}</Badge> : null}
                <span className="ml-auto text-v2-meta text-v2-ink-2">{formatTime(event.updatedAt ?? event.createdAt, locale, labels.notRecorded)}</span>
              </div>
              <div className="mt-v2-sm break-all font-v2-mono text-v2-meta">{event.taskId}</div>
              <dl className="m-0 mt-v2-sm grid grid-cols-[auto_1fr] gap-x-v2-md gap-y-1 text-v2-meta">
                <dt className="text-v2-ink-2">{labels.session}</dt><dd className="m-0 break-all">{event.sessionKey ?? event.sessionId ?? labels.notRecorded}</dd>
                <dt className="text-v2-ink-2">{labels.requestId}</dt><dd className="m-0 break-all font-v2-mono">{event.requestId ?? labels.notRecorded}</dd>
                <dt className="text-v2-ink-2">{labels.thread}</dt><dd className="m-0 break-all font-v2-mono">{event.threadUrl ? <details><summary>{labels.threadExpand}</summary>{event.threadUrl}</details> : labels.notRecorded}</dd>
              </dl>
              {event.status === 'recovered' ? <p className="mb-0 text-v2-meta text-v2-ink-2">{labels.recoveredNote}</p> : null}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
