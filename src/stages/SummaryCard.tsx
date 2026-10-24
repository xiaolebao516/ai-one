import type { Locale } from '../i18n/resolve';
import { Badge, Button, Card, Notice, SectionHeader } from '../ui/v2';
import type { DiscussionConclusionBasis, DiscussionSummaryField, DiscussionSummaryModel } from './discussionViewModel';
import { discussionText } from './discussionText';

export interface SummaryCardProps {
  model: DiscussionSummaryModel;
  locale?: Locale;
  onPlan?: () => void;
  onFollowUp?: () => void;
  onFinishAndSave?: () => void;
}
const BASIS_TONE: Record<DiscussionConclusionBasis, 'done' | 'unknown' | 'block'> = {
  'model-agreement': 'done', 'audit-confirmed': 'unknown', unresolved: 'block',
};
export function SummaryCard({ model, locale = 'zh-CN', onPlan, onFollowUp, onFinishAndSave }: SummaryCardProps) {
  const t = discussionText(locale);
  const fieldText = (field: DiscussionSummaryField): string => field.kind === 'missing' ? t.unavailable : field.text;
  const basisLabel = { 'model-agreement': t.basisAgreement, 'audit-confirmed': t.basisAudit, unresolved: t.basisUnresolved };
  return (
    <section className="flex min-w-0 flex-col gap-v2-md" aria-label={t.summary}>
      <SectionHeader title={t.summary} description={t.summaryHint} />
      <Card className="flex min-w-0 flex-col gap-v2-md">
        <div className="min-w-0">
          <div className="mb-v2-sm flex flex-wrap items-center gap-v2-sm">
            <h3 className="m-0 text-v2-body font-semibold text-v2-ink">{t.conclusion}</h3>
            {model.conclusion.kind === 'value'
              ? <Badge tone={BASIS_TONE[model.conclusion.basis]}>{basisLabel[model.conclusion.basis]}</Badge>
              : <Badge tone="unknown">{t.unavailable}</Badge>}
          </div>
          <p className="m-0 break-words text-v2-body text-v2-ink">{model.conclusion.kind === 'missing' ? t.unavailable : model.conclusion.text}</p>
          {model.conclusion.kind === 'value'
            ? <p className="m-0 mt-v2-sm break-words text-v2-meta text-v2-ink-2">
                {t.supporters}: {model.conclusion.supporters.length ? model.conclusion.supporters.join('、') : t.unavailable}
              </p> : null}
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-v2-md md:grid-cols-2">
          <Field title={t.disagreements} text={fieldText(model.disagreements)} />
          <Field title={t.gaps} text={fieldText(model.evidenceGaps)} />
          <div className="md:col-span-2"><Field title={t.next} text={fieldText(model.nextSteps)} /></div>
        </div>
        <Notice title={t.caution}>{model.disclaimer}</Notice>
        <div className="flex flex-wrap gap-v2-sm">
          <Button disabled={!onPlan} disabledReason={onPlan ? undefined : t.planUnavailable} onClick={onPlan}>{t.plan}</Button>
          <Button disabled={!onFollowUp} disabledReason={onFollowUp ? undefined : t.noFollowUp} onClick={onFollowUp}>{t.followUp}</Button>
          <Button disabled={!onFinishAndSave} disabledReason={onFinishAndSave ? undefined : t.saved} onClick={onFinishAndSave}>{t.finish}</Button>
        </div>
      </Card>
    </section>
  );
}
function Field({ title, text }: { title: string; text: string }) {
  return <div className="min-w-0 rounded-v2-md border border-v2-line bg-v2-surface p-v2-md">
    <h4 className="m-0 text-v2-body font-semibold text-v2-ink">{title}</h4>
    <p className="m-0 mt-v2-sm break-words text-v2-body text-v2-ink-2">{text}</p>
  </div>;
}
