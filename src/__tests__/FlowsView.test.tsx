// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('no tauri'))) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));

import type { LocalStoreFs, LocalStoreName, LocalStoreRead } from '../host/localStore';
import { builtinFlows } from '../stages/flowModel';
import { FlowsView } from '../workbench/views/FlowsView';

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

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});

afterEach(async () => {
  for (const item of mounted.splice(0)) await act(async () => item.root.unmount());
  document.body.innerHTML = '';
});

async function mount(fs = new MemoryFs()): Promise<{ container: HTMLElement; fs: MemoryFs }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(<FlowsView locale="en" fs={fs} />));
  return { container, fs };
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('nothing to click');
  await act(async () => (element as HTMLElement).click());
}

function buttonContaining(container: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(text));
}

describe('FlowsView', () => {
  it('renders built-in flows and switches the selected flow', async () => {
    const { container } = await mount();
    const builtins = builtinFlows();
    const firstName = builtins[0].nameEn ?? builtins[0].name;
    const secondName = builtins[1].nameEn ?? builtins[1].name;

    expect(container.querySelector('h1')?.textContent).toBe('Stages & flows');
    expect(container.textContent).toContain(firstName);
    expect(container.textContent).toContain('How it runs');

    await click(buttonContaining(container, secondName));
    expect(container.querySelector('#flows-current-title')?.textContent).toBe(secondName);
  });

  it('renders an empty custom flow and shows validation errors when saving it', async () => {
    const { container, fs } = await mount();
    const original = fs.files.get('flows');

    await click(buttonContaining(container, 'New flow'));
    expect(container.textContent).toContain('This flow has no stages yet.');

    await click([...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Save'));
    expect(container.textContent).toContain('A flow must contain at least one stage.');
    expect(container.textContent).toContain('Unsaved changes');
    expect(fs.files.get('flows')).toBe(original);
  });
});
