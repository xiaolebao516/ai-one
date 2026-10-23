import { describe, expect, it } from 'vitest';
import {
  applyStageDraft,
  moveStageFromShortcut,
  resolveImportChoice,
  stageMoveTarget,
} from '../stages/flowEditor';
import {
  builtinFlows,
  builtinStages,
  duplicateStage,
  resolveStage,
  type FlowDef,
  type FlowsFile,
  type StageDef,
} from '../stages/flowModel';

function customStage(id: string, name = id): StageDef {
  return {
    id,
    name,
    collaboration: 'solo',
    participants: [{ resource: 'chatgpt', role: 'worker' }],
    endCondition: 'user-confirms',
    onFail: 'stop-and-ask',
    builtin: false,
  };
}

function sharedFile(): FlowsFile {
  const stage = customStage('stage.shared', 'Shared stage');
  return {
    schemaVersion: 1,
    stages: [stage],
    flows: [
      { id: 'flow.a', name: 'Flow A', stages: [{ stageId: stage.id }], builtin: false },
      { id: 'flow.b', name: 'Flow B', stages: [{ stageId: stage.id }], builtin: false },
    ],
  };
}

describe('flow editor draft helpers', () => {
  it('copies a built-in stage into an editable library definition', () => {
    const builtins = builtinStages();
    const source = builtins[0];
    const copy = duplicateStage(source, builtins);
    const file: FlowsFile = {
      schemaVersion: 1,
      stages: [...builtins, copy],
      flows: builtinFlows(),
    };
    const edited = { ...copy, note: 'Only this copy changed' };
    const next = applyStageDraft(file, { kind: 'library', stageId: copy.id }, edited, 'library');

    expect(next?.stages.find((stage) => stage.id === copy.id)).toMatchObject({ builtin: false, note: 'Only this copy changed' });
    expect(next?.stages.find((stage) => stage.id === source.id)).toEqual(source);
  });

  it('writes only-flow edits to StageRef overrides without mutating the library or another flow', () => {
    const file = sharedFile();
    const base = file.stages[0];
    const draft: StageDef = {
      ...base,
      participants: [{ resource: 'claude', role: 'author' }],
      endCondition: 'audit-pass',
      note: 'For Flow A only',
    };

    const next = applyStageDraft(file, { kind: 'flow', flowId: 'flow.a', index: 0 }, draft, 'flow');

    expect(next?.stages[0]).toEqual(base);
    expect(next?.flows[0].stages[0].overrides).toMatchObject({
      participants: [{ resource: 'claude', role: 'author' }],
      endCondition: 'audit-pass',
      note: 'For Flow A only',
    });
    expect(resolveStage(next?.flows[0].stages[0] ?? { stageId: 'missing' }, next?.stages ?? [])).toMatchObject({
      participants: [{ resource: 'claude', role: 'author' }],
      endCondition: 'audit-pass',
    });
    expect(next?.flows[1].stages[0].overrides).toBeUndefined();
  });

  it('promotes a saved flow-only override to the library without changing another flow ref', () => {
    const initial = sharedFile();
    const a = { kind: 'flow' as const, flowId: 'flow.a', index: 0 };
    const b = { kind: 'flow' as const, flowId: 'flow.b', index: 0 };
    const flowOnlyA = applyStageDraft(initial, a, {
      ...initial.stages[0], participants: [{ resource: 'claude', role: 'worker' }], note: 'Old flow A',
    }, 'flow')!;
    const withPeerOverride = applyStageDraft(flowOnlyA, b, {
      ...initial.stages[0], participants: [{ resource: 'codex', role: 'worker' }], note: 'Keep flow B',
    }, 'flow')!;
    const persisted = JSON.parse(JSON.stringify(withPeerOverride)) as FlowsFile;
    const next = applyStageDraft(persisted, a, {
      ...resolveStage(persisted.flows[0].stages[0], persisted.stages)!,
      participants: [{ resource: 'gemini', role: 'worker' }], note: 'Promoted',
    }, 'library')!;
    const reloaded = JSON.parse(JSON.stringify(next)) as FlowsFile;
    expect(reloaded.stages[0].participants[0].resource).toBe('gemini');
    expect(reloaded.flows[0].stages[0].overrides).toBeUndefined();
    expect(resolveStage(reloaded.flows[0].stages[0], reloaded.stages)).toMatchObject({
      participants: [{ resource: 'gemini', role: 'worker' }], note: 'Promoted',
    });
    expect(reloaded.flows[1].stages[0].overrides).toEqual(withPeerOverride.flows[1].stages[0].overrides);
    expect(resolveStage(reloaded.flows[1].stages[0], reloaded.stages)).toMatchObject({
      participants: [{ resource: 'codex', role: 'worker' }], note: 'Keep flow B',
    });
  });

  it('maps Alt+Up and Alt+Down to the same move used by stage cards', () => {
    const flow: FlowDef = { id: 'flow.move', name: 'Move test', stages: [{ stageId: 'a' }, { stageId: 'b' }, { stageId: 'c' }], builtin: false };
    expect(stageMoveTarget(1, 'ArrowUp', true)).toBe(0);
    expect(stageMoveTarget(1, 'ArrowDown', true)).toBe(2);
    expect(stageMoveTarget(1, 'ArrowDown', false)).toBeNull();
    expect(moveStageFromShortcut(flow, 0, 'ArrowDown', true).stages.map((ref) => ref.stageId)).toEqual([
      flow.stages[1].stageId,
      flow.stages[0].stageId,
      flow.stages[2].stageId,
    ]);
    expect(moveStageFromShortcut(flow, 0, 'ArrowDown', false)).toBe(flow);
  });

  it('requires an explicit import choice and distinguishes cancel, keep-both and overwrite', () => {
    const current = sharedFile();
    const incoming: FlowsFile = {
      schemaVersion: 1,
      stages: [{ ...customStage('stage.imported', 'Shared stage'), description: 'incoming definition' }],
      flows: [{ id: 'flow.imported', name: 'Flow A', stages: [{ stageId: 'stage.imported' }], builtin: false }],
    };

    expect(resolveImportChoice(current, incoming, 'cancel')).toBe(current);
    const both = resolveImportChoice(current, incoming, 'keep-both');
    expect(both.stages).toHaveLength(2);
    expect(both.flows).toHaveLength(3);
    expect(both.stages.some((stage) => stage.name === 'Shared stage (2)')).toBe(true);

    const overwritten = resolveImportChoice(current, incoming, 'overwrite');
    expect(overwritten.stages).toHaveLength(1);
    expect(overwritten.stages[0]).toMatchObject({ id: 'stage.shared', description: 'incoming definition' });
    expect(overwritten.flows.find((flow) => flow.id === 'flow.a')).toMatchObject({
      stages: [{ stageId: 'stage.shared' }],
      builtin: false,
    });
  });
});
