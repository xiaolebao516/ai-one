// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_AI_PROVIDERS } from '../../../../shared/constants';
import type { AIProvider, BridgeMessage, ProviderState } from '../../../../shared/types';
import {
  CONVERSATION_SESSIONS_STORAGE_KEY,
  createConversationSession,
} from '../../../ui/conversationSessions';
import type { RunWorkflowResult } from '../../../workflow';
import { awaitStepTimeoutAction, resetStepTimeoutForTests, type StepTimeoutAction } from '../../../workflow/stepTimeout';
import { recordEventLog } from '../../../diagnostics/eventLogStore';
import { useChatRuntime, type ChatRuntime, type ChatRuntimeHost, type ChatRuntimeOptions } from './useChatRuntime';

const eventLogMock = vi.hoisted(() => ({ recordEventLog: vi.fn() }));

vi.mock('../../../diagnostics/eventLogStore', () => eventLogMock);

const mocks = vi.hoisted(() => {
  const bridgeListeners = new Set<(message: BridgeMessage) => void>();
  return {
    bridgeListeners,
    host: {
      app: { isDesktop: vi.fn(() => true) },
      connections: {
        get: vi.fn(async (): Promise<ProviderState[]> => []),
        onUpdate: vi.fn(async (_handler: (state: ProviderState) => void) => () => undefined),
      },
      bridge: {
        onMessage: vi.fn(async (handler: (message: BridgeMessage) => void) => {
          bridgeListeners.add(handler);
          return () => bridgeListeners.delete(handler);
        }),
      },
      provider: {
        open: vi.fn(async () => ({})),
        park: vi.fn(async () => undefined),
        newSession: vi.fn(async () => undefined),
      },
    },
  };
});

vi.mock('../../../host', () => ({ host: mocks.host }));

function providerState(provider: AIProvider): ProviderState {
  return {
    provider,
    webview: 'loaded',
    dom: 'ready',
    login: 'logged_in',
    thinking: false,
    lastStatusAt: 1,
    bridge: 'ok',
    adapter: 'ok',
  };
}

let currentRuntime: ChatRuntime | undefined;
const roots: { root: Root; container: HTMLElement }[] = [];
const startBridgePull = async () => () => undefined;

function RuntimeHarness({ runWorkflow }: { runWorkflow: NonNullable<ChatRuntimeOptions['runWorkflow']> }) {
  currentRuntime = useChatRuntime({
    enabled: true,
    locale: 'en',
    isDesktop: true,
    host: mocks.host as unknown as ChatRuntimeHost,
    runWorkflow,
    startBridgePull,
  });
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function mount(runWorkflow: NonNullable<ChatRuntimeOptions['runWorkflow']> = vi.fn(async (): Promise<RunWorkflowResult> => ({ ok: true })) ) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  await act(async () => {
    root.render(<RuntimeHarness runWorkflow={runWorkflow} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  await vi.waitFor(() => expect(currentRuntime?.desktopAvailable).toBe(true));
  await vi.waitFor(() => expect(mocks.bridgeListeners.size).toBeGreaterThan(0));
  return { root, container, runWorkflow };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  currentRuntime = undefined;
  window.localStorage.clear();
  mocks.bridgeListeners.clear();
  vi.clearAllMocks();
  mocks.host.app.isDesktop.mockReturnValue(true);
  mocks.host.connections.get.mockResolvedValue(ALL_AI_PROVIDERS.map(providerState));
  mocks.host.connections.onUpdate.mockImplementation(async () => () => undefined);
  mocks.host.bridge.onMessage.mockImplementation(async (handler: (message: BridgeMessage) => void) => {
    mocks.bridgeListeners.add(handler);
    return () => mocks.bridgeListeners.delete(handler);
  });
  mocks.host.provider.open.mockResolvedValue({});
  mocks.host.provider.park.mockResolvedValue(undefined);
  mocks.host.provider.newSession.mockResolvedValue(undefined);
  resetStepTimeoutForTests();
});

afterEach(async () => {
  for (const { root } of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
  resetStepTimeoutForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useChatRuntime workflow ownership', () => {
  it('ignores replay/global response events when no local chat run owns a provider', async () => {
    await mount();
    const replayResponse = {
      v: 1,
      action: 'RESPONSE_DONE',
      provider: 'chatgpt',
      payload: 'replay-only response',
      transport: 'pull',
    } as BridgeMessage;
    await act(async () => {
      for (const listener of [...mocks.bridgeListeners]) listener(replayResponse);
      await Promise.resolve();
    });
    expect(currentRuntime?.activeSession.messages).toEqual([]);
  });

  it('refuses chat sends while replay is running without consuming the draft message', async () => {
    const runner = vi.fn(async (): Promise<RunWorkflowResult> => ({ ok: true }));
    await mount(runner);
    await act(async () => currentRuntime?.setReplayRunning(true));
    expect(currentRuntime?.canStartReplay()).toBe(false);
    let sent: boolean | undefined;
    await act(async () => {
      sent = await currentRuntime!.sendMessage('keep this question', ['chatgpt'], 'free');
    });
    expect(sent).toBe(false);
    expect(runner).not.toHaveBeenCalled();
    expect(currentRuntime?.activeSession.messages).toEqual([]);
  });

  it('writes bridge responses only while a local run explicitly owns the provider and session', async () => {
    const pendingRun = deferred<RunWorkflowResult>();
    const runner = vi.fn(() => pendingRun.promise);
    await mount(runner);
    let sending!: Promise<boolean>;
    await act(async () => {
      sending = currentRuntime!.sendMessage('local question', ['chatgpt'], 'free');
    });
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
    expect(currentRuntime?.canStartReplay()).toBe(false);

    const localResponse = {
      v: 1,
      action: 'RESPONSE_DONE',
      provider: 'chatgpt',
      payload: 'local response',
      transport: 'pull',
    } as BridgeMessage;
    await act(async () => {
      for (const listener of [...mocks.bridgeListeners]) listener(localResponse);
      await Promise.resolve();
    });
    expect(currentRuntime?.activeSession.messages.some((message) => message.role === 'ai' && message.content === 'local response')).toBe(true);

    pendingRun.resolve({ ok: true });
    await act(async () => { await sending; });
    expect(currentRuntime?.busyProviders).not.toContain('chatgpt');
    expect(currentRuntime?.canStartReplay()).toBe(true);
  });

  it.each(['retry', 'skip'] as const)('routes timeout %s to the matching workflow request and releases busy state', async (action) => {
    const pendingRun = deferred<RunWorkflowResult>();
    const runner = vi.fn(() => pendingRun.promise);
    await mount(runner);
    let sending!: Promise<boolean>;
    await act(async () => {
      sending = currentRuntime!.sendMessage('timeout question', ['chatgpt'], 'free');
    });
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));

    let actionPromise!: Promise<StepTimeoutAction>;
    await act(async () => {
      actionPromise = awaitStepTimeoutAction('chatgpt', 'timeout');
    });
    await vi.waitFor(() => expect(currentRuntime?.timeoutActions.chatgpt?.requestId).toBeDefined());

    if (action === 'retry') {
      let retried = false;
      await act(async () => { retried = await currentRuntime!.retryProvider('chatgpt'); });
      expect(retried).toBe(true);
    } else {
      await act(async () => currentRuntime!.skipProvider('chatgpt'));
    }
    await expect(actionPromise).resolves.toBe(action);
    expect(currentRuntime?.timeoutActions.chatgpt).toBeUndefined();

    pendingRun.resolve({ ok: true });
    await act(async () => { await sending; });
    expect(currentRuntime?.busyProviders).not.toContain('chatgpt');
  });

  it('keeps dirty session data pending after a write failure and retries until saved', async () => {
    vi.useFakeTimers();
    let allowWrites = false;
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === CONVERSATION_SESSIONS_STORAGE_KEY && !allowWrites) throw new Error('storage temporarily unavailable');
      return originalSetItem.call(this, key, value);
    });

    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(currentRuntime?.persistenceNotice?.tone).toBe('block');
    const failedAttempts = setItemSpy.mock.calls.length;
    expect(recordEventLog).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(recordEventLog).toHaveBeenCalledTimes(1);

    allowWrites = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(setItemSpy.mock.calls.length).toBeGreaterThan(failedAttempts);
    expect(currentRuntime?.persistenceNotice).toBeUndefined();
    expect(window.localStorage.getItem(CONVERSATION_SESSIONS_STORAGE_KEY)).not.toBeNull();
  });

  it('updates the live session list after a successful quota eviction', async () => {
    const oldSession = createConversationSession({
      id: 'old-session',
      title: 'Old session',
      now: 1,
      messages: [{ id: 'old-question', role: 'user', content: 'old question' }],
    });
    window.localStorage.setItem(CONVERSATION_SESSIONS_STORAGE_KEY, JSON.stringify([oldSession]));
    vi.useFakeTimers();
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === CONVERSATION_SESSIONS_STORAGE_KEY && JSON.parse(value).length > 1) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      return originalSetItem.call(this, key, value);
    });

    await mount();
    await act(async () => currentRuntime!.newConversation());
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });

    expect(currentRuntime?.sessions).toHaveLength(1);
    expect(currentRuntime?.sessions[0]?.id).toBe(currentRuntime?.activeSessionId);
    expect(currentRuntime?.persistenceNotice?.message).toContain('older conversation');
    expect(recordEventLog).toHaveBeenCalledWith(expect.objectContaining({
      summary: 'Oldest conversation history was removed to stay within local storage quota',
    }));
  });
});
