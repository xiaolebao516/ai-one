import { useEffect, useState } from 'react';
import type { LocalStoreFs } from '../../host/localStore';
import type { Locale } from '../../i18n/resolve';
import { Badge, Button, Card, LoadingState, Notice } from '../../ui/v2';
import {
  addStageToFlow,
  canDeleteStage,
  duplicateFlow,
  duplicateStage,
  moveStageRef,
  removeStageRef,
  type FlowDef,
  type FlowsFile,
  type StageDef,
  type ValidationIssue,
  type ValidationIssueCode,
} from '../../stages/flowModel';
import { applyStageDraft, canOverrideStageDraft, resolveImportChoice, sameStage, stageForSelection, type StageDraftScope, type StageSelection, type ImportResolution } from '../../stages/flowEditor';
import { useFlows } from '../../stages/useFlows';
import { CompactFlowSelectors, FlowSidebar } from '../../stages/flows/FlowSidebar';
import { FlowStageList } from '../../stages/flows/FlowStageList';
import { FlowSecurityRules } from '../../stages/flows/FlowSecurityRules';
import { StageEditor } from '../../stages/flows/StageEditor';
import { flowsText } from './flowsText';

export interface FlowsViewProps {
  locale: Locale;
  /** Tests inject an in-memory LocalStoreFs; production resolves the Tauri/browser implementation. */
  fs?: LocalStoreFs;
}

type PendingAction =
  | { kind: 'select-flow'; flowId: string }
  | { kind: 'select-stage'; selection: StageSelection }
  | { kind: 'create-flow' }
  | { kind: 'create-stage' }
  | { kind: 'add-stage'; flowId: string; stageId: string; index: number }
  | { kind: 'create-add-stage'; flowId: string; index: number }
  | { kind: 'remove-stage'; selection: StageSelection }
  | { kind: 'delete-flow'; flowId: string }
  | { kind: 'delete-stage'; stageId: string }
  | { kind: 'copy-flow'; flowId: string }
  | { kind: 'import'; incoming: FlowsFile; resolution: Exclude<ImportResolution, 'cancel'> };

type Feedback = { tone: 'neutral' | 'block'; message: string };

let idCounter = 0;

function uniqueId(prefix: string, existing: readonly string[]): string {
  const occupied = new Set(existing);
  let candidate = '';
  do {
    idCounter += 1;
    candidate = prefix + '-' + Date.now().toString(36) + '-' + idCounter.toString(36);
  } while (occupied.has(candidate));
  return candidate;
}

function newStage(locale: Locale, file: FlowsFile): StageDef {
  const zh = locale.toLowerCase().startsWith('zh');
  return {
    id: uniqueId('stage', [...file.stages.map((stage) => stage.id), ...file.flows.map((flow) => flow.id)]),
    name: zh ? '新阶段' : 'New stage',
    collaboration: 'solo',
    participants: [{ resource: 'chatgpt', role: zh ? '执行者' : 'Executor', effort: 'default' }],
    endCondition: 'user-confirms',
    onFail: 'stop-and-ask',
    builtin: false,
  };
}

function newFlow(locale: Locale, file: FlowsFile): FlowDef {
  const zh = locale.toLowerCase().startsWith('zh');
  return {
    id: uniqueId('flow', [...file.flows.map((flow) => flow.id), ...file.stages.map((stage) => stage.id)]),
    name: zh ? '新流程' : 'New flow',
    stages: [],
    builtin: false,
  };
}

function issueLabel(code: ValidationIssueCode, text: ReturnType<typeof flowsText>): string {
  const keys: Partial<Record<ValidationIssueCode, Parameters<typeof text.t>[0]>> = {
    'bad-shape': 'issueBadShape',
    'unknown-schema-version': 'issueUnknownSchema',
    'empty-id': 'issueInvalidId',
    'empty-name': 'issueEmptyName',
    'invalid-builtin': 'issueInvalidBuiltin',
    'invalid-collaboration': 'issueInvalidCollaboration',
    'invalid-participants': 'issueInvalidParticipants',
    'invalid-participant': 'issueInvalidParticipant',
    'empty-resource': 'issueEmptyResource',
    'empty-role': 'issueEmptyRole',
    'invalid-effort': 'issueInvalidEffort',
    'invalid-fresh-session': 'issueInvalidFreshSession',
    'invalid-end-condition': 'issueInvalidEnd',
    'invalid-on-fail': 'issueInvalidFail',
    'invalid-rework-limit': 'issueInvalidRework',
    'invalid-note': 'issueInvalidNote',
    'invalid-command': 'issueInvalidCommand',
    'invalid-description': 'issueInvalidDescription',
    'missing-author': 'issueMissingAuthor',
    'missing-audit': 'issueMissingAudit',
    'same-author-audit-session': 'issueSameAudit',
    'empty-flow': 'issueEmptyFlow',
    'unknown-stage': 'issueUnknownStage',
    'forbidden-next': 'issueForbiddenNext',
    'invalid-overrides': 'issueInvalidOverrides',
    'invalid-override-field': 'issueInvalidOverrideField',
    'duplicate-id': 'issueDuplicateId',
  };
  return text.t(keys[code] ?? 'issueDefault');
}

function itemLabel(item: FlowDef | StageDef, locale: Locale): string {
  return locale.toLowerCase().startsWith('zh') ? item.name : item.nameEn ?? item.name;
}

function cloneFlowWithStage(file: FlowsFile, flowId: string, index: number, stageId: string): FlowsFile {
  return {
    ...file,
    flows: file.flows.map((flow) => flow.id !== flowId ? flow : {
      ...flow,
      stages: flow.stages.map((ref, refIndex) => refIndex === index ? { stageId } : ref),
    }),
  };
}

export function FlowsView({ locale, fs }: FlowsViewProps) {
  const text = flowsText(locale);
  const flows = useFlows(fs);
  const file = flows.file;
  const [selectedFlowId, setSelectedFlowId] = useState('');
  const [selection, setSelection] = useState<StageSelection | null>(null);
  const [draft, setDraft] = useState<StageDef | undefined>();
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [selectedAddStage, setSelectedAddStage] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [scopePrompt, setScopePrompt] = useState(false);
  const [deleteFlowConfirm, setDeleteFlowConfirm] = useState(false);
  const [deleteStageConfirm, setDeleteStageConfirm] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | undefined>();
  const [editError, setEditError] = useState<string | undefined>();

  useEffect(() => {
    if (!file) return;
    if (selectedFlowId && file.flows.some((flow) => flow.id === selectedFlowId)) return;
    const first = file.flows[0];
    setSelectedFlowId(first?.id ?? '');
    const nextSelection: StageSelection | null = first?.stages.length ? { kind: 'flow', flowId: first.id, index: 0 } : null;
    setSelection(nextSelection);
    setDraft(stageForSelection(file, nextSelection));
  }, [file, selectedFlowId]);

  const selectedFlow = file?.flows.find((flow) => flow.id === selectedFlowId);
  const selectedStage = file ? stageForSelection(file, selection) : undefined;
  const draftDirty = Boolean(draft && selectedStage && !sameStage(draft, selectedStage));
  const hasUnsaved = flows.dirty || draftDirty;
  const baseStage = file && selectedStage ? file.stages.find((stage) => stage.id === selectedStage.id) : undefined;
  const usageFlows = file && baseStage
    ? file.flows.filter((flow) => flow.stages.some((ref) => ref.stageId === baseStage.id))
    : [];
  const scopeCanFlow = Boolean(baseStage && draft && canOverrideStageDraft(baseStage, draft));
  const mutationsDisabled = flows.loading || flows.saving || flows.status === 'error';

  useEffect(() => {
    if (!file || flows.issues.length === 0) return;
    const first = flows.issues.find((issue) => issue.stageId && (!issue.flowId || issue.flowId === selectedFlowId));
    if (!first?.stageId) return;
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="flow-stage-card"][data-stage-id]'));
    cards.find((card) => card.dataset.stageId === first.stageId)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [file, flows.issues, selectedFlowId]);

  const setSelectionFor = (target: StageSelection | null, source: FlowsFile) => {
    if (target?.kind === 'flow') setSelectedFlowId(target.flowId);
    setSelection(target);
    setDraft(stageForSelection(source, target));
    setScopePrompt(false);
    setDeleteStageConfirm(false);
    setInsertIndex(null);
    setSelectedAddStage('');
    setEditError(undefined);
  };

  const performAction = (action: PendingAction, source = flows.file) => {
    if (!source || mutationsDisabled) return;
    setFeedback(undefined);
    setScopePrompt(false);
    setEditError(undefined);

    if (action.kind === 'select-flow') {
      const flow = source.flows.find((item) => item.id === action.flowId);
      if (!flow) return;
      const nextSelection: StageSelection | null = flow.stages.length ? { kind: 'flow', flowId: flow.id, index: 0 } : null;
      setSelectedFlowId(flow.id);
      setSelection(nextSelection);
      setDraft(stageForSelection(source, nextSelection));
      setInsertIndex(null);
      setSelectedAddStage('');
      setDeleteFlowConfirm(false);
      setDeleteStageConfirm(false);
      return;
    }

    if (action.kind === 'select-stage') {
      const nextSelection = action.selection;
      if (nextSelection.kind === 'flow') {
        const flow = source.flows.find((item) => item.id === nextSelection.flowId);
        if (!flow || !flow.stages[nextSelection.index]) return;
        setSelectedFlowId(flow.id);
      } else if (!source.stages.some((stage) => stage.id === nextSelection.stageId)) return;
      setSelectionFor(nextSelection, source);
      return;
    }

    if (action.kind === 'create-flow') {
      const flow = newFlow(locale, source);
      const next = { ...source, flows: [...source.flows, flow] };
      flows.updateFile(() => next);
      setSelectedFlowId(flow.id);
      setSelection(null);
      setDraft(undefined);
      setDeleteFlowConfirm(false);
      return;
    }

    if (action.kind === 'create-stage') {
      const stage = newStage(locale, source);
      const next = { ...source, stages: [...source.stages, stage] };
      flows.updateFile(() => next);
      setSelectionFor({ kind: 'library', stageId: stage.id }, next);
      return;
    }

    if (action.kind === 'add-stage') {
      const flow = source.flows.find((item) => item.id === action.flowId);
      if (!flow || flow.builtin || !source.stages.some((stage) => stage.id === action.stageId)) return;
      const index = Math.max(0, Math.min(action.index, flow.stages.length));
      const nextFlow = addStageToFlow(flow, action.stageId, index);
      const next = { ...source, flows: source.flows.map((item) => item.id === flow.id ? nextFlow : item) };
      flows.updateFile(() => next);
      setSelectedFlowId(flow.id);
      setSelectionFor({ kind: 'flow', flowId: flow.id, index }, next);
      setFeedback({ tone: 'neutral', message: text.t('stageAdded') });
      return;
    }

    if (action.kind === 'create-add-stage') {
      const flow = source.flows.find((item) => item.id === action.flowId);
      if (!flow || flow.builtin) return;
      const stage = newStage(locale, source);
      const index = Math.max(0, Math.min(action.index, flow.stages.length));
      const nextFlow = addStageToFlow(flow, stage.id, index);
      const next = {
        ...source,
        stages: [...source.stages, stage],
        flows: source.flows.map((item) => item.id === flow.id ? nextFlow : item),
      };
      flows.updateFile(() => next);
      setSelectedFlowId(flow.id);
      setSelectionFor({ kind: 'flow', flowId: flow.id, index }, next);
      setFeedback({ tone: 'neutral', message: text.t('stageAdded') });
      return;
    }

    if (action.kind === 'remove-stage') {
      if (action.selection.kind !== 'flow') return;
      const flow = source.flows.find((item) => item.id === action.selection.flowId);
      if (!flow || flow.builtin || !flow.stages[action.selection.index]) return;
      const nextFlow = removeStageRef(flow, action.selection.index);
      const next = { ...source, flows: source.flows.map((item) => item.id === flow.id ? nextFlow : item) };
      flows.updateFile(() => next);
      setSelection(null);
      setDraft(undefined);
      setFeedback({ tone: 'neutral', message: text.t('stageRemoved') });
      return;
    }

    if (action.kind === 'delete-flow') {
      const flow = source.flows.find((item) => item.id === action.flowId);
      if (!flow || flow.builtin) return;
      const next = { ...source, flows: source.flows.filter((item) => item.id !== flow.id) };
      flows.updateFile(() => next);
      const fallback = next.flows[0];
      const nextSelection: StageSelection | null = fallback?.stages.length ? { kind: 'flow', flowId: fallback.id, index: 0 } : null;
      setSelectedFlowId(fallback?.id ?? '');
      setSelection(nextSelection);
      setDraft(stageForSelection(next, nextSelection));
      setDeleteFlowConfirm(false);
      setFeedback({ tone: 'neutral', message: text.t('flowDeleted') });
      return;
    }

    if (action.kind === 'delete-stage') {
      if (!canDeleteStage(source, action.stageId)) return;
      const next = { ...source, stages: source.stages.filter((stage) => stage.id !== action.stageId) };
      flows.updateFile(() => next);
      setSelection(null);
      setDraft(undefined);
      setDeleteStageConfirm(false);
      setFeedback({ tone: 'neutral', message: text.t('stageDeleted') });
      return;
    }

    if (action.kind === 'import') {
      const next = resolveImportChoice(source, action.incoming, action.resolution);
      flows.updateFile(() => next);
      setDraft(stageForSelection(next, selection));
      setFeedback({ tone: 'neutral', message: text.t('importDone') });
      return;
    }

    const flow = source.flows.find((item) => item.id === action.flowId);
    if (!flow) return;
    const copied = duplicateFlow(flow, source.flows);
    const allIds = [...source.stages.map((stage) => stage.id), ...source.flows.map((item) => item.id)];
    const copy = allIds.includes(copied.id) ? { ...copied, id: uniqueId('flow-copy', allIds) } : copied;
    const next = { ...source, flows: [...source.flows, copy] };
    flows.updateFile(() => next);
    const nextSelection: StageSelection | null = copy.stages.length ? { kind: 'flow', flowId: copy.id, index: 0 } : null;
    setSelectedFlowId(copy.id);
    setSelection(nextSelection);
    setDraft(stageForSelection(next, nextSelection));
    setFeedback({ tone: 'neutral', message: text.t('copiedFlow') });
  };

  const requestAction = (action: PendingAction) => {
    if (mutationsDisabled) return;
    if (hasUnsaved) {
      setPendingAction(action);
      setFeedback(undefined);
      return;
    }
    performAction(action);
  };

  const saveCurrent = async (scope?: StageDraftScope): Promise<boolean> => {
    if (!file || mutationsDisabled) return false;
    let candidate = file;
    if (draftDirty && draft && selection) {
      const base = candidate.stages.find((stage) => stage.id === draft.id);
      const referenced = selection.kind === 'flow'
        ? candidate.flows.filter((flow) => flow.stages.some((ref) => ref.stageId === draft.id))
        : [];
      if (selection.kind === 'flow' && referenced.length > 1 && scope === undefined) {
        setScopePrompt(true);
        return false;
      }
      const chosenScope = selection.kind === 'flow' && referenced.length > 1 ? scope ?? 'library' : 'library';
      if (chosenScope === 'flow' && base && !canOverrideStageDraft(base, draft)) {
        setEditError(text.t('overrideUnsupported'));
        return false;
      }
      const updated = applyStageDraft(candidate, selection, draft, chosenScope);
      if (!updated) {
        setEditError(text.t('overrideUnsupported'));
        return false;
      }
      candidate = updated;
    }

    const success = await flows.save(candidate);
    if (success) {
      setScopePrompt(false);
      setEditError(undefined);
      setFeedback({ tone: 'neutral', message: text.t('saved') });
      setDraft(stageForSelection(candidate, selection));
      if (pendingAction) {
        const action = pendingAction;
        setPendingAction(null);
        performAction(action, candidate);
      }
      return true;
    }
    setFeedback({ tone: 'block', message: text.t('saveFailed') });
    return false;
  };

  const discardAndContinue = () => {
    const restored = flows.discardChanges();
    if (!restored) return;
    const action = pendingAction;
    setPendingAction(null);
    setScopePrompt(false);
    setEditError(undefined);
    setFeedback(undefined);
    setDraft(undefined);
    if (action) performAction(action, restored);
    else setDraft(stageForSelection(restored, selection));
  };

  const copyStage = () => {
    if (!file || !selectedStage || !draft || mutationsDisabled) return;
    const copied = duplicateStage(draft, file.stages);
    const allIds = [...file.flows.map((flow) => flow.id), ...file.stages.map((stage) => stage.id)];
    const copy = allIds.includes(copied.id) ? { ...copied, id: uniqueId('stage-copy', allIds) } : copied;
    let next: FlowsFile = { ...file, stages: [...file.stages, copy] };
    let nextSelection: StageSelection = { kind: 'library', stageId: copy.id };
    if (selection?.kind === 'flow') {
      const flow = file.flows.find((item) => item.id === selection.flowId);
      if (flow && !flow.builtin) {
        next = cloneFlowWithStage(next, flow.id, selection.index, copy.id);
        nextSelection = { kind: 'flow', flowId: flow.id, index: selection.index };
      }
    }
    flows.updateFile(() => next);
    setSelectionFor(nextSelection, next);
    setFeedback({ tone: 'neutral', message: text.t('copiedStage') });
  };

  const handleImport = (incoming: FlowsFile, resolution: Exclude<ImportResolution, 'cancel'>) => {
    if (!file || mutationsDisabled) return;
    requestAction({ kind: 'import', incoming, resolution });
  };

  const currentStageName = selectedStage ? itemLabel(selectedStage, locale) : '';
  const flowList = file && selectedFlow ? (
    <FlowStageList
      file={file}
      flow={selectedFlow}
      locale={locale}
      text={text}
      selection={selection}
      issues={flows.issues}
      disabled={mutationsDisabled}
      saving={flows.saving}
      insertIndex={insertIndex}
      selectedAddStage={selectedAddStage}
      deleteConfirm={deleteFlowConfirm}
      fs={fs}
      onFlowNameChange={(name) => {
        flows.updateFile((current) => ({
          ...current,
          flows: current.flows.map((flow) => flow.id === selectedFlow.id
            ? { ...flow, name, nameEn: flow.nameEn && name !== flow.name ? undefined : flow.nameEn }
            : flow),
        }));
        setFeedback(undefined);
      }}
      onCopyFlow={() => requestAction({ kind: 'copy-flow', flowId: selectedFlow.id })}
      onSave={() => { void saveCurrent(); }}
      onRequestDeleteFlow={() => setDeleteFlowConfirm(true)}
      onConfirmDeleteFlow={() => requestAction({ kind: 'delete-flow', flowId: selectedFlow.id })}
      onCancelDeleteFlow={() => setDeleteFlowConfirm(false)}
      onSelectStage={(index) => requestAction({ kind: 'select-stage', selection: { kind: 'flow', flowId: selectedFlow.id, index } })}
      onMoveStage={(from, to) => {
        if (mutationsDisabled || selectedFlow.builtin) return;
        const nextFlow = moveStageRef(selectedFlow, from, to);
        if (nextFlow === selectedFlow) return;
        const next = { ...file, flows: file.flows.map((flow) => flow.id === selectedFlow.id ? nextFlow : flow) };
        flows.updateFile(() => next);
        if (selection?.kind === 'flow' && selection.flowId === selectedFlow.id) {
          const index = selection.index === from
            ? to
            : from < to && selection.index > from && selection.index <= to
              ? selection.index - 1
              : from > to && selection.index >= to && selection.index < from
                ? selection.index + 1
                : selection.index;
          const nextSelection: StageSelection = { kind: 'flow', flowId: selectedFlow.id, index };
          setSelection(nextSelection);
          setDraft(stageForSelection(next, nextSelection));
        }
        setFeedback(undefined);
      }}
      onOpenInsert={(index) => {
        setInsertIndex(index < 0 ? null : index);
        setSelectedAddStage('');
      }}
      onSelectAddStage={setSelectedAddStage}
      onAddStage={() => {
        if (insertIndex === null) return;
        requestAction({ kind: 'add-stage', flowId: selectedFlow.id, stageId: selectedAddStage, index: insertIndex });
      }}
      onCreateAndAddStage={() => {
        if (insertIndex === null) return;
        requestAction({ kind: 'create-add-stage', flowId: selectedFlow.id, index: insertIndex });
      }}
      onImport={handleImport}
    />
  ) : (
    <Card><p className="text-v2-meta text-v2-ink-3">{text.t('noFlows')}</p></Card>
  );

  return (
    <div className="mx-auto grid min-h-full max-w-[1800px] gap-v2-lg p-v2-page">
      <header className="grid gap-v2-sm">
        <div className="flex flex-wrap items-center gap-v2-sm">
          <h1 className="text-v2-heading font-semibold text-v2-ink">{text.t('pageTitle')}</h1>
          <Badge>{text.t('localFile')}</Badge>
          {hasUnsaved ? <Badge tone="unknown">{text.t('dirty')}</Badge> : null}
        </div>
        <p className="max-w-3xl text-v2-body text-v2-ink-2">{text.t('intro')}</p>
        <Notice tone="neutral" title={text.t('howRunLabel')}>{text.t('howRuns')}</Notice>
      </header>

      {flows.loading ? <LoadingState label={text.t('loadingFlows')} /> : null}
      {flows.status === 'fresh' && !flows.dirty ? <Notice tone="neutral">{text.t('freshNotice')}</Notice> : null}
      {flows.status === 'recovered' ? (
        <Notice tone="unknown" title={text.t('recoveredTitle')}>
          {flows.backup ? text.t('recoveredBody', { name: flows.backup }) : text.t('recoveredNoBackup')}
        </Notice>
      ) : null}
      {flows.loadError ? (
        <Notice tone="block" title={text.t('loadErrorTitle')} actions={<Button size="sm" variant="secondary" onClick={() => void flows.reload()}>{text.t('retryLoad')}</Button>}>
          {text.t('loadErrorBody', { message: flows.loadError })}
        </Notice>
      ) : null}
      {flows.operationError ? <Notice tone="block" title={text.t('saveFailed')}>{flows.operationError}</Notice> : null}
      {feedback ? <Notice tone={feedback.tone} live={feedback.tone === 'block' ? 'assertive' : 'polite'}>{feedback.message}</Notice> : null}
      {editError ? <Notice tone="block">{editError}</Notice> : null}

      {pendingAction ? (
        <Notice tone="unknown" title={text.t('dirty')} live="polite">
          <p>{text.t('saveBeforeSwitch')}</p>
          <div className="mt-v2-sm flex flex-wrap gap-v2-sm">
            <Button size="sm" onClick={() => { void saveCurrent(); }}>{text.t('saveAndContinue')}</Button>
            <Button size="sm" variant="secondary" onClick={discardAndContinue}>{text.t('discardAndContinue')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingAction(null)}>{text.t('keepEditing')}</Button>
          </div>
        </Notice>
      ) : null}

      {flows.issues.length ? (
        <Notice tone="block" title={text.t('validationSummary', { n: flows.issues.length })} live="assertive">
          <ul className="grid gap-1">
            {flows.issues.map((issue, index) => (
              <li key={issue.path + '-' + issue.code + '-' + index} className="text-v2-meta">
                {text.t('importValidation', { message: issueLabel(issue.code, text), path: issue.path })}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {file ? (
        <>
          <CompactFlowSelectors
            file={file}
            locale={locale}
            text={text}
            selectedFlowId={selectedFlowId}
            selection={selection}
            disabled={mutationsDisabled}
            onSelectFlow={(flowId) => requestAction({ kind: 'select-flow', flowId })}
            onSelectLibraryStage={(stageId) => requestAction({ kind: 'select-stage', selection: { kind: 'library', stageId } })}
            onCreateFlow={() => requestAction({ kind: 'create-flow' })}
            onCreateStage={() => requestAction({ kind: 'create-stage' })}
          />
          <div className="relative grid min-w-0 content-start gap-v2-lg min-[1100px]:grid-cols-[150px_minmax(0,1fr)] min-[1320px]:grid-cols-[170px_minmax(0,1fr)_minmax(320px,0.85fr)]">
            <div className="hidden min-w-0 min-[1100px]:block">
              <FlowSidebar
                file={file}
                locale={locale}
                text={text}
                selectedFlowId={selectedFlowId}
                selection={selection}
                disabled={mutationsDisabled}
                onSelectFlow={(flowId) => requestAction({ kind: 'select-flow', flowId })}
                onSelectLibraryStage={(stageId) => requestAction({ kind: 'select-stage', selection: { kind: 'library', stageId } })}
                onCreateFlow={() => requestAction({ kind: 'create-flow' })}
                onCreateStage={() => requestAction({ kind: 'create-stage' })}
              />
            </div>
            {flowList}
            {selectedStage ? (
              <aside className="min-w-0 max-[1319px]:absolute max-[1319px]:right-0 max-[1319px]:top-0 max-[1319px]:z-20 max-[1319px]:w-[min(440px,48vw)] max-[1319px]:max-h-[calc(100vh-10rem)] max-[1319px]:overflow-y-auto max-[1319px]:shadow-v2-float" aria-label={text.t('stageDetails')}>
                <StageEditor
                  file={file}
                  locale={locale}
                  text={text}
                  selection={selection}
                  stage={selectedStage}
                  draft={draft}
                  selectedFlow={selectedFlow}
                  usageFlows={usageFlows}
                  readOnly={flows.status === 'error'}
                  scopePrompt={scopePrompt}
                  scopeCanFlow={scopeCanFlow}
                  deleteConfirm={deleteStageConfirm}
                  disabled={mutationsDisabled}
                  onChange={(nextDraft) => {
                    setDraft(nextDraft);
                    setFeedback(undefined);
                    setEditError(undefined);
                    flows.clearIssues();
                  }}
                  onCopy={copyStage}
                  onRemoveFromFlow={() => selection && requestAction({ kind: 'remove-stage', selection })}
                  onRequestDelete={() => setDeleteStageConfirm(true)}
                  onConfirmDelete={() => selection?.kind === 'library' && requestAction({ kind: 'delete-stage', stageId: selection.stageId })}
                  onCancelDelete={() => setDeleteStageConfirm(false)}
                  onChooseScope={(scope) => { void saveCurrent(scope); }}
                  onCancelScope={() => setScopePrompt(false)}
                />
              </aside>
            ) : null}
          </div>
        </>
      ) : null}

      <FlowSecurityRules text={text} />
      {currentStageName ? <span className="sr-only" aria-live="polite">{text.t('stageDetails')}: {currentStageName}</span> : null}
    </div>
  );
}
