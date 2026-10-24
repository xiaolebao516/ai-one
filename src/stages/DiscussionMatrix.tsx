import type { Locale } from '../i18n/resolve';
import { Badge, Card, SectionHeader, StatusIndicator } from '../ui/v2';
import { discussionText } from './discussionText';
import type { DiscussionMatrixModel, DiscussionParticipant, DiscussionTone } from './discussionViewModel';

export interface DiscussionMatrixProps { model: DiscussionMatrixModel; locale?: Locale; }
export function DiscussionMatrix({ model, locale = 'zh-CN' }: DiscussionMatrixProps) {
  const t = discussionText(locale);
  const labels: Record<DiscussionTone, string> = {
    run: t.active, done: t.done, block: t.block, paused: t.paused, unknown: t.unknown,
  };
  const people: Record<DiscussionParticipant, string> = { first: t.first, second: t.second, auditor: t.auditor };
  return <section className="flex min-w-0 flex-col gap-v2-md" aria-label={t.matrix}>
    <SectionHeader title={t.matrix} description={t.matrixHint} />
    <Card variant="flat" padding="sm" className="min-w-0">
      <div className="w-full overflow-x-auto"><table className="w-full min-w-[720px] table-fixed border-collapse text-v2-body">
        <thead><tr className="bg-v2-sunken text-left">
          <th scope="col" className="w-[17%] px-v2-md py-v2-sm font-semibold text-v2-ink">{t.step}</th>
          {model.participants.map((person) => <th key={person} scope="col" className="px-v2-md py-v2-sm font-semibold text-v2-ink">{people[person]}</th>)}
        </tr></thead>
        <tbody>{model.rows.map((row) => <tr key={row.id} className="border-t border-v2-line align-top">
          <th scope="row" className="break-words px-v2-md py-v2-md text-left font-semibold text-v2-ink">{row.label}</th>
          {model.participants.map((person) => {
            const cell = row.cells[person];
            return <td key={person} className="min-w-0 break-words px-v2-md py-v2-md">
              <div className="flex min-w-0 flex-col items-start gap-v2-sm">
                <StatusIndicator tone={cell.tone} label={labels[cell.tone]} />
                <p className="m-0 min-w-0 break-words text-v2-body text-v2-ink">{cell.summary}</p>
                {cell.independent ? <Badge tone="unknown">{t.independent}</Badge> : null}
              </div>
            </td>;
          })}
        </tr>)}</tbody>
      </table></div>
    </Card>
  </section>;
}
