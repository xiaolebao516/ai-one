import type { Dispatch, SetStateAction } from 'react';
import type { Locale } from '../../i18n/resolve';
import type { FlowDef, FlowsFile, StageDef } from '../flowModel';
import type { StageDraftScope, StageSelection, ImportResolution } from '../flowEditor';
import type { UseFlowsResult } from '../useFlows';
import type { FlowsText } from '../../workbench/views/flowsText';

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
  | { kind: 'move-stage'; flowId: string; from: number; to: number }
  | { kind: 'create-add-stage'; flowId: string; index: number }
  | { kind: 'remove-stage'; selection: StageSelection }
  | { kind: 'delete-flow'; flowId: string }
  | { kind: 'delete-stage'; stageId: string }
  | { kind: 'copy-flow'; flowId: string }
  | { kind: 'import'; incoming: FlowsFile; resolution: Exclude<ImportResolution, 'cancel'> };

export interface FlowsEditorActionContext {
  locale: Locale;
  text: FlowsText;
  flows: UseFlowsResult;
  file: FlowsFile | null;
  selectedFlow?: FlowDef;
  selectedStage?: StageDef;
  selection: StageSelection | null;
  draft?: StageDef;
  draftDirty: boolean;
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
