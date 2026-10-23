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

  it('disables controls and blocks saving while async load is in-flight, preventing race overwrite', async () => {
    let resolveRead: (value: { status: 'ok'; text: string; backup: null }) => void;
    const delayedReadPromise = new Promise<{ status: 'ok'; text: string; backup: null }>((resolve) => {
      resolveRead = resolve;
    });

    const writeSpy = vi.fn();
    const slowFs = {
      read: vi.fn().mockReturnValue(delayedReadPromise),
      write: writeSpy,
      quarantine: vi.fn().mockResolvedValue(null),
      exportFile: vi.fn().mockResolvedValue(null),
    };

    const { container } = await mount(<CoordinationSettingsView fs={slowFs} />);

    // In loading state: loading notice displayed and controls are disabled
    expect(container.textContent).toContain('正在加载本机设置...');
    const select = container.querySelector('#rework-limit-select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.disabled).toBe(true);

    const resetBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('恢复默认设置'),
    ) as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);

    // Attempting to change or reset while loading must be ignored and not trigger writes
    await act(async () => {
      select.value = '6';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      resetBtn.click();
    });
    expect(writeSpy).not.toHaveBeenCalled();

    // Now resolve the read with pre-existing settings (reworkLimit: 7)
    await act(async () => {
      resolveRead!({
        status: 'ok',
        text: JSON.stringify({
          schemaVersion: 1,
          reworkLimit: 7,
          onExceedLimit: 'ask_user',
          onQuotaTight: 'pause_and_notify',
          onAuthExpired: 'ask_user',
          aiPreferences: { gpt: '已加载偏好' },
        }),
        backup: null,
      });
      await new Promise((r) => setTimeout(r, 10));
    });

    // Loading notice gone, controls enabled with resolved settings, no overwrites
    expect(container.textContent).not.toContain('正在加载本机设置...');
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('7');
    expect(container.querySelector('[data-testid="brief-preview"]')?.textContent).toContain('- 返工上限：7 轮');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('catches read Promise rejection, displays error notice, and disables all controls', async () => {
    const writeSpy = vi.fn();
    const rejectingFs = {
      read: vi.fn().mockRejectedValue(new Error('EACCES: permission denied, read coordination.json')),
      write: writeSpy,
      quarantine: vi.fn().mockResolvedValue(null),
      exportFile: vi.fn().mockResolvedValue(null),
    };

    const { container } = await mount(<CoordinationSettingsView fs={rejectingFs} />);

    // Allow promise rejection to be caught
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Error notice and failure badge must be displayed
    expect(container.textContent).toContain(
      '加载本机设置失败：EACCES: permission denied, read coordination.json。为避免覆盖已有设置，当前已禁用保存。',
    );
    expect(container.textContent).toContain('加载失败');

    // 1. Select disabled
    const select = container.querySelector('#rework-limit-select') as HTMLSelectElement;
    expect(select.disabled).toBe(true);

    // 2. All AI preference inputs disabled
    const inputs = container.querySelectorAll('input[aria-label$="偏好标注"]');
    expect(inputs.length).toBeGreaterThan(0);
    inputs.forEach((input) => {
      expect((input as HTMLInputElement).disabled).toBe(true);
    });

    // 3. All SegmentedControl radio buttons disabled
    const radioButtons = container.querySelectorAll('button[role="radio"]');
    expect(radioButtons.length).toBeGreaterThan(0);
    radioButtons.forEach((btn) => {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });

    // 4. Reset button disabled
    const resetBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('恢复默认设置'),
    ) as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);

    // Any attempt to update via select, input, or reset must be blocked and write never called
    await act(async () => {
      select.value = '8';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      resetBtn.click();
    });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('catches quarantine Promise rejection when isolating corrupt file, displays error notice, and disables all controls', async () => {
    const writeSpy = vi.fn();
    const failingQuarantineFs = {
      read: vi.fn().mockResolvedValue({
        status: 'ok',
        text: '{ corrupt json content that fails schema and requires quarantine ...',
        backup: null,
      }),
      write: writeSpy,
      quarantine: vi.fn().mockRejectedValue(new Error('EPERM: cannot isolate corrupt file to .bak')),
      exportFile: vi.fn().mockResolvedValue(null),
    };

    const { container } = await mount(<CoordinationSettingsView fs={failingQuarantineFs} />);

    // Allow async loadCoordination and quarantine rejection to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Error notice and failure badge must be displayed
    expect(container.textContent).toContain(
      '加载本机设置失败：EPERM: cannot isolate corrupt file to .bak。为避免覆盖已有设置，当前已禁用保存。',
    );
    expect(container.textContent).toContain('加载失败');

    // 1. Select disabled
    const select = container.querySelector('#rework-limit-select') as HTMLSelectElement;
    expect(select.disabled).toBe(true);

    // 2. All AI preference inputs disabled
    const inputs = container.querySelectorAll('input[aria-label$="偏好标注"]');
    expect(inputs.length).toBeGreaterThan(0);
    inputs.forEach((input) => {
      expect((input as HTMLInputElement).disabled).toBe(true);
    });

    // 3. All SegmentedControl radio buttons disabled
    const radioButtons = container.querySelectorAll('button[role="radio"]');
    expect(radioButtons.length).toBeGreaterThan(0);
    radioButtons.forEach((btn) => {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });

    // 4. Reset button disabled
    const resetBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('恢复默认设置'),
    ) as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);

    // Attempting updates must be strictly blocked and write must never be called
    await act(async () => {
      select.value = '9';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      resetBtn.click();
    });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
