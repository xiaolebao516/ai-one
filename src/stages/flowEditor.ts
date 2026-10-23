import {
  applyImport,
  moveStageRef,
  resolveStage,
  type FlowDef,
  type FlowExport,
  type FlowsFile,
  type StageDef,
  type StageRef,
} from './flowModel';

export type StageSelection =
  | { kind: 'flow'; flowId: string; index: number }
  | { kind: 'library'; stageId: string };

export type StageDraftScope = 'flow' | 'library';
export type ImportResolution = 'keep-both' | 'overwrite' | 'cancel';

export function stageForSelection(file: FlowsFile, selection: StageSelection | null): StageDef | undefined {
  if (!selection) return undefined;
  if (selection.kind === 'library') return file.stages.find((stage) => stage.id === selection.stageId);
  const flow = file.flows.find((item) => item.id === selection.flowId);
  const ref = flow?.stages[selection.index];
  return ref ? resolveStage(ref, file.stages) : undefined;
}

export function sameStage(a: StageDef | undefined, b: StageDef | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function canOverrideStageDraft(base: StageDef, draft: StageDef): boolean {
  // StageRef v1 deliberately cannot override these library-owned fields.
  if (
    draft.id !== base.id ||
    draft.name !== base.name ||
    draft.nameEn !== base.nameEn ||
    draft.description !== base.description ||
    draft.descriptionEn !== base.descriptionEn ||
    draft.command !== base.command ||
    draft.collaboration !== base.collaboration ||
    draft.builtin !== base.builtin
  ) return false;

  // An omitted reworkLimit cannot mask a library value after JSON serialization.
  if (base.reworkLimit !== undefined && draft.reworkLimit === undefined) return false;
  return true;
}

export function applyStageDraft(
  file: FlowsFile,
  selection: StageSelection,
  draft: StageDef,
  scope: StageDraftScope,
): FlowsFile | null {
  const base = file.stages.find((stage) => stage.id === draft.id);
  if (!base) return null;

  if (selection.kind === 'library' || scope === 'library') {
    return {
      ...file,
      stages: file.stages.map((stage) =>
        stage.id === base.id
          ? {
              ...draft,
              id: base.id,
              builtin: base.builtin,
              participants: draft.participants.map((participant) => ({ ...participant })),
            }
          : stage,
      ),
    };
  }

  if (!canOverrideStageDraft(base, draft)) return null;
  const flow = file.flows.find((item) => item.id === selection.flowId);
  const ref = flow?.stages[selection.index];
  if (!flow || !ref || ref.stageId !== base.id) return null;

  const overrides: NonNullable<StageRef['overrides']> = { ...(ref.overrides ?? {}) };
  const keys = ['participants', 'endCondition', 'onFail', 'reworkLimit', 'note'] as const;
  for (const key of keys) {
    const draftValue = draft[key];
    const baseValue = base[key];
    if (JSON.stringify(draftValue) === JSON.stringify(baseValue)) {
      delete overrides[key];
    } else if (key === 'note' && draftValue === undefined) {
      // Empty text is the serializable way to suppress a library note for this flow only.
      overrides.note = '';
    } else {
      switch (key) {
        case 'participants':
          overrides.participants = draft.participants.map((participant) => ({ ...participant }));
          break;
        case 'endCondition':
          overrides.endCondition = draft.endCondition;
          break;
        case 'onFail':
          overrides.onFail = draft.onFail;
          break;
        case 'reworkLimit':
          overrides.reworkLimit = draft.reworkLimit;
          break;
        case 'note':
          overrides.note = draft.note ?? '';
          break;
      }
    }
  }

  const nextRef: StageRef = {
    ...ref,
    ...(Object.keys(overrides).length > 0 ? { overrides } : { overrides: undefined }),
  };
  const nextFlow: FlowDef = {
    ...flow,
    stages: flow.stages.map((item, index) => index === selection.index ? nextRef : item),
  };
  return {
    ...file,
    flows: file.flows.map((item) => item.id === flow.id ? nextFlow : item),
  };
}

export function stageMoveTarget(index: number, key: string, altKey: boolean): number | null {
  if (!altKey || (key !== 'ArrowUp' && key !== 'ArrowDown')) return null;
  return index + (key === 'ArrowUp' ? -1 : 1);
}

export function moveStageFromShortcut(
  flow: FlowDef,
  index: number,
  key: string,
  altKey: boolean,
): FlowDef {
  const target = stageMoveTarget(index, key, altKey);
  return target === null ? flow : moveStageRef(flow, index, target);
}

export function resolveImportChoice(
  current: FlowsFile,
  incoming: FlowsFile | FlowExport,
  resolution: ImportResolution,
): FlowsFile {
  if (resolution === 'cancel') return current;
  return applyImport(current, incoming, resolution);
}
