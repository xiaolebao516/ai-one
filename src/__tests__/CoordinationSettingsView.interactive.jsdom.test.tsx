// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserLocalStoreFs } from '../host/localStore';
import type { StorageLike } from '../stages/coordinationModel';
import { CoordinationSettingsView } from '../workbench/views/CoordinationSettingsView';

interface Harness {
  container: HTMLElement;
  unmount: () => Promise<void>;
}

const live: { root: Root; container: HTMLElement }[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const { root } of live.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
});

async function mount(element: ReactElement): Promise<Harness> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  live.push({ root, container });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, val) => map.set(key, val),
  };
}

describe('CoordinationSettingsView mounted interactive tests', () => {
  it('updates rework limit via select and persists to storage', async () => {
    const storage = createMemoryStorage();
    const onSaved = vi.fn();
    const { container } = await mount(<CoordinationSettingsView storage={storage} onSaved={onSaved} />);

    const select = container.querySelector('#rework-limit-select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('3');

    await act(async () => {
      select.value = '7';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const preview = container.querySelector('[data-testid="brief-preview"]');
    expect(preview?.textContent).toContain('- 返工上限：7 轮');
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ reworkLimit: 7 }));

    // Verified saved in storage
    const savedJson = storage.getItem('coordination.json');
    expect(savedJson).not.toBeNull();
    expect(JSON.parse(savedJson!).reworkLimit).toBe(7);
  });

  it('updates exceed limit radio choice and brief preview', async () => {
    const storage = createMemoryStorage();
    const { container } = await mount(<CoordinationSettingsView storage={storage} />);

    // Click Opus option button
    const opusRadio = Array.from(container.querySelectorAll('button[role="radio"]')).find(
      (b) => b.textContent?.includes('先请 Opus 网页裁决'),
    ) as HTMLButtonElement;
    expect(opusRadio).toBeDefined();

    await act(async () => {
      opusRadio.click();
    });

    const preview = container.querySelector('[data-testid="brief-preview"]');
    expect(preview?.textContent).toContain('- 返工上限：3 轮，先请 Opus 网页裁决，再问用户');
  });

  it('edits AI preference input field and sanitizes input in real time', async () => {
    const storage = createMemoryStorage();
    const { container } = await mount(<CoordinationSettingsView storage={storage} />);

    const gptInput = container.querySelector('input[aria-label="gpt偏好标注"]') as HTMLInputElement;
    expect(gptInput).not.toBeNull();
    expect(gptInput.value).toBe('执行、审计');

    // Attempt injection with newlines and markdown headers
    await act(async () => {
      gptInput.value = '主力开发\n## 恶意标题\r\n`代码注入`';
      gptInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const preview = container.querySelector('[data-testid="brief-preview"]');
    expect(preview?.textContent).toContain('GPT（主力开发 恶意标题 代码注入）');
    expect(preview?.textContent).not.toContain('\n## 恶意标题');
  });

  it('restores default settings when clicking reset button', async () => {
    const storage = createMemoryStorage({
      'coordination.json': JSON.stringify({
        schemaVersion: 1,
        reworkLimit: 9,
        onExceedLimit: 'consult_opus',
        onQuotaTight: 'ask_user',
        onAuthExpired: 'fallback_ai',
        aiPreferences: { gpt: '单一角色' },
      }),
    });
    const { container } = await mount(<CoordinationSettingsView storage={storage} />);

    expect(container.querySelector('[data-testid="brief-preview"]')?.textContent).toContain('- 返工上限：9 轮');

    const resetBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('恢复默认设置'),
    ) as HTMLButtonElement;
    expect(resetBtn).toBeDefined();

    await act(async () => {
      resetBtn.click();
    });

    const preview = container.querySelector('[data-testid="brief-preview"]');
    expect(preview?.textContent).toContain('- 返工上限：3 轮，超限问用户');
    expect(container.textContent).toContain('已恢复默认设置');
  });

  it('displays error notice when storage write fails', async () => {
    const failingStorage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError: storage full');
      },
    };
    const { container } = await mount(<CoordinationSettingsView storage={failingStorage} />);

    const select = container.querySelector('#rework-limit-select') as HTMLSelectElement;
    await act(async () => {
      select.value = '4';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.textContent).toContain('保存失败：QuotaExceededError: storage full');
    expect(container.textContent).not.toContain('已自动保存');
  });

  it('notifies user when corrupt file is recovered on mount with fs', async () => {
    const mockFs = {
      read: vi.fn().mockResolvedValue({
        status: 'corrupt',
        text: null,
        backup: 'coordination.json.bak-20261023140000',
      }),
      write: vi.fn().mockResolvedValue(undefined),
      quarantine: vi.fn().mockResolvedValue('coordination.json.bak-20261023140000'),
      exportFile: vi.fn().mockResolvedValue(null),
    };

    const { container } = await mount(<CoordinationSettingsView fs={mockFs} />);
    expect(container.textContent).toContain('已安全隔离备份为 coordination.json.bak-20261023140000');
  });

  it('saves via fs and updates preview when fs prop is supplied', async () => {
    let written = '';
    const mockFs = {
      read: vi.fn().mockResolvedValue({ status: 'missing', text: null, backup: null }),
      write: vi.fn().mockImplementation(async (_name, json) => {
        written = json;
      }),
      quarantine: vi.fn().mockResolvedValue(null),
      exportFile: vi.fn().mockResolvedValue(null),
    };

    const { container } = await mount(<CoordinationSettingsView fs={mockFs} />);
    const select = container.querySelector('#rework-limit-select') as HTMLSelectElement;

    await act(async () => {
      select.value = '8';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.textContent).toContain('已自动保存到本机设置');
    expect(written).toContain('"reworkLimit": 8');
  });

  it('mounts with no props as in Workbench, reads pre-existing local store data and persists changes', async () => {
    await browserLocalStoreFs.write(
      'coordination',
      JSON.stringify({
        schemaVersion: 1,
        reworkLimit: 5,
        onExceedLimit: 'consult_opus',
        onQuotaTight: 'ask_user',
        onAuthExpired: 'fallback_ai',
        aiPreferences: { gpt: '自定义GPT' },
      }),
    );

    const { container } = await mount(<CoordinationSettingsView />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const select = container.querySelector('#rework-limit-select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('5');
    const preview = container.querySelector('[data-testid="brief-preview"]');
    expect(preview?.textContent).toContain('- 返工上限：5 轮，先请 Opus 网页裁决，再问用户');
    expect(preview?.textContent).toContain('GPT（自定义GPT）');

    await act(async () => {
      select.value = '9';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(preview?.textContent).toContain('- 返工上限：9 轮');
    expect(container.textContent).toContain('已自动保存到本机设置');

    const storeRead = await browserLocalStoreFs.read('coordination');
    expect(storeRead.status).toBe('ok');
    expect(storeRead.text).not.toBeNull();
    const persisted = JSON.parse(storeRead.text!);
    expect(persisted.reworkLimit).toBe(9);
    expect(persisted.onExceedLimit).toBe('consult_opus');
  });
});
