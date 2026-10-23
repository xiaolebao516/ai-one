import type { LocalStoreFs } from '../../host/localStore';
import type { FlowDef, FlowsFile, StageDef, ValidationIssue } from '../flowModel';
import type { StageSelection } from '../flowEditor';
import type { Locale } from '../../i18n/resolve';
import { Badge, Button, Card, EmptyState, Notice, Select } from '../../ui/v2';
import type { FlowsText } from '../../workbench/views/flowsText';
import { FlowFileMenu } from './FlowFileMenu';
import { FlowStageCard } from './FlowStageCard';

interface FlowStageListProps {
  file: FlowsFile;
  flow: FlowDef;
  locale: Locale;
  text: FlowsText;
  selection: StageSelection | null;
  issues: ValidationIssue[];
  disabled: boolean;
  saving: boolean;
  insertIndex: number | null;
  selectedAddStage: string;
  deleteConfirm: boolean;
  fs?: LocalStoreFs;
  onFlowNameChange: (name: string) => void;
  onCopyFlow: () => void;
  onSave: () => void;
  onRequestDeleteFlow: () => void;
  onConfirmDeleteFlow: () => void;
  onCancelDeleteFlow: () => void;
  onSelectStage: (index: number) => void;
  onMoveStage: (from: number, to: number) => void;
  onOpenInsert: (index: number) => void;
  onSelectAddStage: (stageId: string) => void;
  onAddStage: () => void;
  onCreateAndAddStage: () => void;
  onImport: (incoming: FlowsFile, resolution: 'keep-both' | 'overwrite') => void;
}

function label(item: FlowDef | StageDef, locale: Locale): string {
  return locale.toLowerCase().startsWith('zh') ? item.name : item.nameEn ?? item.name;
}

function stageIssue(stage: StageDef | undefined, flow: FlowDef, issues: ValidationIssue[]): boolean {
  if (!stage) return true;
  return issues.some((issue) => issue.stageId === stage.id && (!issue.flowId || issue.flowId === flow.id));
}

export function FlowStageList({
  file,
  flow,
  locale,
  text,
  selection,
  issues,
  disabled,
  saving,
  insertIndex,
  selectedAddStage,
  deleteConfirm,
  fs,
  onFlowNameChange,
  onCopyFlow,
  onSave,
  onRequestDeleteFlow,
  onConfirmDeleteFlow,
  onCancelDeleteFlow,
  onSelectStage,
  onMoveStage,
  onOpenInsert,
  onSelectAddStage,
  onAddStage,
  onCreateAndAddStage,
  onImport,
}: FlowStageListProps) {
  const readOnly = disabled || flow.builtin;
  const flowIssues = issues.filter((issue) => issue.flowId === flow.id);
  const stageOptions = [
    { value: '', label: text.t('selectStage'), disabled: true },
    ...file.stages.map((stage) => ({ value: stage.id, label: label(stage, locale) + (stage.builtin ? ' · ' + text.t('builtin') : '') })),
  ];
  const description = locale.toLowerCase().startsWith('zh') ? flow.description : flow.descriptionEn ?? flow.description;

  const insertPicker = (index: number) => (
    <Card padding="sm" className="grid gap-v2-sm border border-dashed border-v2-line-strong" key={'insert-' + index}>
      <div className="grid gap-v2-xs">
        <Select id={'flows-add-stage-' + index} label={text.t('stageFromLibrary')} options={stageOptions} value={selectedAddStage} onChange={onSelectAddStage} disabled={readOnly} className="w-full" />
      </div>
      <div className="flex flex-wrap gap-v2-sm">
        <Button size="sm" disabled={readOnly || !selectedAddStage} onClick={onAddStage}>{text.t('addSelectedStage')}</Button>
        <Button size="sm" variant="secondary" disabled={readOnly} onClick={onCreateAndAddStage}>{text.t('createAndAddStage')}</Button>
        <Button size="sm" variant="ghost" onClick={() => onOpenInsert(-1)}>{text.t('cancel')}</Button>
      </div>
    </Card>
  );

  return (
    <section className="grid min-w-0 content-start gap-v2-md" aria-labelledby="flows-current-title">
      <header className="grid gap-v2-sm border-b border-v2-line pb-v2-md">
        <div className="flex flex-wrap items-start justify-between gap-v2-sm">
          <div className="min-w-0 flex-1">
            {flow.builtin ? (
              <h2 id="flows-current-title" className="break-words text-v2-heading font-semibold text-v2-ink">{label(flow, locale)}</h2>
            ) : (
              <label className="grid gap-1" htmlFor="flows-current-title-input">
                <span className="text-v2-micro text-v2-ink-3">{text.t('flowName')}</span>
                <input
                  id="flows-current-title-input"
                  value={flow.name}
                  onChange={(event) => onFlowNameChange(event.target.value)}
                  disabled={disabled}
                  className="h-v2-control-md w-full min-w-0 rounded-v2-md border border-v2-line bg-v2-surface px-v2-sm text-v2-heading font-semibold text-v2-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-primary"
                />
              </label>
            )}
            <div className="mt-v2-xs flex flex-wrap items-center gap-v2-sm">
              {flow.builtin ? <Badge>{text.t('builtin')}</Badge> : null}
              <Badge>{text.t('flowStageCount', { n: flow.stages.length })}</Badge>
              {flowIssues.length ? <Badge tone="block">{flowIssues.length}</Badge> : null}
            </div>
            {description ? <p className="mt-v2-xs text-v2-meta text-v2-ink-2">{description}</p> : null}
            {flow.builtin ? <p className="mt-v2-xs text-v2-meta text-v2-ink-3">{text.t('copyBuiltinHint')}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-v2-xs">
            <Button size="sm" variant="secondary" disabled={disabled} onClick={onCopyFlow}>{flow.builtin ? text.t('copyEdit') : text.t('copy')}</Button>
            <Button size="sm" disabled={disabled || saving} onClick={onSave}>{saving ? text.t('saving') : text.t('save')}</Button>
            <FlowFileMenu file={file} flowId={flow.id} text={text} fs={fs} disabled={disabled} onImport={onImport} />
          </div>
        </div>
        {flow.builtin ? null : (
          <div className="flex flex-wrap items-center gap-v2-sm">
            <Button size="sm" variant="ghost" disabled={disabled} onClick={onRequestDeleteFlow}>{text.t('delete')}</Button>
          </div>
        )}
        {deleteConfirm ? (
          <Notice tone="unknown" title={text.t('deleteConfirm')}>
            <p>{text.t('confirmDeleteFlow')}</p>
            <div className="mt-v2-sm flex flex-wrap gap-v2-sm">
              <Button size="sm" variant="secondary" onClick={onConfirmDeleteFlow}>{text.t('delete')}</Button>
              <Button size="sm" variant="ghost" onClick={onCancelDeleteFlow}>{text.t('cancel')}</Button>
            </div>
          </Notice>
        ) : null}
      </header>

      {flow.stages.length === 0 ? (
        <EmptyState tone={flowIssues.length ? 'unknown' : 'neutral'} title={text.t('flowEmpty')} description={flowIssues.length ? flowIssues.map((issue) => issue.message).join(' · ') : undefined} />
      ) : null}

      <ol className="grid min-w-0 gap-v2-xs" aria-label={label(flow, locale)}>
        {flow.stages.map((ref, index) => {
          const stage = file.stages.find((item) => item.id === ref.stageId);
          if (!stage) {
            return (
              <li key={ref.stageId + '-' + index} className="grid gap-v2-xs">
                <Card accent="block"><p className="text-v2-meta text-v2-ink">{text.t('issueUnknownStage')}</p></Card>
                {insertIndex === index + 1 ? insertPicker(index + 1) : (
                  <button type="button" disabled={readOnly} onClick={() => onOpenInsert(index + 1)} className="rounded-v2-md border border-dashed border-v2-line px-v2-sm py-1.5 text-v2-meta text-v2-ink-2 hover:bg-v2-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-primary">{text.t('insertHere')}</button>
                )}
              </li>
            );
          }
          const effective = ref.overrides
            ? { ...stage, ...ref.overrides, participants: ref.overrides.participants ?? stage.participants }
            : stage;
          const invalid = stageIssue(effective, flow, issues);
          return (
            <li key={ref.stageId + '-' + index} className="grid min-w-0 gap-v2-xs">
              <FlowStageCard
                stage={effective}
                index={index}
                locale={locale}
                text={text}
                selected={selection?.kind === 'flow' && selection.flowId === flow.id && selection.index === index}
                invalid={invalid}
                readOnly={readOnly}
                onSelect={() => onSelectStage(index)}
                onMove={onMoveStage}
              />
              {index < flow.stages.length - 1 ? (
                insertIndex === index + 1 ? insertPicker(index + 1) : (
                  <button type="button" disabled={readOnly} onClick={() => onOpenInsert(index + 1)} className="rounded-v2-md border border-dashed border-v2-line px-v2-sm py-1.5 text-v2-meta text-v2-ink-2 hover:bg-v2-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-primary">{text.t('insertHere')}</button>
                )
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-v2-sm">
        {insertIndex === flow.stages.length ? insertPicker(flow.stages.length) : (
          <button type="button" disabled={readOnly} onClick={() => onOpenInsert(flow.stages.length)} className="rounded-v2-md border border-dashed border-v2-line px-v2-sm py-2 text-v2-meta font-semibold text-v2-ink-2 hover:bg-v2-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-primary">{text.t('addStage')}</button>
        )}
      </div>
    </section>
  );
}
