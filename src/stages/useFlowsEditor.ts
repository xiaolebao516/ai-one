import { useEffect, useState } from 'react';
import type { LocalStoreFs } from '../host/localStore';
import type { Locale } from '../i18n/resolve';
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
} from './flowModel';
import { applyStageDraft, canOverrideStageDraft, resolveImportChoice, sameStage, stageForSelection, type StageDraftScope, type StageSelection, type ImportResolution } from './flowEditor';
import { useFlows, type FlowsLoadStatus } from './useFlows';
import { flowsText, type FlowsText } from '../workbench/views/flowsText';

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

export interface EditorFeedback {
  tone: 'neutral' | 'block';
  message: string;
}

export interface FlowsEditorController {
  file: FlowsFile | null;
  status: FlowsLoadStatus;
  backup?: string;
  loadError?: string;
  operationError?: string;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  issues: ValidationIssue[];
  selectedFlowId: string;
  selectedFlow?: FlowDef;
  selection: StageSelection | null;
  selectedStage?: StageDef;
  draft?: StageDef;
  draftDirty: boolean;
  hasUnsaved: boolean;
  usageFlows: FlowDef[];
  scopeCanFlow: boolean;
  mutationsDisabled: boolean;
  insertIndex: number | null;
  selectedAddStage: string;
  pendingAction: boolean;
  scopePrompt: boolean;
  deleteFlowConfirm: boolean;
  deleteStageConfirm: boolean;
  feedback?: EditorFeedback;
  editError?: string;
  reload: () => Promise<void>;
  saveCurrent: (scope?: StageDraftScope) => Promise<boolean>;
  discardAndContinue: () => void;
  keepEditing: () => void;
  selectFlow: (flowId: string) => void;
  selectLibraryStage: (stageId: string) => void;
  createFlow: () => void;
  createStage: () => void;
  changeFlowName: (name: string) => void;
  copyFlow: () => void;
  requestDeleteFlow: () => void;
  confirmDeleteFlow: () => void;
  cancelDeleteFlow: () => void;
  selectFlowStage: (index: number) => void;
  moveFlowStage: (from: number, to: number) => void;
  openInsert: (index: number) => void;
  selectAddStage: (stageId: string) => void;
  addSelectedStage: () => void;
  createAndAddStage: () => void;
  importFile: (incoming: FlowsFile, resolution: Exclude<ImportResolution, 'cancel'>) => void;
  changeStageDraft: (draft: StageDef) => void;
  copyStage: () => void;
  removeStageFromFlow: () => void;
  requestDeleteStage: () => void;
  confirmDeleteStage: () => void;
  cancelDeleteStage: () => void;
  chooseScope: (scope: StageDraftScope) => void;
  cancelScope: () => void;
}

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

function cloneFlowWithStage(file: FlowsFile, flowId: string, index: number, stageId: string): FlowsFile {
  return {
    ...file,
    flows: file.flows.map((flow) => flow.id !== flowId ? flow : {
      ...flow,
      stages: flow.stages.map((ref, refIndex) => refIndex === index ? { stageId } : ref),
    }),
  };
}

export function useFlowsEditor(locale: Locale, fs?: LocalStoreFs, textOverride?: FlowsText): FlowsEditorController {
  const text = textOverride ?? flowsText(locale);
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
  const [feedback, setFeedback] = useState<EditorFeedback | undefined>();
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

  const changeFlowName = (name: string) => {
    if (!file || !selectedFlow) return;
    flows.updateFile((current) => ({
      ...current,
      flows: current.flows.map((flow) => flow.id === selectedFlow.id
        ? { ...flow, name, nameEn: flow.nameEn && name !== flow.name ? undefined : flow.nameEn }
        : flow),
    }));
    setFeedback(undefined);
  };

  const moveFlowStage = (from: number, to: number) => {
    if (!file || !selectedFlow || mutationsDisabled || selectedFlow.builtin) return;
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
  };

  const openInsert = (index: number) => {
    setInsertIndex(index < 0 ? null : index);
    setSelectedAddStage('');
  };

  const importFile = (incoming: FlowsFile, resolution: Exclude<ImportResolution, 'cancel'>) => {
    if (!file || mutationsDisabled) return;
    requestAction({ kind: 'import', incoming, resolution });
  };

  return {
    file,
    status: flows.status,
    ...(flows.backup ? { backup: flows.backup } : {}),
    ...(flows.loadError ? { loadError: flows.loadError } : {}),
    ...(flows.operationError ? { operationError: flows.operationError } : {}),
    loading: flows.loading,
    saving: flows.saving,
    dirty: flows.dirty,
    issues: flows.issues,
    selectedFlowId,
    selectedFlow,
    selection,
    selectedStage,
    draft,
    draftDirty,
    hasUnsaved,
    usageFlows,
    scopeCanFlow,
    mutationsDisabled,
    insertIndex,
    selectedAddStage,
    pendingAction: pendingAction !== null,
    scopePrompt,
    deleteFlowConfirm,
    deleteStageConfirm,
    ...(feedback ? { feedback } : {}),
    ...(editError ? { editError } : {}),
    reload: flows.reload,
    saveCurrent,
    discardAndContinue,
    keepEditing: () => setPendingAction(null),
    selectFlow: (flowId) => requestAction({ kind: 'select-flow', flowId }),
    selectLibraryStage: (stageId) => requestAction({ kind: 'select-stage', selection: { kind: 'library', stageId } }),
    createFlow: () => requestAction({ kind: 'create-flow' }),
    createStage: () => requestAction({ kind: 'create-stage' }),
    changeFlowName,
    copyFlow: () => selectedFlow && requestAction({ kind: 'copy-flow', flowId: selectedFlow.id }),
    requestDeleteFlow: () => setDeleteFlowConfirm(true),
    confirmDeleteFlow: () => selectedFlow && requestAction({ kind: 'delete-flow', flowId: selectedFlow.id }),
    cancelDeleteFlow: () => setDeleteFlowConfirm(false),
    selectFlowStage: (index) => selectedFlow && requestAction({ kind: 'select-stage', selection: { kind: 'flow', flowId: selectedFlow.id, index } }),
    moveFlowStage,
    openInsert,
    selectAddStage: setSelectedAddStage,
    addSelectedStage: () => selectedFlow && insertIndex !== null && requestAction({ kind: 'add-stage', flowId: selectedFlow.id, stageId: selectedAddStage, index: insertIndex }),
    createAndAddStage: () => selectedFlow && insertIndex !== null && requestAction({ kind: 'create-add-stage', flowId: selectedFlow.id, index: insertIndex }),
    importFile,
    changeStageDraft: (nextDraft) => {
      setDraft(nextDraft);
      setFeedback(undefined);
      setEditError(undefined);
      flows.clearIssues();
    },
    copyStage,
    removeStageFromFlow: () => selection && requestAction({ kind: 'remove-stage', selection }),
    requestDeleteStage: () => setDeleteStageConfirm(true),
    confirmDeleteStage: () => selection?.kind === 'library' && requestAction({ kind: 'delete-stage', stageId: selection.stageId }),
    cancelDeleteStage: () => setDeleteStageConfirm(false),
    chooseScope: (scope) => { void saveCurrent(scope); },
    cancelScope: () => setScopePrompt(false),
  };
}
