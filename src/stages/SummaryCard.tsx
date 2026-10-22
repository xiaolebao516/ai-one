import { Badge, Button, Card, Notice, SectionHeader } from '../ui/v2';
import type { DiscussionConclusionBasis, DiscussionSummaryField, DiscussionSummaryModel } from './discussionViewModel';

export interface SummaryCardProps {
  model: DiscussionSummaryModel;
  onPlan?: () => void;
  onFollowUp?: () => void;
  onFinishAndSave?: () => void;
}

const BASIS_LABEL: Record<DiscussionConclusionBasis, string> = {
  'model-agreement': '模型一致',
  'audit-confirmed': '审计确认',
  unresolved: '未收敛',
};

const BASIS_TONE: Record<DiscussionConclusionBasis, 'done' | 'unknown' | 'block'> = {
  'model-agreement': 'done',
  'audit-confirmed': 'unknown',
  unresolved: 'block',
};

function fieldText(field: DiscussionSummaryField): string {
  return field.kind === 'missing' ? '未提供' : field.text;
}

export function SummaryCard({ model, onPlan, onFollowUp, onFinishAndSave }: SummaryCardProps) {
  return (
    <section className="flex min-w-0 flex-col gap-v2-md" aria-label="讨论汇总">
      <SectionHeader title="讨论汇总" description="依据已解析的讨论记录生成。" />
      <Card className="flex min-w-0 flex-col gap-v2-md">
        <div className="min-w-0">
          <div className="mb-v2-sm flex flex-wrap items-center gap-v2-sm">
            <h3 className="m-0 text-v2-body font-semibold text-v2-ink">结论</h3>
            {model.conclusion.kind === 'value'
              ? <Badge tone={BASIS_TONE[model.conclusion.basis]}>{BASIS_LABEL[model.conclusion.basis]}</Badge>
              : <Badge tone="unknown">未提供</Badge>}
          </div>
          <p className="m-0 break-words text-v2-body text-v2-ink">
            {model.conclusion.kind === 'missing' ? '未提供' : model.conclusion.text}
          </p>
          {model.conclusion.kind === 'value' ? (
            <p className="m-0 mt-v2-sm break-words text-v2-meta text-v2-ink-2">
              支持者：{model.conclusion.supporters.length ? model.conclusion.supporters.join('、') : '未能解析'}
            </p>
          ) : null}
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-v2-md md:grid-cols-2">
          <SummaryField title="仍有分歧" field={model.disagreements} />
          <SummaryField title="待补证据" field={model.evidenceGaps} />
          <div className="md:col-span-2">
            <SummaryField title="建议下一步" field={model.nextSteps} />
          </div>
        </div>
        <Notice title="重要提示">{model.disclaimer}</Notice>
        <div className="flex flex-wrap gap-v2-sm">
          <Button
            disabled={!onPlan}
            disabledReason={onPlan ? undefined : '外壳尚未接入创建 Task Issue 的操作。'}
            onClick={onPlan}
          >
            转入定方案
          </Button>
          <Button
            disabled={!onFollowUp}
            disabledReason={onFollowUp ? undefined : '外壳尚未接入继续追问的操作。'}
            onClick={onFollowUp}
          >
            继续追问
          </Button>
          <Button
            disabled={!onFinishAndSave}
            disabledReason={onFinishAndSave ? undefined : '外壳尚未接入结束并保存的操作。'}
            onClick={onFinishAndSave}
          >
            结束并保存
          </Button>
        </div>
      </Card>
    </section>
  );
}

function SummaryField({ title, field }: { title: string; field: DiscussionSummaryField }) {
  return (
    <div className="min-w-0 rounded-v2-md border border-v2-line bg-v2-surface p-v2-md">
      <h4 className="m-0 text-v2-body font-semibold text-v2-ink">{title}</h4>
      <p className="m-0 mt-v2-sm break-words text-v2-body text-v2-ink-2">{fieldText(field)}</p>
    </div>
  );
}
