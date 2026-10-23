// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('no tauri'))), isTauri: () => false }));

import type { LocalStoreFs } from '../host/localStore';
import { builtinStages, type FlowsFile, type StageDef } from '../stages/flowModel';
import { FlowFileMenu } from '../stages/flows/FlowFileMenu';
import { flowsText } from '../workbench/views/flowsText';

const payloads = new WeakMap<Blob, string>();

class ImmediateFileReader {
  result: string | ArrayBuffer | null = null;
  onload: FileReader['onload'] = null;
  onerror: FileReader['onerror'] = null;

  readAsText(blob: Blob) {
    this.result = payloads.get(blob) ?? '';
    this.onload?.call(this as unknown as FileReader, new ProgressEvent('load') as ProgressEvent<FileReader>);
  }
}

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  vi.stubGlobal('FileReader', ImmediateFileReader);
});

afterEach(async () => {
  for (const item of mounted.splice(0)) await act(async () => item.root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function customStage(id: string, name: string): StageDef {
  return {
    id,
    name,
    collaboration: 'solo',
    participants: [{ resource: 'codex', role: 'worker' }],
    endCondition: 'user-confirms',
    onFail: 'stop-and-ask',
    builtin: false,
  };
}

function file(stages: StageDef[] = []): FlowsFile {
  return { schemaVersion: 1, stages, flows: [] };
}

const fs: LocalStoreFs = {
  read: async () => ({ status: 'missing', text: null, backup: null }),
  write: async () => {},
  quarantine: async () => null,
  exportFile: async () => null,
};

function mountMenu(current: FlowsFile, onImport: (incoming: FlowsFile, resolution: 'keep-both' | 'overwrite') => void) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const render = (next: FlowsFile) => root.render(
    <FlowFileMenu file={next} flowId="flow.current" text={flowsText('en')} fs={fs} onImport={onImport} />,
  );
  return { container, root, render };
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('nothing to click');
  await act(async () => (element as HTMLElement).click());
}

function buttonByText(container: ParentNode, text: string) {
  return [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === text);
}

describe('FlowFileMenu import preview', () => {
  it('refreshes a stale conflict plan and requires a fresh choice before applying', async () => {
    const onImport = vi.fn();
    const initial = file();
    const incoming = file([customStage('stage.incoming', 'Shared stage')]);
    const { container, render } = mountMenu(initial, onImport);
    await act(async () => render(initial));

    await click([...container.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'More flow actions'));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const upload = new File(['incoming'], 'incoming.json', { type: 'application/json' });
    payloads.set(upload, JSON.stringify(incoming));
    Object.defineProperty(input, 'files', { configurable: true, value: [upload] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));

    expect(container.textContent).toContain('No conflicts were found');
    const currentWithConflict = file([customStage('stage.current', 'Shared stage')]);
    await act(async () => render(currentWithConflict));
    await click(buttonByText(container, 'Apply import choice'));

    expect(onImport).not.toHaveBeenCalled();
    expect(container.textContent).toContain('The flow changed since this preview');
    expect(container.textContent).toContain('Conflicts: 1 stages and 0 flows');
    const overwrite = container.querySelector('input[type="radio"][value="overwrite"]') as HTMLInputElement;
    expect(overwrite.checked).toBe(false);
    expect(buttonByText(container, 'Apply import choice')?.disabled).toBe(true);

    await click(overwrite);
    await click(buttonByText(container, 'Apply import choice'));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledWith(incoming, 'overwrite');
  });
});
