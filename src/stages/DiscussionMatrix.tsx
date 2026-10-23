import { Badge, Card, SectionHeader, StatusIndicator } from '../ui/v2';
import type { DiscussionMatrixModel, DiscussionParticipant, DiscussionTone } from './discussionViewModel';

export interface DiscussionMatrixProps {
  model: DiscussionMatrixModel;
}

const TONE_LABEL: Record<DiscussionTone, string> = {
  run: '进行中',
  done: '已完成',
  block: '阻塞',
  paused: '已跳过 / 暂停',
  unknown: '未知',
};

const PARTICIPANT_LABEL: Record<DiscussionParticipant, string> = {
  first: 'first',
  second: 'second',
  auditor: 'auditor',
};

export function DiscussionMatrix({ model }: DiscussionMatrixProps) {
  return (
    <section className="flex min-w-0 flex-col gap-v2-md" aria-label="讨论矩阵">
      <SectionHeader title="讨论矩阵" description="摘要来自结构化决议与审计脚注；无法解析时不会猜测。" />
      <Card variant="flat" padding="sm" className="min-w-0">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-v2-body">
            <thead>
              <tr className="bg-v2-sunken text-left">
                <th scope="col" className="w-[17%] px-v2-md py-v2-sm font-semibold text-v2-ink">环节</th>
                {model.participants.map((participant) => (
                  <th key={participant} scope="col" className="px-v2-md py-v2-sm font-semibold text-v2-ink">
                    {PARTICIPANT_LABEL[participant]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.id} className="border-t border-v2-line align-top">
                  <th scope="row" className="break-words px-v2-md py-v2-md text-left font-semibold text-v2-ink">
                    {row.label}
                  </th>
                  {model.participants.map((participant) => {
                    const cell = row.cells[participant];
                    return (
                      <td key={participant} className="min-w-0 break-words px-v2-md py-v2-md">
                        <div className="flex min-w-0 flex-col items-start gap-v2-sm">
                          <StatusIndicator tone={cell.tone} label={TONE_LABEL[cell.tone]} />
                          <p className="m-0 min-w-0 break-words text-v2-body text-v2-ink">{cell.summary}</p>
                          {cell.independent ? <Badge tone="unknown">看不到对方</Badge> : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
