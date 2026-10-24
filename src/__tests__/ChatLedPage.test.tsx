// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderInstance } from '../../shared/types';
import type { ChatLedEnv } from '../workflow/chatLed/controller';
import type { ChatLedRun } from '../workflow/chatLed/types';
import { CHAT_LED_STORAGE_KEY } from '../workflow/chatLed/store';
import { ChatLedPage } from '../workbench/views/ChatLedPage';

const mocks = vi.hoisted(() => ({
  provider: {
    eval: vi.fn(async () => ''),
    evalWithCallback: vi.fn(async () => ''),
    park: vi.fn(async () => undefined),
    show: vi.fn(async () => undefined),
  },
  createRealChatLedEnv: vi.fn(),
  prepareProviderPage: vi.fn(async (_instance: string) => undefined),
  claudeCleaner: {
    provider: 'claude',
    supports: { delete: false, archive: false },
    matchesConversationUrl: vi.fn((url: string) => /^https:\/\/claude\.ai\/chat\//.test(url)),
    deleteConversation: vi.fn(async () => ({ ok: true })),
    archiveConversation: vi.fn(async () => ({ ok: true })),
    confirmGone: vi.fn(async () => true),
    confirmArchived: vi.fn(async () => true),
  },
  cleaner: {
    provider: 'chatgpt',
    supports: { delete: true, archive: true },
    matchesConversationUrl: vi.fn((url: string) => url.startsWith('https://chatgpt.com/c/')),
    deleteConversation: vi.fn(async (_url: string) => ({ ok: true, note: 'confirmed' })),
    archiveConversation: vi.fn(async (_url: string) => ({ ok: true, note: 'confirmed' })),
    confirmGone: vi.fn(async (_url: string) => true),
    confirmArchived: vi.fn(async (_url: string) => true),
  },
}));

vi.mock('../host', () => ({ host: { provider: mocks.provider } }));
vi.mock('../workflow/chatLed/env', () => ({
  createRealChatLedEnv: mocks.createRealChatLedEnv,
  prepareProviderPage: mocks.prepareProviderPage,
}));
vi.mock('../workflow/chatLed/drivers/chatgpt', () => ({
  createChatGptCleaner: () => mocks.cleaner,
}));
vi.mock('../workflow/chatLed/drivers/claude', () => ({
  createClaudeCleaner: () => mocks.claudeCleaner,
}));

const FIRST_URL = 'https://chatgpt.com/c/123e4567-e89b-42d3-a456-426614174000';
const SECOND_URL = 'https://chatgpt.com/c/123e4567-e89b-42d3-a456-426614174001';
const roots: { root: Root; container: HTMLElement }[] = [];

function makeRun(): ChatLedRun {
  return {
    id: 'run-1',
    goal: 'cleanup persistence regression',
    coordinator: 'chatgpt',
    available: ['claude'],
    roundLimit: 8,
    round: 1,
    phase: 'finished',
    forwards: [],
    conversations: [
      { provider: 'chatgpt', url: FIRST_URL, title: 'First', createdByAiOne: true, registrationStatus: 'confirmed', registeredAt: 1 },
      { provider: 'chatgpt', url: SECOND_URL, title: 'Second', createdByAiOne: true, registrationStatus: 'confirmed', registeredAt: 2 },
    ],
    sessionInitializations: [],
    coordinatorReplies: [],
    createdAt: 1,
    updatedAt: 2,
    exportedAt: 3,
  };
}

function makeEnv(): ChatLedEnv {
  return {
    now: () => Date.now(),
    sendableProviders: vi.fn(async (): Promise<ProviderInstance[]> => ['chatgpt', 'claude']),
    prepare: vi.fn(async () => undefined),
    newSession: vi.fn(async (provider: ProviderInstance) => ({ url: 'https://example.test/' + provider + '/c/new' })),
    send: vi.fn(async (): Promise<string> => 'unused'),
    stop: vi.fn(async () => undefined),
    readConversationUrl: vi.fn(async (provider: ProviderInstance): Promise<string> => 'https://example.test/' + provider + '/c/existing'),
  };
}

async function renderPage(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  await act(async () => {
    root.render(<ChatLedPage locale="en" />);
  });
  return container;
}

async function clickButton(container: ParentNode, label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error('Could not find button: ' + label);
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function clickCleanupAndWait(container: ParentNode): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === 'Clean up',
  );
  if (!button) throw new Error('Could not find cleanup button');
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 2_800));
  });
}

async function enterGoal(container: HTMLElement, value: string): Promise<void> {
  const textarea = container.querySelector('#chatled-goal') as HTMLTextAreaElement | null;
  if (!textarea) throw new Error('Could not find goal input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  await act(async () => {
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  vi.clearAllMocks();
  mocks.prepareProviderPage.mockResolvedValue(undefined);
  mocks.provider.park.mockResolvedValue(undefined);
  mocks.claudeCleaner.supports.delete = false;
  mocks.claudeCleaner.supports.archive = false;
  mocks.claudeCleaner.deleteConversation.mockResolvedValue({ ok: true });
  mocks.cleaner.deleteConversation.mockResolvedValue({ ok: true, note: 'confirmed' });
  mocks.cleaner.confirmGone.mockResolvedValue(true);
  mocks.cleaner.archiveConversation.mockResolvedValue({ ok: true, note: 'confirmed' });
  mocks.cleaner.confirmArchived.mockResolvedValue(true);
  mocks.createRealChatLedEnv.mockReturnValue(makeEnv());
});

afterEach(async () => {
  for (const { root } of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = '';
});

describe('ChatLedPage persistence safety', () => {
  it('leaves Grok conversations manual without registering a cleaner', async () => {
    const run = makeRun();
    run.conversations = [{ provider: 'grok', url: 'https://grok.com/chat/123e4567-e89b-42d3-a456-426614174000', createdByAiOne: true, registrationStatus: 'confirmed', registeredAt: 1 }];
    window.localStorage.setItem(CHAT_LED_STORAGE_KEY, JSON.stringify([run]));
    const container = await renderPage();
    await clickButton(container, 'Open');
    expect(container.textContent).toContain('Manual');
    await clickButton(container, 'Clean up');
    await vi.waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(CHAT_LED_STORAGE_KEY) || '[]') as ChatLedRun[];
      expect(stored[0]?.cleanupResults?.[0]?.outcome).toBe('manual');
    });
    expect(mocks.prepareProviderPage).not.toHaveBeenCalled();
    expect(mocks.claudeCleaner.deleteConversation).not.toHaveBeenCalled();
    expect(mocks.provider.evalWithCallback).not.toHaveBeenCalled();
  });

  it('fails closed before an enabled non-ChatGPT provider action if preparation fails', async () => {
    mocks.claudeCleaner.supports.delete = true;
    const run = makeRun();
    run.conversations = [{ provider: 'claude', url: 'https://claude.ai/chat/123e4567-e89b-42d3-a456-426614174000', createdByAiOne: true, registrationStatus: 'confirmed', registeredAt: 1 }];
    window.localStorage.setItem(CHAT_LED_STORAGE_KEY, JSON.stringify([run]));
    mocks.prepareProviderPage.mockRejectedValueOnce(new Error('Claude readiness failed'));
    const container = await renderPage();
    await clickButton(container, 'Open');
    await clickButton(container, 'Clean up');
    await vi.waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(CHAT_LED_STORAGE_KEY) || '[]') as ChatLedRun[];
      expect(stored[0]?.cleanupResults?.[0]?.outcome).toBe('manual');
    });
    expect(mocks.prepareProviderPage).toHaveBeenCalledWith('claude');
    expect(mocks.claudeCleaner.deleteConversation).not.toHaveBeenCalled();
  });

  it('does not start any provider I/O when the initial run save fails', async () => {
    const env = makeEnv();
    mocks.createRealChatLedEnv.mockReturnValue(env);
    const original = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (key === CHAT_LED_STORAGE_KEY) throw new Error('simulated storage quota');
      original(key, value);
    });

    const container = await renderPage();
    await enterGoal(container, 'test initial persistence guard');
    await clickButton(container, 'Start');

    expect(env.prepare).not.toHaveBeenCalled();
    expect(env.sendableProviders).not.toHaveBeenCalled();
    expect(env.newSession).not.toHaveBeenCalled();
    expect(env.send).not.toHaveBeenCalled();
    expect(container.textContent).toContain('The run record could not be saved');
  });

  it('aborts before cleaner actions when provider-page preparation fails', async () => {
    window.localStorage.setItem(CHAT_LED_STORAGE_KEY, JSON.stringify([makeRun()]));
    mocks.prepareProviderPage.mockRejectedValueOnce(new Error('provider preparation failed'));
    const container = await renderPage();
    await clickButton(container, 'Open');
    await clickButton(container, 'Clean up');
    await vi.waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(CHAT_LED_STORAGE_KEY) || '[]') as ChatLedRun[];
      expect(stored[0]?.cleanupResults).toHaveLength(2);
    });

    const stored = JSON.parse(window.localStorage.getItem(CHAT_LED_STORAGE_KEY) || '[]') as ChatLedRun[];
    expect(mocks.cleaner.deleteConversation).not.toHaveBeenCalled();
    expect(stored[0].cleanupResults?.map((item) => item.outcome)).toEqual(['manual', 'manual']);
  });

  it('aborts before cleaner actions when viewport parking fails', async () => {
    window.localStorage.setItem(CHAT_LED_STORAGE_KEY, JSON.stringify([makeRun()]));
    mocks.provider.park.mockRejectedValueOnce(new Error('viewport parking failed'));
    const container = await renderPage();
    await clickButton(container, 'Open');
    await clickButton(container, 'Clean up');
    await vi.waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(CHAT_LED_STORAGE_KEY) || '[]') as ChatLedRun[];
      expect(stored[0]?.cleanupResults).toHaveLength(2);
    });

    const stored = JSON.parse(window.localStorage.getItem(CHAT_LED_STORAGE_KEY) || '[]') as ChatLedRun[];
    expect(mocks.cleaner.deleteConversation).not.toHaveBeenCalled();
    expect(stored[0].cleanupResults?.map((item) => item.outcome)).toEqual(['manual', 'manual']);
  });

  it('preserves manual outcomes after one item checkpoint fails and the next storage write succeeds', async () => {
    window.localStorage.setItem(CHAT_LED_STORAGE_KEY, JSON.stringify([makeRun()]));
    const original = window.localStorage.setItem.bind(window.localStorage);
    let keyWrites = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (key === CHAT_LED_STORAGE_KEY && ++keyWrites === 2) throw new Error('one transient quota error');
      original(key, value);
    });

    const container = await renderPage();
    await clickButton(container, 'Open');
    await clickCleanupAndWait(container);

    const stored = JSON.parse(window.localStorage.getItem(CHAT_LED_STORAGE_KEY) || '[]') as ChatLedRun[];
    expect(mocks.cleaner.deleteConversation).toHaveBeenCalledTimes(1);
    expect(mocks.cleaner.deleteConversation).toHaveBeenCalledWith(FIRST_URL);
    expect(stored[0].cleanupRunning).toBe(false);
    expect(stored[0].cleanupResults?.map((item) => item.outcome)).toEqual(['deleted', 'manual']);
    expect(stored[0].cleanupResults?.[1].url).toBe(SECOND_URL);
  });
});

describe('task draft', () => {
  it('keeps the unsent task across a remount (app restart) and nowhere but local storage', async () => {
    const first = await renderPage();
    await enterGoal(first, 'draft that must survive');
    expect(window.localStorage.getItem('ai-one:chat-led:draft:v1')).toBe('draft that must survive');
    for (const { root } of roots.splice(0)) await act(async () => root.unmount());
    const second = await renderPage();
    expect((second.querySelector('#chatled-goal') as HTMLTextAreaElement).value).toBe('draft that must survive');
    await enterGoal(second, '');
    expect(window.localStorage.getItem('ai-one:chat-led:draft:v1')).toBeNull();
  });
});

describe('extra ChatGPT worker selection', () => {
  it('defaults to zero and offers zero, one or two workers', async () => {
    const container = await renderPage();
    const picker = container.querySelector('#chatled-workers') as HTMLSelectElement | null;
    expect(picker?.value).toBe('0');
    expect([...(picker?.options ?? [])].map((option) => option.value)).toEqual(['0', '1', '2']);
  });
  it('selecting two workers passes both instance keys to the controller preparation', async () => {
    const env = makeEnv();
    mocks.createRealChatLedEnv.mockReturnValue(env);
    const container = await renderPage();
    const picker = container.querySelector('#chatled-workers') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(picker, '2');
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await enterGoal(container, 'parallel agent testing');
    await clickButton(container, 'Start');
    await vi.waitFor(() => expect(env.prepare).toHaveBeenCalledWith('chatgpt#3'));
    expect(env.prepare).toHaveBeenCalledWith('chatgpt#2');
  });

  it('does not delete any conversation when another instance fails preparation', async () => {
    const run = makeRun();
    run.conversations[1].provider = 'chatgpt#2';
    window.localStorage.setItem(CHAT_LED_STORAGE_KEY, JSON.stringify([run]));
    mocks.prepareProviderPage.mockImplementation(async (instance: string) => {
      if (instance === 'chatgpt#2') throw new Error('second instance unavailable');
    });
    const container = await renderPage();
    await clickButton(container, 'Open');
    await clickButton(container, 'Clean up');
    await vi.waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(CHAT_LED_STORAGE_KEY) || '[]') as ChatLedRun[];
      expect(saved[0]?.cleanupResults?.map((item) => item.outcome)).toEqual(['manual', 'manual']);
    }, { timeout: 10_000 }); // the first instance is prepared (with the real 2.5 s viewport settle) before the second fails
    expect(mocks.cleaner.deleteConversation).not.toHaveBeenCalled();
  });
});
