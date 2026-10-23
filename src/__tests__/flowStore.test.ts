import { describe, expect, it } from 'vitest';
import { builtinFlows, builtinStages, type FlowsFile } from '../stages/flowModel';
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
});
