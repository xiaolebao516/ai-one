import { describe, expect, it } from 'vitest';
import { applyImport, builtinFlows, builtinStages, parseFlowsFile, planImport, type FlowDef, type FlowsFile, type StageDef } from '../stages/flowModel';
import { loadFlows, saveFlows } from '../stages/flowStore';
import type { LocalStoreFs, LocalStoreRead } from '../host/localStore';

class MemoryFs implements LocalStoreFs {
  readonly files = new Map<string, string>();
  readonly backups: string[] = [];
  readonly writes: Array<{ name: string; json: string }> = [];
  quarantineResult: string | null = 'flows.json.bak-20261023T031500Z';
  readResult?: LocalStoreRead;

  async read(name: 'flows' | 'coordination' | 'localTasks'): Promise<LocalStoreRead> {
    if (this.readResult) return this.readResult;
    const text = this.files.get(name);
    return text === undefined
      ? { status: 'missing', text: null, backup: null }
      : { status: 'ok', text, backup: null };
  }

  async write(name: 'flows' | 'coordination' | 'localTasks', json: string): Promise<void> {
    this.writes.push({ name, json });
    this.files.set(name, json);
  }

  async quarantine(name: 'flows' | 'coordination' | 'localTasks'): Promise<string | null> {
    const text = this.files.get(name);
    if (text !== undefined) this.backups.push(text);
    this.files.delete(name);
    return this.quarantineResult;
  }

  async exportFile(): Promise<string | null> {
    return null;
  }
}

function validFile(): FlowsFile {
  return { schemaVersion: 1, stages: builtinStages(), flows: builtinFlows() };
}

describe('flow store recovery', () => {
  it('creates built-ins on first launch', async () => {
    const fs = new MemoryFs();
    const result = await loadFlows(fs);
    expect(result.status).toBe('fresh');
    expect(result.file.stages).toHaveLength(5);
    expect(result.file.flows).toHaveLength(3);
    expect(fs.writes).toHaveLength(1);
  });

  it('loads a valid file and repairs missing or modified built-ins', async () => {
    const fs = new MemoryFs();
    const file = validFile();
    file.stages = file.stages.filter((stage) => stage.id !== 'stage.grill');
    file.flows = file.flows.filter((flow) => !flow.stages.some((ref) => ref.stageId === 'stage.grill'));
    file.flows[0].name = 'Tampered';
    fs.files.set('flows', JSON.stringify(file));
    const result = await loadFlows(fs);
    expect(result.status).toBe('ok');
    expect(result.file.stages.find((stage) => stage.id === 'stage.grill')?.builtin).toBe(true);
    expect(result.file.flows.find((flow) => flow.id === 'flow.quick')?.name).toBe('快速开发');
    expect(fs.writes).toHaveLength(1);
  });

  it('recovers a backend-corrupt file and reports its backup', async () => {
    const fs = new MemoryFs();
    fs.readResult = { status: 'corrupt', text: null, backup: 'flows.json.bak-20261023T031500Z' };
    const result = await loadFlows(fs);
    expect(result).toMatchObject({ status: 'recovered', backup: 'flows.json.bak-20261023T031500Z', reason: 'corrupt-file' });
  });

  it('quarantines valid JSON with the wrong shape', async () => {
    const fs = new MemoryFs();
    fs.files.set('flows', JSON.stringify({ schemaVersion: 1, stages: 'wrong', flows: [] }));
    const result = await loadFlows(fs);
    expect(result).toMatchObject({ status: 'recovered', reason: 'bad-shape', backup: 'flows.json.bak-20261023T031500Z' });
    expect(fs.backups).toHaveLength(1);
  });

  it('quarantines unknown schema versions and exposes the reason', async () => {
    const fs = new MemoryFs();
    fs.files.set('flows', JSON.stringify({ schemaVersion: 2, stages: [], flows: [] }));
    const result = await loadFlows(fs);
    expect(result).toMatchObject({ status: 'recovered', reason: 'unknown-schema-version' });
  });

  it('does not write an invalid file', async () => {
    const fs = new MemoryFs();
    const file = validFile();
    file.flows[0].stages = [];
    const issues = await saveFlows(fs, file);
    expect(issues.length).toBeGreaterThan(0);
    expect(fs.writes).toHaveLength(0);
  });

  it('writes a valid file', async () => {
    const fs = new MemoryFs();
    const issues = await saveFlows(fs, validFile());
    expect(issues).toEqual([]);
    expect(fs.writes).toHaveLength(1);
  });
  it('preserves custom stage and flow definitions that collide with built-in IDs through save and reload', async () => {
    const fs = new MemoryFs();
    const local = validFile();
    // Existing -import IDs force the importer to find a genuinely unique suffix.
    local.stages.push({ ...builtinStages()[0], id: 'stage.grill-import', name: 'Previous stage copy', builtin: false });
    local.flows.push({ ...builtinFlows()[0], id: 'flow.quick-import', name: 'Previous flow copy', builtin: false });

    const importedStage: StageDef = {
      ...builtinStages()[0],
      builtin: false,
      description: 'My own imported stage',
      participants: [
        { resource: 'claude', role: '讨论者', model: 'Opus', effort: 'max' },
        { resource: 'gemini', role: '讨论者', freshSession: true },
      ],
      endCondition: 'audit-pass',
      onFail: 'escalate-to-user',
      note: 'Keep this custom note',
    };
    const importedFlow: FlowDef = {
      ...builtinFlows()[0],
      builtin: false,
      description: 'My own imported flow',
      stages: [
        { stageId: importedStage.id },
        { stageId: importedStage.id, overrides: { note: 'Per-flow note' } },
      ],
    };
    const otherFlow: FlowDef = {
      id: 'flow.second-custom',
      name: 'Second imported flow',
      builtin: false,
      stages: [{ stageId: importedStage.id }],
    };
    const parsed = parseFlowsFile(JSON.stringify({
      schemaVersion: 1,
      stages: [importedStage],
      flows: [importedFlow, otherFlow],
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Import fixture must be valid JSON and a valid flows schema');

    const plan = planImport(local, parsed.file);
    expect(plan.stages.conflicts).toHaveLength(1);
    expect(plan.flows.conflicts).toHaveLength(1);
    expect(plan.stages.conflicts[0].reason).toBe('id-and-name');
    expect(plan.flows.conflicts[0].reason).toBe('id-and-name');

    const merged = applyImport(local, parsed.file, 'overwrite');
    const stageId = 'stage.grill-import-2';
    const flowId = 'flow.quick-import-2';
    const savedStage = { ...importedStage, id: stageId, name: importedStage.name + ' (2)' };
    const savedFlow = {
      ...importedFlow,
      id: flowId,
      name: importedFlow.name + ' (2)',
      stages: [
        { stageId },
        { stageId, overrides: { note: 'Per-flow note' } },
      ],
    };
    expect(merged.stages.find((stage) => stage.id === stageId)).toEqual(savedStage);
    expect(merged.flows.find((flow) => flow.id === flowId)).toEqual(savedFlow);
    expect(merged.flows.find((flow) => flow.id === otherFlow.id)?.stages).toEqual([{ stageId }]);
    for (const builtin of builtinStages()) {
      expect(merged.stages.find((stage) => stage.id === builtin.id)).toEqual(builtin);
    }
    for (const builtin of builtinFlows()) {
      expect(merged.flows.find((flow) => flow.id === builtin.id)).toEqual(builtin);
    }

    expect(await saveFlows(fs, merged)).toEqual([]);
    expect(fs.files.has('flows')).toBe(true);
    const reloaded = await loadFlows(fs);
    expect(reloaded.status).toBe('ok');
    expect(reloaded.file.stages.find((stage) => stage.id === stageId)).toEqual(savedStage);
    expect(reloaded.file.flows.find((flow) => flow.id === flowId)).toEqual(savedFlow);
    expect(reloaded.file.flows.find((flow) => flow.id === otherFlow.id)?.stages).toEqual([{ stageId }]);
    for (const builtin of builtinStages()) {
      expect(reloaded.file.stages.find((stage) => stage.id === builtin.id)).toEqual(builtin);
    }
    for (const builtin of builtinFlows()) {
      expect(reloaded.file.flows.find((flow) => flow.id === builtin.id)).toEqual(builtin);
    }
  });

  it('does not rename unique custom names on built-in ID collisions and still skips actual imported built-ins', () => {
    const local = validFile();
    const importedStage: StageDef = { ...builtinStages()[0], name: 'Custom one', builtin: false };
    const importedFlow: FlowDef = {
      ...builtinFlows()[0],
      name: 'Custom flow one',
      builtin: false,
      stages: [{ stageId: importedStage.id }],
    };
    const parsed = parseFlowsFile(JSON.stringify({
      schemaVersion: 1,
      stages: [importedStage],
      flows: [importedFlow],
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Unique-name fixture must validate');
    const merged = applyImport(local, parsed.file, 'overwrite');
    expect(merged.stages.find((stage) => stage.id === 'stage.grill-import')).toMatchObject({
      name: 'Custom one', builtin: false,
    });
    expect(merged.flows.find((flow) => flow.id === 'flow.quick-import')).toMatchObject({
      name: 'Custom flow one', builtin: false, stages: [{ stageId: 'stage.grill-import' }],
    });

    const builtinOnly = parseFlowsFile(JSON.stringify(validFile()));
    expect(builtinOnly.ok).toBe(true);
    if (!builtinOnly.ok) throw new Error('Built-in fixture must validate');
    expect(applyImport(local, builtinOnly.file, 'overwrite')).toEqual(local);
  });

});
