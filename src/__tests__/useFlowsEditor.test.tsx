// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('no tauri'))) }));

import type { LocalStoreFs, LocalStoreName, LocalStoreRead } from '../host/localStore';
import { loadFlows } from '../stages/flowStore';
import { useFlowsEditor, type FlowsEditorController } from '../stages/useFlowsEditor';

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

let current: FlowsEditorController | undefined;
const mounted: Array<{ root: Root; container: HTMLElement }> = [];

function Harness({ fs }: { fs: LocalStoreFs }) {
  current = useFlowsEditor('en', fs);
  return <output>{current.selectedFlow?.name ?? 'none'}:{current.selectedFlow?.stages.length ?? 0}</output>;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  current = undefined;
});

afterEach(async () => {
  for (const item of mounted.splice(0)) await act(async () => item.root.unmount());
  document.body.innerHTML = '';
});

async function mount(fs: LocalStoreFs): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(<Harness fs={fs} />));
}

describe('useFlowsEditor actions', () => {
  it('global leave saves the current flow edit without executing a queued create-flow', async () => {
    const fs = new MemoryFs();
    await mount(fs);
    await act(async () => current!.copyFlow());
    let saved = false;
    await act(async () => { saved = await current!.saveCurrent(); });
    expect(saved).toBe(true);
    const count = current!.file!.flows.length;
    const editedFlowId = current!.selectedFlowId;
    await act(async () => current!.changeFlowName('Edited before leaving'));
    await act(async () => current!.createFlow());
    expect(current!.pendingAction).toBe(true);
    await act(async () => { saved = await current!.saveForLeave(); });
    expect(saved).toBe(true);
    expect(current!.pendingAction).toBe(false);
    expect(current!.file!.flows).toHaveLength(count);
    const reloaded = await loadFlows(fs);
    expect(reloaded.file.flows).toHaveLength(count);
    expect(reloaded.file.flows.find((f) => f.id === editedFlowId)?.nameEn).toBe('Edited before leaving');
  });

  it('global leave stays blocked on unresolved stage scope and on failed writes', async () => {
    const fs = new MemoryFs();
    await mount(fs);
    await act(async () => current!.copyFlow());
    const flowId = current!.selectedFlowId;
    await act(async () => current!.createStage());
    const stageId = current!.selection?.kind === 'library' ? current.selection.stageId : '';
    await act(async () => current!.selectFlow(flowId));
    await act(async () => {
      current!.openInsert(current!.selectedFlow!.stages.length);
      current!.selectAddStage(stageId);
    });
    await act(async () => current!.addSelectedStage());
    let saved = false;
    await act(async () => { saved = await current!.saveCurrent(); });
    expect(saved).toBe(true);
    await act(async () => current!.copyFlow());
    await act(async () => { saved = await current!.saveCurrent(); });
    expect(saved).toBe(true);
    await act(async () => current!.selectFlowStage(current!.selectedFlow!.stages.length - 1));
    const draft = current!.draft!;
    expect(draft.id).toBe(stageId);
    await act(async () => current!.changeStageDraft({ ...draft, note: 'Needs scope choice' }));
    await act(async () => { saved = await current!.saveForLeave(); });
    expect(saved).toBe(false);
    expect(current!.scopePrompt).toBe(true);
    expect((await loadFlows(fs)).file.stages.find((stage) => stage.id === stageId)?.note).not.toBe('Needs scope choice');

    await act(async () => { current!.chooseScope('flow'); });
    await act(async () => current!.changeFlowName('Failed disk write'));
    const onDisk = fs.files.get('flows');
    vi.spyOn(fs, 'write').mockRejectedValueOnce(new Error('disk full'));
    await act(async () => { saved = await current!.saveForLeave(); });
    expect(saved).toBe(false);
    expect(current!.operationError).toContain('disk full');
    expect(fs.files.get('flows')).toBe(onDisk);
    expect(current!.hasUnsaved).toBe(true);
  });

  it('creates a flow, adds two stages, moves them, saves and reloads the result', async () => {
    const fs = new MemoryFs();
    await mount(fs);

    await act(async () => current?.createFlow());
    const flowId = current?.selectedFlow?.id;
    expect(flowId).toBeTruthy();
    expect(current?.selectedFlow?.stages).toHaveLength(0);

    await act(async () => current?.createStage());
    const firstStageId = current?.selection?.kind === 'library' ? current.selection.stageId : undefined;
    expect(firstStageId).toBeTruthy();

    await act(async () => {
      current?.openInsert(0);
      if (firstStageId) current?.selectAddStage(firstStageId);
    });
    await act(async () => current?.addSelectedStage());
    expect(current?.selectedFlow?.stages).toHaveLength(1);

    await act(async () => current?.createStage());
    const secondStageId = current?.selection?.kind === 'library' ? current.selection.stageId : undefined;
    expect(secondStageId).toBeTruthy();

    await act(async () => {
      current?.openInsert(1);
      if (secondStageId) current?.selectAddStage(secondStageId);
    });
    await act(async () => current?.addSelectedStage());
    expect(current?.selectedFlow?.stages).toHaveLength(2);

    await act(async () => current?.moveFlowStage(0, 1));
    let saved = false;
    await act(async () => { saved = await current!.saveCurrent(); });
    expect(saved).toBe(true);
    expect(current?.dirty).toBe(false);

    const reloaded = await loadFlows(fs);
    const persisted = reloaded.file.flows.find((flow) => flow.id === flowId);
    expect(persisted?.stages.map((ref) => ref.stageId)).toEqual([secondStageId, firstStageId]);
  });
});
