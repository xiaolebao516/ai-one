import { useEffect, useState } from 'react';
import type { LocalStoreFs } from '../host/localStore';
import type { Locale } from '../i18n/resolve';
import type { FlowDef, FlowsFile, StageDef, ValidationIssue } from './flowModel';
import { sameStage, stageForSelection, type StageDraftScope, type StageSelection } from './flowEditor';
import { useFlows, type FlowsLoadStatus } from './useFlows';
import { createFlowsEditorActions, type EditorFeedback, type PendingEditorAction } from './useFlowsEditorActions';
import { flowsText } from '../workbench/views/flowsText';

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
  importFile: (incoming: FlowsFile, resolution: 'keep-both' | 'overwrite') => void;
  changeStageDraft: (draft: StageDef) => void;
  copyStage: () => void;
  removeStageFromFlow: () => void;
  requestDeleteStage: () => void;
  confirmDeleteStage: () => void;
  cancelDeleteStage: () => void;
  chooseScope: (scope: StageDraftScope) => void;
  cancelScope: () => void;
}

export function useFlowsEditor(locale: Locale, fs?: LocalStoreFs): FlowsEditorController {
  const text = flowsText(locale);
  const flows = useFlows(fs);
  const file = flows.file;
  const [selectedFlowId, setSelectedFlowId] = useState('');
  const [selection, setSelection] = useState<StageSelection | null>(null);
  const [draft, setDraft] = useState<StageDef | undefined>();
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [selectedAddStage, setSelectedAddStage] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingEditorAction | null>(null);
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
  const scopeCanFlow = Boolean(baseStage && draft && !(
    draft.id !== baseStage.id ||
    draft.name !== baseStage.name ||
    draft.nameEn !== baseStage.nameEn ||
    draft.description !== baseStage.description ||
    draft.descriptionEn !== baseStage.descriptionEn ||
    draft.command !== baseStage.command ||
    draft.collaboration !== baseStage.collaboration ||
    draft.builtin !== baseStage.builtin ||
    (baseStage.reworkLimit !== undefined && draft.reworkLimit === undefined)
  ));
  const mutationsDisabled = flows.loading || flows.saving || flows.status === 'error';

  useEffect(() => {
    if (!file || flows.issues.length === 0) return;
    const first = flows.issues.find((issue) => issue.stageId && (!issue.flowId || issue.flowId === selectedFlowId));
    if (!first?.stageId) return;
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="flow-stage-card"][data-stage-id]'));
    cards.find((card) => card.dataset.stageId === first.stageId)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [file, flows.issues, selectedFlowId]);

  const actions = createFlowsEditorActions({
    locale,
    text,
    flows,
    file,
    selectedFlow,
    selectedStage,
    selectedFlowId,
    selection,
    draft,
    draftDirty,
    hasUnsaved,
    mutationsDisabled,
    pendingAction,
    insertIndex,
    selectedAddStage,
    setSelectedFlowId,
    setSelection,
    setDraft,
    setInsertIndex,
    setSelectedAddStage,
    setPendingAction,
    setScopePrompt,
    setDeleteFlowConfirm,
    setDeleteStageConfirm,
    setFeedback,
    setEditError,
  });

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
    ...actions,
  };
}
