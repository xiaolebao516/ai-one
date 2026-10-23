import {
  addStageToFlow,
  canDeleteStage,
  duplicateFlow,
  duplicateStage,
  moveStageRef,
  removeStageRef,
  type FlowsFile,
  type StageDef,
} from './flowModel';
import { applyStageDraft, canOverrideStageDraft, resolveImportChoice, stageForSelection, type StageDraftScope, type StageSelection, type ImportResolution } from './flowEditor';
import { createFlowDefinition, createStageDefinition, replaceFlowStage, uniqueFlowEditorId } from './flows/flowEditorFactory';
import type { FlowsEditorActionContext, FlowsEditorActionHandlers, PendingEditorAction } from './flows/flowEditorTypes';

export interface EditorFeedback {
  tone: 'neutral' | 'block';
  message: string;
}

export type PendingEditorAction =
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

export interface FlowsEditorActionContext {
  locale: Locale;
  text: FlowsText;
  fs?: LocalStoreFs;
  flows: UseFlowsResult;
  file: FlowsFile | null;
  selectedFlow?: FlowDef;
  selectedStage?: StageDef;
  selectedFlowId: string;
  selection: StageSelection | null;
  draft?: StageDef;
  draftDirty: boolean;
  hasUnsaved: boolean;
  mutationsDisabled: boolean;
  pendingAction: PendingEditorAction | null;
  insertIndex: number | null;
  selectedAddStage: string;
  setSelectedFlowId: Dispatch<SetStateAction<string>>;
  setSelection: Dispatch<SetStateAction<StageSelection | null>>;
  setDraft: Dispatch<SetStateAction<StageDef | undefined>>;
  setInsertIndex: Dispatch<SetStateAction<number | null>>;
  setSelectedAddStage: Dispatch<SetStateAction<string>>;
  setPendingAction: Dispatch<SetStateAction<PendingEditorAction | null>>;
  setScopePrompt: Dispatch<SetStateAction<boolean>>;
  setDeleteFlowConfirm: Dispatch<SetStateAction<boolean>>;
  setDeleteStageConfirm: Dispatch<SetStateAction<boolean>>;
  setFeedback: Dispatch<SetStateAction<EditorFeedback | undefined>>;
  setEditError: Dispatch<SetStateAction<string | undefined>>;
}

export interface FlowsEditorActionHandlers {
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



export function createFlowsEditorActions(context: FlowsEditorActionContext): FlowsEditorActionHandlers {
  const performAction = (action: PendingEditorAction, source = context.flows.file) => {
    if (!source || context.mutationsDisabled) return;
    context.setFeedback(undefined);
    context.setScopePrompt(false);
    context.setEditError(undefined);

    if (action.kind === 'select-flow') {
      const flow = source.flows.find((item) => item.id === action.flowId);
      if (!flow) return;
      const nextSelection: StageSelection | null = flow.stages.length ? { kind: 'flow', flowId: flow.id, index: 0 } : null;
      context.setSelectedFlowId(flow.id);
      context.setSelection(nextSelection);
      context.setDraft(stageForSelection(source, nextSelection));
      context.setInsertIndex(null);
      context.setSelectedAddStage('');
      context.setDeleteFlowConfirm(false);
      context.setDeleteStageConfirm(false);
      return;
    }

    if (action.kind === 'select-stage') {
      const nextSelection = action.selection;
      if (nextSelection.kind === 'flow') {
        const flow = source.flows.find((item) => item.id === nextSelection.flowId);
        if (!flow || !flow.stages[nextSelection.index]) return;
        context.setSelectedFlowId(flow.id);
      } else if (!source.stages.some((stage) => stage.id === nextSelection.stageId)) return;
      setSelectionFor(nextSelection, source);
      return;
    }

    if (action.kind === 'create-flow') {
      const flow = createFlowDefinition(context.locale, source);
      const next = { ...source, flows: [...source.flows, flow] };
      context.flows.updateFile(() => next);
      context.setSelectedFlowId(flow.id);
      context.setSelection(null);
      context.setDraft(undefined);
      context.setDeleteFlowConfirm(false);
      return;
    }

    if (action.kind === 'create-stage') {
      const stage = createStageDefinition(context.locale, source);
      const next = { ...source, stages: [...source.stages, stage] };
      context.flows.updateFile(() => next);
      setSelectionFor({ kind: 'library', stageId: stage.id }, next);
      return;
    }

    if (action.kind === 'add-stage') {
      const flow = source.flows.find((item) => item.id === action.flowId);
      if (!flow || flow.builtin || !source.stages.some((stage) => stage.id === action.stageId)) return;
      const index = Math.max(0, Math.min(action.index, flow.stages.length));
      const nextFlow = addStageToFlow(flow, action.stageId, index);
      const next = { ...source, flows: source.flows.map((item) => item.id === flow.id ? nextFlow : item) };
      context.flows.updateFile(() => next);
      context.setSelectedFlowId(flow.id);
      setSelectionFor({ kind: 'flow', flowId: flow.id, index }, next);
      context.setFeedback({ tone: 'neutral', message: context.text.t('stageAdded') });
      return;
    }

    if (action.kind === 'create-add-stage') {
      const flow = source.flows.find((item) => item.id === action.flowId);
      if (!flow || flow.builtin) return;
      const stage = newStage(context.locale, source);
      const index = Math.max(0, Math.min(action.index, flow.stages.length));
      const nextFlow = addStageToFlow(flow, stage.id, index);
      const next = {
        ...source,
        stages: [...source.stages, stage],
        flows: source.flows.map((item) => item.id === flow.id ? nextFlow : item),
      };
      context.flows.updateFile(() => next);
      context.setSelectedFlowId(flow.id);
      setSelectionFor({ kind: 'flow', flowId: flow.id, index }, next);
      context.setFeedback({ tone: 'neutral', message: context.text.t('stageAdded') });
      return;
    }

    if (action.kind === 'remove-stage') {
      if (action.selection.kind !== 'flow') return;
      const flow = source.flows.find((item) => item.id === action.selection.flowId);
      if (!flow || flow.builtin || !flow.stages[action.selection.index]) return;
      const nextFlow = removeStageRef(flow, action.selection.index);
      const next = { ...source, flows: source.flows.map((item) => item.id === flow.id ? nextFlow : item) };
      context.flows.updateFile(() => next);
      context.setSelection(null);
      context.setDraft(undefined);
      context.setFeedback({ tone: 'neutral', message: context.text.t('stageRemoved') });
      return;
    }

    if (action.kind === 'delete-flow') {
      const flow = source.flows.find((item) => item.id === action.flowId);
      if (!flow || flow.builtin) return;
      const next = { ...source, flows: source.flows.filter((item) => item.id !== flow.id) };
      context.flows.updateFile(() => next);
      const fallback = next.flows[0];
      const nextSelection: StageSelection | null = fallback?.stages.length ? { kind: 'flow', flowId: fallback.id, index: 0 } : null;
      context.setSelectedFlowId(fallback?.id ?? '');
      context.setSelection(nextSelection);
      context.setDraft(stageForSelection(next, nextSelection));
      context.setDeleteFlowConfirm(false);
      context.setFeedback({ tone: 'neutral', message: context.text.t('flowDeleted') });
      return;
    }

    if (action.kind === 'delete-stage') {
      if (!canDeleteStage(source, action.stageId)) return;
      const next = { ...source, stages: source.stages.filter((stage) => stage.id !== action.stageId) };
      context.flows.updateFile(() => next);
      context.setSelection(null);
      context.setDraft(undefined);
      context.setDeleteStageConfirm(false);
      context.setFeedback({ tone: 'neutral', message: context.text.t('stageDeleted') });
      return;
    }

    if (action.kind === 'import') {
      const next = resolveImportChoice(source, action.incoming, action.resolution);
      context.flows.updateFile(() => next);
      context.setDraft(stageForSelection(next, context.selection));
      context.setFeedback({ tone: 'neutral', message: context.text.t('importDone') });
      return;
    }

    const flow = source.flows.find((item) => item.id === action.flowId);
    if (!flow) return;
    const copied = duplicateFlow(flow, source.flows);
    const allIds = [...source.stages.map((stage) => stage.id), ...source.flows.map((item) => item.id)];
    const copy = allIds.includes(copied.id) ? { ...copied, id: uniqueFlowEditorId('flow-copy', allIds) } : copied;
    const next = { ...source, flows: [...source.flows, copy] };
    context.flows.updateFile(() => next);
    const nextSelection: StageSelection | null = copy.stages.length ? { kind: 'flow', flowId: copy.id, index: 0 } : null;
    context.setSelectedFlowId(copy.id);
    context.setSelection(nextSelection);
    context.setDraft(stageForSelection(next, nextSelection));
    context.setFeedback({ tone: 'neutral', message: context.text.t('copiedFlow') });
  };

  const setSelectionFor = (target: StageSelection | null, source: FlowsFile) => {
    if (target?.kind === 'flow') context.setSelectedFlowId(target.flowId);
    context.setSelection(target);
    context.setDraft(stageForSelection(source, target));
    context.setScopePrompt(false);
    context.setDeleteStageConfirm(false);
    context.setInsertIndex(null);
    context.setSelectedAddStage('');
    context.setEditError(undefined);
  };

  const requestAction = (action: PendingEditorAction) => {
    if (context.mutationsDisabled) return;
    if (context.hasUnsaved) {
      context.setPendingAction(action);
      context.setFeedback(undefined);
      return;
    }
    performAction(action);
  };

  const saveCurrent = async (scope?: StageDraftScope): Promise<boolean> => {
    if (!context.file || context.mutationsDisabled) return false;
    let candidate = context.file;
    if (context.draftDirty && context.draft && context.selection) {
      const base = candidate.stages.find((stage) => stage.id === context.draft?.id);
      const referenced = context.selection.kind === 'flow'
        ? candidate.flows.filter((flow) => flow.stages.some((ref) => ref.stageId === context.draft?.id))
        : [];
      if (context.selection.kind === 'flow' && referenced.length > 1 && scope === undefined) {
        context.setScopePrompt(true);
        return false;
      }
      const chosenScope = context.selection.kind === 'flow' && referenced.length > 1 ? scope ?? 'library' : 'library';
      if (chosenScope === 'flow' && base && !canOverrideStageDraft(base, context.draft)) {
        context.setEditError(context.text.t('overrideUnsupported'));
        return false;
      }
      const updated = applyStageDraft(candidate, context.selection, context.draft, chosenScope);
      if (!updated) {
        context.setEditError(context.text.t('overrideUnsupported'));
        return false;
      }
      candidate = updated;
    }

    const success = await context.flows.save(candidate);
    if (success) {
      context.setScopePrompt(false);
      context.setEditError(undefined);
      context.setFeedback({ tone: 'neutral', message: context.text.t('saved') });
      context.setDraft(stageForSelection(candidate, context.selection));
      if (context.pendingAction) {
        const action = context.pendingAction;
        context.setPendingAction(null);
        performAction(action, candidate);
      }
      return true;
    }
    context.setFeedback({ tone: 'block', message: context.text.t('saveFailed') });
    return false;
  };

  const discardAndContinue = () => {
    const restored = context.flows.discardChanges();
    if (!restored) return;
    const action = context.pendingAction;
    context.setPendingAction(null);
    context.setScopePrompt(false);
    context.setEditError(undefined);
    context.setFeedback(undefined);
    context.setDraft(undefined);
    if (action) performAction(action, restored);
    else context.setDraft(stageForSelection(restored, context.selection));
  };

  const copyStage = () => {
    if (!context.file || !context.selectedStage || !context.draft || context.mutationsDisabled) return;
    const copied = duplicateStage(context.draft, context.file.stages);
    const allIds = [...context.file.flows.map((flow) => flow.id), ...context.file.stages.map((stage) => stage.id)];
    const copy = allIds.includes(copied.id) ? { ...copied, id: uniqueFlowEditorId('stage-copy', allIds) } : copied;
    let next: FlowsFile = { ...context.file, stages: [...context.file.stages, copy] };
    let nextSelection: StageSelection = { kind: 'library', stageId: copy.id };
    if (context.selection?.kind === 'flow') {
      const flow = context.file.flows.find((item) => item.id === context.selection?.flowId);
      if (flow && !flow.builtin) {
        next = replaceFlowStage(next, flow.id, context.selection.index, copy.id);
        nextSelection = { kind: 'flow', flowId: flow.id, index: context.selection.index };
      }
    }
    context.flows.updateFile(() => next);
    setSelectionFor(nextSelection, next);
    context.setFeedback({ tone: 'neutral', message: context.text.t('copiedStage') });
  };

  const changeFlowName = (name: string) => {
    if (!context.file || !context.selectedFlow) return;
    context.flows.updateFile((current) => ({
      ...current,
      flows: current.flows.map((flow) => flow.id === context.selectedFlow?.id
        ? { ...flow, name, nameEn: flow.nameEn && name !== flow.name ? undefined : flow.nameEn }
        : flow),
    }));
    context.setFeedback(undefined);
  };

  const moveFlowStage = (from: number, to: number) => {
    if (!context.file || !context.selectedFlow || context.mutationsDisabled || context.selectedFlow.builtin) return;
    const nextFlow = moveStageRef(context.selectedFlow, from, to);
    if (nextFlow === context.selectedFlow) return;
    const next = { ...context.file, flows: context.file.flows.map((flow) => flow.id === context.selectedFlow?.id ? nextFlow : flow) };
    context.flows.updateFile(() => next);
    if (context.selection?.kind === 'flow' && context.selection.flowId === context.selectedFlow.id) {
      const index = context.selection.index === from
        ? to
        : from < to && context.selection.index > from && context.selection.index <= to
          ? context.selection.index - 1
          : from > to && context.selection.index >= to && context.selection.index < from
            ? context.selection.index + 1
            : context.selection.index;
      const nextSelection: StageSelection = { kind: 'flow', flowId: context.selectedFlow.id, index };
      context.setSelection(nextSelection);
      context.setDraft(stageForSelection(next, nextSelection));
    }
    context.setFeedback(undefined);
  };

  const openInsert = (index: number) => {
    context.setInsertIndex(index < 0 ? null : index);
    context.setSelectedAddStage('');
  };

  return {
    saveCurrent,
    discardAndContinue,
    keepEditing: () => context.setPendingAction(null),
    selectFlow: (flowId) => requestAction({ kind: 'select-flow', flowId }),
    selectLibraryStage: (stageId) => requestAction({ kind: 'select-stage', selection: { kind: 'library', stageId } }),
    createFlow: () => requestAction({ kind: 'create-flow' }),
    createStage: () => requestAction({ kind: 'create-stage' }),
    changeFlowName,
    copyFlow: () => { if (context.selectedFlow) requestAction({ kind: 'copy-flow', flowId: context.selectedFlow.id }); },
    requestDeleteFlow: () => context.setDeleteFlowConfirm(true),
    confirmDeleteFlow: () => { if (context.selectedFlow) requestAction({ kind: 'delete-flow', flowId: context.selectedFlow.id }); },
    cancelDeleteFlow: () => context.setDeleteFlowConfirm(false),
    selectFlowStage: (index) => { if (context.selectedFlow) requestAction({ kind: 'select-stage', selection: { kind: 'flow', flowId: context.selectedFlow.id, index } }); },
    moveFlowStage,
    openInsert,
    selectAddStage: context.setSelectedAddStage,
    addSelectedStage: () => {
      if (context.selectedFlow && context.insertIndex !== null) {
        requestAction({ kind: 'add-stage', flowId: context.selectedFlow.id, stageId: context.selectedAddStage, index: context.insertIndex });
      }
    },
    createAndAddStage: () => {
      if (context.selectedFlow && context.insertIndex !== null) {
        requestAction({ kind: 'create-add-stage', flowId: context.selectedFlow.id, index: context.insertIndex });
      }
    },
    importFile: (incoming, resolution) => {
      if (context.file && !context.mutationsDisabled) requestAction({ kind: 'import', incoming, resolution });
    },
    changeStageDraft: (nextDraft) => {
      context.setDraft(nextDraft);
      context.setFeedback(undefined);
      context.setEditError(undefined);
      context.flows.clearIssues();
    },
    copyStage,
    removeStageFromFlow: () => { if (context.selection) requestAction({ kind: 'remove-stage', selection: context.selection }); },
    requestDeleteStage: () => context.setDeleteStageConfirm(true),
    confirmDeleteStage: () => {
      if (context.selection?.kind === 'library') requestAction({ kind: 'delete-stage', stageId: context.selection.stageId });
    },
    cancelDeleteStage: () => context.setDeleteStageConfirm(false),
    chooseScope: (scope) => { void saveCurrent(scope); },
    cancelScope: () => context.setScopePrompt(false),
  };
}
