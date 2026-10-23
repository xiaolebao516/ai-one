// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('no tauri'))) }));

import type { LocalStoreFs, LocalStoreName, LocalStoreRead } from '../host/localStore';
import { addStageToFlow, builtinFlows, builtinStages, moveStageRef, type FlowDef, type FlowsFile, type StageDef } from '../stages/flowModel';
import { loadFlows } from '../stages/flowStore';
import { useFlows, type UseFlowsResult } from '../stages/useFlows';

class MemoryFs implements LocalStoreFs {
  readonly files = new Map<LocalStoreName, string>();

  async read(name: LocalStoreName): Promise<LocalStoreRead> {
    const content = this.files.get(name);
    return content === undefined
      ? { status: 'missing', text: null, backup: null }
      : { status: 'ok', text: content, backup: null };
  }

  async write(name: LocalStoreName, json: string): Promise<void> {
    this.files.set(name, json);
  }

  async quarantine(name: LocalStoreName): Promise<string | null> {
    const previous = this.files.get(name);
    this.files.delete(name);
    return previous ? name + '.bak-test' : null;
  }

  async exportFile(): Promise<string | null> {
    return null;
  }
}

const mounted: Array<{ root: Root; container: HTMLElement }> = [];
let current: UseFlowsResult | undefined;

function Harness({ fs }: { fs: LocalStoreFs }) {
  current = useFlows(fs);
  return <output>{current.file?.flows.length ?? 0}</output>;
}

function customStage(id: string, name: string): StageDef {
  return {
    id,
    name,
    collaboration: 'solo',
    participants: [{ resource: 'chatgpt', role: 'Executor' }],
    endCondition: 'user-confirms',
    onFail: 'stop-and-ask',
    builtin: false,
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  current = undefined;
  window.localStorage.clear();
});

afterEach(async () => {
  for (const item of mounted.splice(0)) await act(async () => item.root.unmount());
  document.body.innerHTML = '';
});

async function mount(fs: LocalStoreFs): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(<Harness fs={fs} />));
  return container;
}

describe('useFlows local persistence', () => {
  it('creates a flow, adds stages, moves them, saves and reloads the same order', async () => {
    const fs = new MemoryFs();
    await mount(fs);
    expect(current?.file?.flows).toHaveLength(3);

    const flow: FlowDef = { id: 'flow.test', name: 'Test flow', stages: [], builtin: false };
    const first = customStage('stage.test.first', 'First');
    const second = customStage('stage.test.second', 'Second');

    await act(async () => {
      current?.updateFile((file) => ({ ...file, flows: [...file.flows, flow] }));
    });
    await act(async () => {
      current?.updateFile((file) => ({ ...file, stages: [...file.stages, first] }));
      const loaded = current?.file;
      if (!loaded) throw new Error('flow file was not loaded');
      const target = loaded.flows.find((item) => item.id === flow.id);
      if (!target) throw new Error('new flow was not created');
      const added = addStageToFlow(target, first.id);
      current?.updateFile((file) => ({ ...file, flows: file.flows.map((item) => item.id === flow.id ? added : item) }));
    });
    await act(async () => {
      current?.updateFile((file) => ({ ...file, stages: [...file.stages, second] }));
      const loaded = current?.file;
      if (!loaded) throw new Error('flow file was not loaded');
      const target = loaded.flows.find((item) => item.id === flow.id);
      if (!target) throw new Error('new flow was not created');
      const added = addStageToFlow(target, second.id);
      const moved = moveStageRef(added, 0, 1);
      current?.updateFile((file) => ({ ...file, flows: file.flows.map((item) => item.id === flow.id ? moved : item) }));
    });

    let saved = false;
    await act(async () => { saved = await current!.save(); });
    expect(saved).toBe(true);

    const reloaded = await loadFlows(fs);
    const persisted = reloaded.file.flows.find((item) => item.id === flow.id);
    expect(persisted?.stages.map((ref) => ref.stageId)).toEqual([second.id, first.id]);
    expect(reloaded.file.stages.filter((stage) => stage.id.startsWith('stage.test.'))).toHaveLength(2);
  });

  it('does not write when validation fails', async () => {
    const fs = new MemoryFs();
    await mount(fs);
    const before = fs.files.get('flows');
    const empty: FlowDef = { id: 'flow.empty', name: 'Empty flow', stages: [], builtin: false };
    await act(async () => {
      current?.updateFile((file: FlowsFile) => ({ ...file, flows: [...file.flows, empty] }));
    });
    let saved = true;
    await act(async () => { saved = await current!.save(); });
    expect(saved).toBe(false);
    expect(fs.files.get('flows')).toBe(before);
    expect(current?.issues.some((issue) => issue.code === 'empty-flow')).toBe(true);
  });

  it('keeps built-ins present after a fresh load', async () => {
    const fs = new MemoryFs();
    const loaded = await loadFlows(fs);
    expect(loaded.file.stages.map((stage) => stage.id)).toEqual(builtinStages().map((stage) => stage.id));
    expect(loaded.file.flows.map((flow) => flow.id)).toEqual(builtinFlows().map((flow) => flow.id));
  });
});
