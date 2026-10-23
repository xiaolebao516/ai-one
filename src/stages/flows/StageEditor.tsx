import type { ChangeEvent } from 'react';
import type { FlowDef, FlowsFile, Participant, StageDef } from '../flowModel';
import type { StageSelection, StageDraftScope } from '../flowEditor';
import { canOverrideStageDraft } from '../flowEditor';
import type { Locale } from '../../i18n/resolve';
import { Badge, Button, Card, Notice, Select, cx } from '../../ui/v2';
import { isChineseFlowsLocale, type FlowsText } from '../../workbench/views/flowsText';

interface StageEditorProps {
  file: FlowsFile;
  locale: Locale;
  text: FlowsText;
  selection: StageSelection | null;
  stage: StageDef | undefined;
  draft: StageDef | undefined;
  selectedFlow: FlowDef | undefined;
  usageFlows: FlowDef[];
  readOnly: boolean;
  scopePrompt: boolean;
  scopeCanFlow: boolean;
  deleteConfirm: boolean;
  disabled?: boolean;
  onChange: (draft: StageDef) => void;
  onCopy: () => void;
  onRemoveFromFlow: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onChooseScope: (scope: StageDraftScope) => void;
  onCancelScope: () => void;
}

const COLLABORATIONS: Array<{ value: StageDef['collaboration']; key: 'collabSolo' | 'collabDiscussion' | 'collabAuthorReview' | 'collabParallel' }> = [
  { value: 'solo', key: 'collabSolo' },
  { value: 'discussion', key: 'collabDiscussion' },
  { value: 'author-review', key: 'collabAuthorReview' },
  { value: 'parallel', key: 'collabParallel' },
];

const EFFORTS: Array<{ value: NonNullable<Participant['effort']>; key: 'effortDefault' | 'effortHigh' | 'effortMax' }> = [
  { value: 'default', key: 'effortDefault' },
  { value: 'high', key: 'effortHigh' },
  { value: 'max', key: 'effortMax' },
];

const END_CONDITIONS: Array<{ value: StageDef['endCondition']; key: 'endUserConfirms' | 'endAuditPass' | 'endAuditPassLocal' | 'endRoundsDone' | 'endAllSubtasksDone' }> = [
  { value: 'user-confirms', key: 'endUserConfirms' },
  { value: 'audit-pass', key: 'endAuditPass' },
  { value: 'audit-pass-and-local-verify', key: 'endAuditPassLocal' },
  { value: 'rounds-done', key: 'endRoundsDone' },
  { value: 'all-subtasks-done', key: 'endAllSubtasksDone' },
];

const FAIL_POLICIES: Array<{ value: StageDef['onFail']; key: 'failStopAndAsk' | 'failRetryN' | 'failSkip' | 'failEscalate' }> = [
  { value: 'stop-and-ask', key: 'failStopAndAsk' },
  { value: 'retry-n', key: 'failRetryN' },
  { value: 'skip', key: 'failSkip' },
  { value: 'escalate-to-user', key: 'failEscalate' },
];

function label(stage: StageDef, locale: Locale): string {
  return isChineseFlowsLocale(locale) ? stage.name : stage.nameEn ?? stage.name;
}

function textInputClass(): string {
  return 'h-v2-control-md min-w-0 w-full rounded-v2-md border border-v2-line bg-v2-surface px-v2-sm text-v2-body text-v2-ink placeholder:text-v2-ink-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-primary';
}

function fieldLabelClass(): string {
  return 'text-v2-meta font-semibold text-v2-ink-2';
}

export function StageEditor({
  file,
  locale,
  text,
  selection,
  stage,
  draft,
  selectedFlow,
  usageFlows,
  readOnly,
  scopePrompt,
  scopeCanFlow,
  deleteConfirm,
  disabled = false,
  onChange,
  onCopy,
  onRemoveFromFlow,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onChooseScope,
  onCancelScope,
}: StageEditorProps) {
  if (!stage || !draft || !selection) {
    return (
      <Card className="grid gap-v2-sm">
        <h2 className="font-semibold text-v2-ink">{text.t('stageDetails')}</h2>
        <p className="text-v2-meta text-v2-ink-3">{text.t('noFlowSelected')}</p>
      </Card>
    );
  }

  const effectiveReadOnly = readOnly || stage.builtin || (selection.kind === 'flow' && Boolean(selectedFlow?.builtin));
  const references = usageFlows.map((flow) => label(flow, locale));
  const canDelete = selection.kind === 'library' && !stage.builtin && references.length === 0;
  const currentFlowUsesStage = Boolean(selectedFlow && selectedFlow.stages.some((ref) => ref.stageId === stage.id));
  const canScopeToCurrentFlow = selection.kind === 'flow' || currentFlowUsesStage;
  const unsupportedOverride = canScopeToCurrentFlow && usageFlows.length > 1 && !canOverrideStageDraft(file.stages.find((item) => item.id === stage.id) ?? stage, draft);
  const change = (patch: Partial<StageDef>) => {
    if (!effectiveReadOnly && !disabled) onChange({ ...draft, ...patch });
  };
  const updateParticipant = (index: number, patch: Partial<Participant>) => {
    const participants = draft.participants.map((participant, participantIndex) =>
      participantIndex === index ? { ...participant, ...patch } : participant,
    );
    change({ participants });
  };
  const endOptions = END_CONDITIONS.map((item) => ({ value: item.value, label: text.t(item.key) }));
  const failOptions = FAIL_POLICIES.map((item) => ({ value: item.value, label: text.t(item.key) }));
  const collabOptions = COLLABORATIONS.map((item) => ({ value: item.value, label: text.t(item.key) }));
  const effortOptions = EFFORTS.map((item) => ({ value: item.value, label: text.t(item.key) }));

  return (
    <Card className="grid content-start gap-v2-md" data-testid="stage-editor">
      <div className="flex items-start justify-between gap-v2-sm">
        <div className="min-w-0">
          <h2 className="text-v2-body font-semibold text-v2-ink">{text.t('stageDetails')}: {label(stage, locale)}</h2>
          {!stage.builtin ? (
            <p className="mt-1 text-v2-meta text-v2-ink-3">
              {selection.kind === 'flow' ? text.t('flowDetails') + ': ' + label(selectedFlow ?? { id: '', name: '', stages: [], builtin: false }, locale) : text.t('stageLibrary')}
            </p>
          ) : null}
        </div>
        {stage.builtin ? <Badge>{text.t('builtin')}</Badge> : null}
      </div>

      {effectiveReadOnly ? (
        <Notice tone="unknown">{text.t('copyBuiltinHint')}</Notice>
      ) : null}

      <div className="grid gap-v2-xs">
        <label className={fieldLabelClass()} htmlFor="flows-stage-name">{text.t('stageName')}</label>
        <input id="flows-stage-name" className={textInputClass()} value={locale.toLowerCase().startsWith('zh') ? draft.name : draft.nameEn ?? draft.name} disabled={effectiveReadOnly || disabled} onChange={(event: ChangeEvent<HTMLInputElement>) => change(locale.toLowerCase().startsWith('zh') ? { name: event.target.value, nameEn: draft.nameEn && event.target.value !== draft.name ? undefined : draft.nameEn } : { nameEn: event.target.value })} />
      </div>

      <div className="grid gap-v2-xs">
        <label className={fieldLabelClass()} htmlFor="flows-stage-command">{text.t('command')}</label>
        <input id="flows-stage-command" className={textInputClass()} value={draft.command ?? ''} disabled={effectiveReadOnly || disabled} placeholder="build" onChange={(event: ChangeEvent<HTMLInputElement>) => change({ command: event.target.value || undefined })} />
      </div>

      <div className="grid gap-v2-xs">
        <span className={fieldLabelClass()}>{text.t('collaboration')}</span>
        <Select id="flows-stage-collaboration" label={text.t('collaboration')} hideLabel options={collabOptions} value={draft.collaboration} disabled={effectiveReadOnly || disabled} onChange={(value) => change({ collaboration: value as StageDef['collaboration'], ...(value === 'author-review' && draft.reworkLimit === undefined ? { reworkLimit: 3 } : {}) })} className="w-full" />
      </div>

      <section className="grid gap-v2-sm" aria-labelledby="flows-participants-title">
        <div className="flex flex-wrap items-center justify-between gap-v2-sm">
          <h3 id="flows-participants-title" className={fieldLabelClass()}>{text.t('participants')}</h3>
          <Button size="sm" variant="secondary" disabled={effectiveReadOnly || disabled} onClick={() => change({ participants: [...draft.participants, { resource: '', role: '', effort: 'default' }] })}>
            ＋ {text.t('addParticipant')}
          </Button>
        </div>
        {draft.participants.length === 0 ? <p className="text-v2-meta text-v2-ink-3">{text.t('participantSummaryEmpty')}</p> : null}
        {draft.participants.map((participant, index) => (
          <Card key={index} padding="sm" className="grid gap-v2-sm">
            <div className="grid grid-cols-1 gap-v2-sm min-[1450px]:grid-cols-2">
              <div className="grid gap-1">
                <label className={fieldLabelClass()} htmlFor={'flows-resource-' + index}>{text.t('resource')}</label>
                <input id={'flows-resource-' + index} className={textInputClass()} value={participant.resource} disabled={effectiveReadOnly || disabled} onChange={(event: ChangeEvent<HTMLInputElement>) => updateParticipant(index, { resource: event.target.value })} />
              </div>
              <div className="grid gap-1">
                <label className={fieldLabelClass()} htmlFor={'flows-role-' + index}>{text.t('role')}</label>
                <input id={'flows-role-' + index} className={textInputClass()} value={participant.role} disabled={effectiveReadOnly || disabled} onChange={(event: ChangeEvent<HTMLInputElement>) => updateParticipant(index, { role: event.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-v2-sm min-[1450px]:grid-cols-2">
              <div className="grid gap-1">
                <label className={fieldLabelClass()} htmlFor={'flows-model-' + index}>{text.t('model')}</label>
                <input id={'flows-model-' + index} className={textInputClass()} value={participant.model ?? ''} disabled={effectiveReadOnly || disabled} onChange={(event: ChangeEvent<HTMLInputElement>) => updateParticipant(index, { model: event.target.value || undefined })} />
              </div>
              <div className="grid gap-1">
                <span className={fieldLabelClass()}>{text.t('effort')}</span>
                <Select id={'flows-effort-' + index} label={text.t('effort')} hideLabel options={effortOptions} value={participant.effort ?? 'default'} disabled={effectiveReadOnly || disabled} onChange={(value) => updateParticipant(index, { effort: value as NonNullable<Participant['effort']> })} className="w-full" />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-v2-sm">
              <label className="flex items-center gap-v2-xs text-v2-meta text-v2-ink-2">
                <input type="checkbox" className="accent-v2-primary" checked={participant.freshSession ?? false} disabled={effectiveReadOnly || disabled} onChange={(event) => updateParticipant(index, { freshSession: event.target.checked || undefined })} />
                {text.t('freshSession')}
              </label>
              <Button size="sm" variant="ghost" disabled={effectiveReadOnly || disabled} aria-label={text.t('removeParticipant', { n: index + 1 })} onClick={() => change({ participants: draft.participants.filter((_, participantIndex) => participantIndex !== index) })}>
                {text.t('delete')}
              </Button>
            </div>
          </Card>
        ))}
      </section>

      <div className="grid gap-v2-xs">
        <span className={fieldLabelClass()}>{text.t('endCondition')} <Badge>{text.t('ccReference')}</Badge></span>
        <Select id="flows-stage-end" label={text.t('endCondition')} hideLabel options={endOptions} value={draft.endCondition} disabled={effectiveReadOnly || disabled} onChange={(value) => change({ endCondition: value as StageDef['endCondition'] })} className="w-full" />
      </div>

      <div className="grid gap-v2-xs">
        <span className={fieldLabelClass()}>{text.t('onFail')} <Badge>{text.t('ccReference')}</Badge></span>
        <Select id="flows-stage-fail" label={text.t('onFail')} hideLabel options={failOptions} value={draft.onFail} disabled={effectiveReadOnly || disabled} onChange={(value) => change({ onFail: value as StageDef['onFail'] })} className="w-full" />
      </div>

      {draft.collaboration === 'author-review' ? (
        <div className="grid gap-v2-xs">
          <label className={fieldLabelClass()} htmlFor="flows-stage-rework">{text.t('reworkLimit')}</label>
          <input id="flows-stage-rework" type="number" min={1} max={10} step={1} className={textInputClass()} value={draft.reworkLimit ?? 3} disabled={effectiveReadOnly || disabled} onChange={(event: ChangeEvent<HTMLInputElement>) => { if (event.target.value !== '') change({ reworkLimit: Number(event.target.value) }); }} />
        </div>
      ) : null}

      <div className="grid gap-v2-xs">
        <label className={fieldLabelClass()} htmlFor="flows-stage-note">{text.t('note')}</label>
        <textarea id="flows-stage-note" rows={3} value={draft.note ?? ''} disabled={effectiveReadOnly || disabled} placeholder={text.t('notePlaceholder')} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => change({ note: event.target.value || undefined })} className={cx(textInputClass(), 'h-auto py-v2-sm')} />
      </div>

      {canScopeToCurrentFlow && usageFlows.length > 1 && scopePrompt ? (
        <Notice tone="unknown">
          <p>{text.t('sharedStage', { n: usageFlows.length })}</p>
          <p className="mt-1">{text.t('sharedStageHint')}</p>
          {unsupportedOverride ? <p className="mt-1">{text.t('overrideUnsupported')}</p> : null}
          {scopePrompt ? (
            <div className="mt-v2-sm flex flex-wrap gap-v2-sm">
              <Button size="sm" disabled={disabled || !scopeCanFlow} disabledReason={!scopeCanFlow ? text.t('overrideUnsupported') : undefined} onClick={() => onChooseScope('flow')}>{text.t('saveOnlyFlow')}</Button>
              <Button size="sm" disabled={disabled} onClick={() => onChooseScope('library')}>{text.t('saveLibrary')}</Button>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={onCancelScope}>{text.t('cancel')}</Button>
            </div>
          ) : null}
        </Notice>
      ) : null}

      {selection.kind === 'library' && usageFlows.length > 0 ? (
        <p className="text-v2-meta text-v2-ink-3">{text.t('cannotDeleteReferenced', { flows: references.join(', ') })}</p>
      ) : null}

      {deleteConfirm ? (
        <Notice tone="unknown" title={text.t('deleteConfirm')}>
          <p>{text.t('confirmDeleteStage')}</p>
          <div className="mt-v2-sm flex flex-wrap gap-v2-sm">
            <Button size="sm" variant="secondary" onClick={onConfirmDelete}>{text.t('delete')}</Button>
            <Button size="sm" variant="ghost" onClick={onCancelDelete}>{text.t('cancel')}</Button>
          </div>
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-v2-sm border-t border-v2-line pt-v2-sm">
        {effectiveReadOnly ? (
          <Button size="sm" onClick={onCopy} disabled={disabled}>{text.t('copyEdit')}</Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={onCopy} disabled={disabled}>{text.t('duplicate')}</Button>
            {selection.kind === 'flow' ? (
              <Button size="sm" variant="ghost" onClick={onRemoveFromFlow} disabled={disabled || Boolean(selectedFlow?.builtin)}>{text.t('removeFromFlow')}</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onRequestDelete} disabled={disabled || !canDelete} disabledReason={!canDelete && references.length > 0 ? text.t('cannotDeleteReferenced', { flows: references.join(', ') }) : undefined}>{text.t('deleteFromLibrary')}</Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
