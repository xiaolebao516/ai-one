import { describe, expect, it } from 'vitest';
import {
  FLOWS_SCHEMA_VERSION,
  addStageToFlow,
  applyImport,
  buildExport,
  builtinFlows,
  builtinStages,
  canDeleteStage,
  duplicateFlow,
  duplicateStage,
  moveStageRef,
  parseFlowsFile,
  planImport,
  removeStageRef,
  resolveStage,
  stageUsage,
  validateFile,
  validateFlow,
  validateStage,
  type FlowDef,
  type FlowsFile,
  type StageDef,
} from '../stages/flowModel';

function validFile(): FlowsFile {
  return {
    schemaVersion: FLOWS_SCHEMA_VERSION,
    stages: builtinStages(),
    flows: builtinFlows(),
  };
}

function customStage(id: string, name = id): StageDef {
  return {
    id,
    name,
    collaboration: 'solo',
    participants: [{ resource: 'codex', role: '作者' }],
    endCondition: 'user-confirms',
    onFail: 'stop-and-ask',
    builtin: false,
  };
}

function customFlow(id: string, name: string, stageId = 'custom'): FlowDef {
  return { id, name, stages: [{ stageId }], builtin: false };
}

describe('flow model validation', () => {
  it('validates author-review requires distinct author and audit sessions', () => {
    const stage: StageDef = {
      ...customStage('review'),
      collaboration: 'author-review',
      participants: [
        { resource: 'chatgpt', role: 'author' },
        { resource: 'chatgpt', role: 'audit' },
      ],
    };
    expect(validateStage(stage).some((item) => item.code === 'same-author-audit-session')).toBe(true);
    expect(validateStage({
      ...stage,
      participants: [...stage.participants.slice(0, 1), { resource: 'chatgpt', role: 'audit', freshSession: true }],
    })).toEqual([]);
  });

  it('rejects every same-resource author/audit pair even when another author is independent', () => {
    const stage: StageDef = {
      ...customStage('review-multi'),
      collaboration: 'author-review',
      participants: [
        { resource: 'codex', role: 'author' },
        { resource: 'chatgpt', role: 'author' },
        { resource: 'chatgpt', role: 'audit' },
      ],
    };

    expect(validateStage(stage).map((item) => item.code)).toContain('same-author-audit-session');
  });

  it('normalizes resource identifiers before checking author-review independence', () => {
    const stage: StageDef = {
      ...customStage('review-normalized'),
      collaboration: 'author-review',
      participants: [
        { resource: ' ChatGPT ', role: 'author' },
        { resource: 'chatgpt', role: 'audit' },
      ],
    };

    expect(validateStage(stage).map((item) => item.code)).toContain('same-author-audit-session');
    expect(validateStage({
      ...stage,
      participants: [
        { resource: ' ChatGPT ', role: 'author' },
        { resource: ' CHATGPT ', role: 'audit', freshSession: false },
      ],
    }).map((item) => item.code)).toContain('same-author-audit-session');
    expect(validateStage({
      ...stage,
      participants: [
        { resource: ' ChatGPT ', role: 'author' },
        { resource: ' CHATGPT ', role: 'audit', freshSession: true },
      ],
    })).toEqual([]);
    expect(validateStage({
      ...stage,
      participants: [
        { resource: ' ChatGPT ', role: 'author' },
        { resource: ' Codex ', role: 'audit' },
      ],
    })).toEqual([]);
  });

  it('matches participant counts to collaboration modes and validates enum values', () => {
    expect(validateStage({ ...customStage('solo-empty'), participants: [] }).some((item) => item.code === 'invalid-participants')).toBe(true);
    const parallel = {
      ...customStage('parallel-one'),
      collaboration: 'parallel' as const,
    };
    expect(validateStage(parallel).some((item) => item.code === 'invalid-participants')).toBe(true);

    const invalidEnums = {
      ...customStage('invalid-enums'),
      collaboration: 'invalid',
      endCondition: 'invalid',
      onFail: 'invalid',
    } as unknown as StageDef;
    const codes = validateStage(invalidEnums).map((item) => item.code);
    expect(codes).toContain('invalid-collaboration');
    expect(codes).toContain('invalid-end-condition');
    expect(codes).toContain('invalid-on-fail');
  });

  it('validates discussion count and rework limits', () => {
    const stage = { ...customStage('discussion'), collaboration: 'discussion', participants: [{ resource: 'gpt', role: '讨论者' }] } as StageDef;
    expect(validateStage(stage).some((item) => item.code === 'invalid-participants')).toBe(true);
    expect(validateStage({ ...customStage('retry'), onFail: 'retry-n', reworkLimit: 11 }).some((item) => item.code === 'invalid-rework-limit')).toBe(true);
    expect(validateStage({ ...customStage('retry'), reworkLimit: 1.5 }).some((item) => item.code === 'invalid-rework-limit')).toBe(true);
  });

  it('checks unique IDs, missing stage references, and forbidden next', () => {
    const file = validFile();
    file.stages.push(customStage('stage.grill', 'id collision'));
    file.flows.push({
      ...customFlow('flow.bad', 'Bad', 'not-there'),
      stages: [{ stageId: 'not-there' }, { stageId: 'stage.plan', next: 'stage.ship' } as unknown as { stageId: string }],
    });
    file.flows.push(customFlow('flow.quick', 'Duplicate flow ID', 'stage.plan'));
    const issues = validateFile(file);
    expect(issues.some((item) => item.code === 'duplicate-id')).toBe(true);
    expect(issues.some((item) => item.code === 'unknown-stage')).toBe(true);
    expect(issues.some((item) => item.code === 'forbidden-next')).toBe(true);
  });

  it('validates overrides using the base stage collaboration rules', () => {
    const stage = {
      ...customStage('review'),
      collaboration: 'author-review' as const,
      participants: [
        { resource: 'chatgpt', role: 'author' },
        { resource: 'claude', role: 'audit' },
      ],
    };
    const flow: FlowDef = {
      id: 'flow.override',
      name: 'Override',
      stages: [{
        stageId: stage.id,
        overrides: {
          participants: [
            { resource: 'chatgpt', role: 'author' },
            { resource: 'chatgpt', role: 'audit' },
          ],
          reworkLimit: 0,
        },
      }],
      builtin: false,
    };
    const issues = validateFlow(flow, [stage]);
    expect(issues.some((item) => item.code === 'same-author-audit-session')).toBe(true);
    expect(issues.some((item) => item.code === 'invalid-rework-limit')).toBe(true);
  });

  it('parses each failure category and rejects unknown schema versions', () => {
    expect(parseFlowsFile('{')).toMatchObject({ ok: false, reason: 'not-json' });
    expect(parseFlowsFile('[]')).toMatchObject({ ok: false, reason: 'bad-shape' });
    expect(parseFlowsFile(JSON.stringify({ schemaVersion: 99, stages: [], flows: [] }))).toMatchObject({
      ok: false,
      reason: 'unknown-schema-version',
    });
    const invalid = validFile();
    invalid.flows[0].stages = [];
    expect(parseFlowsFile(JSON.stringify(invalid))).toMatchObject({ ok: false, reason: 'invalid' });
    expect(parseFlowsFile(JSON.stringify(validFile()))).toMatchObject({ ok: true });
  });

  it('resolves stage overrides without mutating the library item', () => {
    const stages = [customStage('custom')];
    const ref = { stageId: 'custom', overrides: { note: 'temporary', reworkLimit: 2 } };
    const resolved = resolveStage(ref, stages);
    expect(resolved).toMatchObject({ id: 'custom', note: 'temporary', reworkLimit: 2 });
    expect(stages[0].note).toBeUndefined();
    expect(resolveStage({ stageId: 'missing' }, stages)).toBeUndefined();
  });
});

describe('flow editing helpers', () => {
  it('duplicates stages and flows as editable copies with new IDs', () => {
    const stage = builtinStages()[0];
    const stageCopy = duplicateStage(stage, [stage]);
    expect(stageCopy).toMatchObject({ id: 'stage.grill-copy', name: '想需求 副本', builtin: false });
    const flow = builtinFlows()[0];
    const flowCopy = duplicateFlow(flow, [flow]);
    expect(flowCopy).toMatchObject({ id: 'flow.quick-copy', name: '快速开发 副本', builtin: false });
    expect(flowCopy.stages).not.toBe(flow.stages);
  });

  it('adds, moves, removes stage references immutably', () => {
    const flow = builtinFlows()[0];
    const added = addStageToFlow(flow, 'stage.grill', 1);
    expect(added.stages.map((ref) => ref.stageId)).toEqual(['stage.plan', 'stage.grill', 'stage.build', 'stage.ship']);
    expect(moveStageRef(added, 1, 3).stages.map((ref) => ref.stageId)).toEqual(['stage.plan', 'stage.build', 'stage.ship', 'stage.grill']);
    expect(removeStageRef(added, 1).stages.map((ref) => ref.stageId)).toEqual(['stage.plan', 'stage.build', 'stage.ship']);
    expect(flow.stages.map((ref) => ref.stageId)).toEqual(['stage.plan', 'stage.build', 'stage.ship']);
  });

  it('reports usage and protects built-in or referenced stages from deletion', () => {
    const file = validFile();
    file.stages.push(customStage('unused'));
    expect(stageUsage(file, 'stage.plan')).toContain('快速开发');
    expect(canDeleteStage(file, 'stage.plan')).toBe(false);
    expect(canDeleteStage(file, 'unused')).toBe(true);
    expect(canDeleteStage(file, 'missing')).toBe(false);
  });
});

describe('flow import/export', () => {
  it('exports one flow with only its dependent stages and a kind marker', () => {
    const file = validFile();
    const exported = buildExport(file, 'flow.quick');
    expect(exported).toMatchObject({ schemaVersion: 1, kind: 'flow', flows: [{ id: 'flow.quick' }] });
    expect(exported?.stages.map((stage) => stage.id)).toEqual(['stage.plan', 'stage.build', 'stage.ship']);
    expect(parseFlowsFile(JSON.stringify(exported))).toMatchObject({ ok: true });
    expect(buildExport(file, 'missing')).toBeNull();
  });

  it('plans conflicts by ID or name and keeps both with renamed IDs and references', () => {
    const current: FlowsFile = {
      schemaVersion: 1,
      stages: [customStage('existing', 'Shared')],
      flows: [customFlow('flow.existing', 'Shared flow', 'existing')],
    };
    const incoming: FlowsFile = {
      schemaVersion: 1,
      stages: [customStage('existing', 'Incoming'), customStage('new', 'Shared')],
      flows: [{ id: 'flow.existing', name: 'Imported flow', stages: [{ stageId: 'existing' }, { stageId: 'new' }], builtin: false }],
    };
    const plan = planImport(current, incoming);
    expect(plan.stages.conflicts).toHaveLength(2);
    expect(plan.flows.conflicts).toHaveLength(1);
    const merged = applyImport(current, incoming, 'keep-both');
    expect(merged.stages.some((stage) => stage.id === 'existing-import' && stage.name === 'Incoming (2)')).toBe(true);
    expect(merged.stages.some((stage) => stage.id === 'new-import' && stage.name === 'Shared (2)')).toBe(true);
    expect(merged.flows.some((flow) => flow.id === 'flow.existing-import' && flow.stages[0].stageId === 'existing-import')).toBe(true);
  });

  it('overwrites same-name custom items after an explicit choice and remaps stage references', () => {
    const current: FlowsFile = {
      schemaVersion: 1,
      stages: [{ ...customStage('stage-old', 'Shared stage'), description: 'old stage' }],
      flows: [{ ...customFlow('flow-old', 'Shared flow', 'stage-old'), description: 'old flow' }],
    };
    const incoming: FlowsFile = {
      schemaVersion: 1,
      stages: [{ ...customStage('stage-new', 'Shared stage'), description: 'incoming stage' }],
      flows: [{ ...customFlow('flow-new', 'Shared flow', 'stage-new'), description: 'incoming flow' }],
    };

    const merged = applyImport(current, incoming, 'overwrite');
    expect(merged.stages).toHaveLength(1);
    expect(merged.stages[0]).toMatchObject({ id: 'stage-old', description: 'incoming stage', builtin: false });
    expect(merged.flows).toHaveLength(1);
    expect(merged.flows[0]).toMatchObject({
      id: 'flow-old',
      description: 'incoming flow',
      stages: [{ stageId: 'stage-old' }],
      builtin: false,
    });
  });

  it('overwrites only non-built-in items with matching IDs and never replaces built-ins', () => {
    const current = validFile();
    current.stages.push(customStage('custom', 'Old custom'));
    current.flows.push(customFlow('flow.custom', 'Old custom flow', 'custom'));
    const incoming: FlowsFile = {
      schemaVersion: 1,
      stages: [
        { ...customStage('custom', 'Updated custom') },
        { ...builtinStages()[0], name: 'Tampered built-in' },
      ],
      flows: [
        { ...customFlow('flow.custom', 'Updated custom flow', 'custom') },
        { ...builtinFlows()[0], name: 'Tampered built-in flow' },
      ],
    };
    const merged = applyImport(current, incoming, 'overwrite');
    expect(merged.stages.find((stage) => stage.id === 'custom')?.name).toBe('Updated custom');
    expect(merged.flows.find((flow) => flow.id === 'flow.custom')?.name).toBe('Updated custom flow');
    expect(merged.stages.find((stage) => stage.id === 'stage.grill')?.name).toBe('想需求');
    expect(merged.flows.find((flow) => flow.id === 'flow.quick')?.name).toBe('快速开发');
  });

  it('reports cross-type ID conflicts and preserves both items even for overwrite', () => {
    const current: FlowsFile = {
      schemaVersion: 1,
      stages: [customStage('stage.shared', 'Existing stage')],
      flows: [customFlow('flow.current', 'Existing flow', 'stage.shared')],
    };
    const incoming: FlowsFile = {
      schemaVersion: 1,
      stages: [customStage('flow.current', 'Incoming stage')],
      flows: [customFlow('stage.shared', 'Incoming flow', 'flow.current')],
    };
    const plan = planImport(current, incoming);
    expect(plan.stages.crossTypeIdConflicts).toHaveLength(1);
    expect(plan.flows.crossTypeIdConflicts).toHaveLength(1);

    const merged = applyImport(current, incoming, 'overwrite');
    expect(merged.stages.some((stage) => stage.id === 'flow.current-import' && stage.name === 'Incoming stage (2)')).toBe(true);
    expect(merged.flows.some((flow) => flow.id === 'stage.shared-import' && flow.stages[0].stageId === 'flow.current-import')).toBe(true);
    expect(validateFile(merged)).toEqual([]);
  });

  it('overwrites a same-name custom conflict while preserving the local ID', () => {
    const current: FlowsFile = {
      schemaVersion: 1,
      stages: [customStage('original', 'Same name')],
      flows: [],
    };
    const incoming: FlowsFile = {
      schemaVersion: 1,
      stages: [{ ...customStage('different-id', 'Same name'), description: 'incoming definition' }],
      flows: [],
    };
    const merged = applyImport(current, incoming, 'overwrite');
    expect(merged.stages).toHaveLength(1);
    expect(merged.stages[0]).toMatchObject({ id: 'original', description: 'incoming definition', builtin: false });
  });

  it('keeps an imported stage as a renamed custom stage when only a different-ID built-in has the same name', () => {
    const current = validFile();
    const builtin = current.stages[0];
    const importedStage: StageDef = {
      ...customStage('stage.imported', builtin.name),
      participants: [{ resource: 'claude', role: 'worker' }],
      endCondition: 'audit-pass',
      onFail: 'escalate-to-user',
      note: 'preserve imported note',
    };
    const incoming: FlowsFile = {
      schemaVersion: FLOWS_SCHEMA_VERSION,
      stages: [importedStage],
      flows: [customFlow('flow.imported', 'Imported flow', importedStage.id)],
    };

    const merged = applyImport(current, incoming, 'overwrite');
    const preserved = merged.stages.find((stage) => stage.id === 'stage.imported-import');

    expect(preserved).toMatchObject({
      id: 'stage.imported-import',
      name: `${builtin.name} (2)`,
      builtin: false,
      participants: [{ resource: 'claude', role: 'worker' }],
      endCondition: 'audit-pass',
      onFail: 'escalate-to-user',
      note: 'preserve imported note',
    });
    expect(merged.stages.find((stage) => stage.id === builtin.id)).toEqual(builtin);
    expect(merged.flows.find((flow) => flow.id === 'flow.imported')?.stages).toEqual([
      { stageId: 'stage.imported-import' },
    ]);
    expect(validateFile(merged)).toEqual([]);
  });

  it('prefers a same-name custom stage over an earlier built-in match when overwriting', () => {
    const current = validFile();
    const builtin = current.stages[0];
    const existingCustom = {
      ...customStage('stage.custom-same-name', builtin.name),
      participants: [{ resource: 'old-resource', role: 'worker' }],
      note: 'old note',
    };
    current.stages.push(existingCustom);
    current.flows.push(customFlow('flow.local', 'Local flow', existingCustom.id));

    const importedStage: StageDef = {
      ...customStage('stage.imported', builtin.name),
      participants: [{ resource: 'claude', role: 'worker' }],
      endCondition: 'audit-pass',
      onFail: 'escalate-to-user',
      note: 'preserve imported note',
    };
    const incoming: FlowsFile = {
      schemaVersion: FLOWS_SCHEMA_VERSION,
      stages: [importedStage],
      flows: [customFlow('flow.imported', 'Imported flow', importedStage.id)],
    };

    const merged = applyImport(current, incoming, 'overwrite');

    expect(merged.stages.find((stage) => stage.id === builtin.id)).toEqual(builtin);
    expect(merged.stages.find((stage) => stage.id === existingCustom.id)).toMatchObject({
      id: existingCustom.id,
      name: builtin.name,
      builtin: false,
      participants: [{ resource: 'claude', role: 'worker' }],
      endCondition: 'audit-pass',
      onFail: 'escalate-to-user',
      note: 'preserve imported note',
    });
    expect(merged.flows.find((flow) => flow.id === 'flow.local')?.stages).toEqual([
      { stageId: existingCustom.id },
    ]);
    expect(merged.flows.find((flow) => flow.id === 'flow.imported')?.stages).toEqual([
      { stageId: existingCustom.id },
    ]);
    expect(merged.stages.some((stage) => stage.id === importedStage.id)).toBe(false);
    expect(validateFile(merged)).toEqual([]);
  });


  it('preserves an imported flow as a renamed custom flow when only a different-ID built-in has the same name', () => {
    const current = validFile();
    const builtinStage = current.stages[0];
    const builtinFlow = current.flows[0];
    const importedStage = customStage('stage.imported', builtinStage.name);
    const incoming: FlowsFile = {
      schemaVersion: FLOWS_SCHEMA_VERSION,
      stages: [importedStage],
      flows: [{
        ...customFlow('flow.imported', builtinFlow.name, importedStage.id),
        description: 'preserve imported flow',
      }],
    };

    const merged = applyImport(current, incoming, 'overwrite');
    const preserved = merged.flows.find((flow) => flow.id === 'flow.imported-import');

    expect(preserved).toMatchObject({
      id: 'flow.imported-import',
      name: `${builtinFlow.name} (2)`,
      builtin: false,
      description: 'preserve imported flow',
      stages: [{ stageId: 'stage.imported-import' }],
    });
    expect(merged.flows.find((flow) => flow.id === builtinFlow.id)).toEqual(builtinFlow);
    expect(merged.stages.find((stage) => stage.id === 'stage.imported-import')).toMatchObject({
      name: `${builtinStage.name} (2)`,
      builtin: false,
    });
    expect(validateFile(merged)).toEqual([]);
  });

  it('overwrites the same-name custom flow after a built-in match and keeps imported stage references', () => {
    const current = validFile();
    const builtinFlow = current.flows[0];
    current.stages.push(customStage('stage.local'));
    const existingCustom = {
      ...customFlow('flow.custom-same-name', builtinFlow.name, 'stage.local'),
      description: 'old flow',
    };
    current.flows.push(existingCustom);

    const importedStage = customStage('stage.imported', 'Imported stage');
    const incoming: FlowsFile = {
      schemaVersion: FLOWS_SCHEMA_VERSION,
      stages: [importedStage],
      flows: [{
        ...customFlow('flow.imported', builtinFlow.name, importedStage.id),
        description: 'incoming flow',
      }],
    };

    const merged = applyImport(current, incoming, 'overwrite');

    expect(merged.flows.find((flow) => flow.id === builtinFlow.id)).toEqual(builtinFlow);
    expect(merged.flows.find((flow) => flow.id === existingCustom.id)).toMatchObject({
      id: existingCustom.id,
      name: builtinFlow.name,
      builtin: false,
      description: 'incoming flow',
      stages: [{ stageId: importedStage.id }],
    });
    expect(merged.flows.some((flow) => flow.id === 'flow.imported')).toBe(false);
    expect(merged.stages.find((stage) => stage.id === importedStage.id)).toEqual(importedStage);
    expect(validateFile(merged)).toEqual([]);
  });

});
