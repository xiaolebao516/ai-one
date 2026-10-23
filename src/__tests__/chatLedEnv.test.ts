import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderState } from '../../shared/types';
const mocks = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn(), park: vi.fn(), eval: vi.fn(), newSession: vi.fn(), evalWithCallback: vi.fn() }));
vi.mock('../host', () => ({ host: { connections: { get: mocks.get, getAll: mocks.get }, provider: { open: mocks.open, park: mocks.park, eval: mocks.eval, newSession: mocks.newSession, evalWithCallback: mocks.evalWithCallback } } }));
vi.mock('../bridge/pull', () => ({ resetProviderBootState: vi.fn(), startBridgePull: vi.fn() }));
vi.mock('../workflow/runtime', () => ({ prepareWorkflowRun: vi.fn() }));
vi.mock('../workflow/sendAndWait', () => ({ sendAndWait: vi.fn() }));
vi.mock('../workflow/cancel', () => ({ stopProvider: vi.fn() }));
import { createRealChatLedEnv, prepareProviderPage } from '../workflow/chatLed/env';

describe('chat-led real provider preparation', () => {
  beforeEach(() => vi.resetAllMocks());
  it('waits through a fresh logged-out hydration frame before deciding login failed', async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      mocks.get.mockImplementation(async () => [{ provider: 'chatgpt', webview: 'loaded', dom: 'ready', login: ++reads < 3 ? 'logged_out' : 'logged_in', thinking: false, lastStatusAt: reads }]);
      mocks.eval.mockResolvedValue(undefined);
      const ready = prepareProviderPage('chatgpt');
      await vi.advanceTimersByTimeAsync(1000);
      await ready;
      expect(reads).toBeGreaterThanOrEqual(3);
    } finally { vi.useRealTimers(); }
  });
  it('unparks an already loaded page and refreshes its status before trusting stale logged-out data', async () => {
    let state: ProviderState = { provider: 'chatgpt', webview: 'loaded', dom: 'ready', login: 'logged_out', thinking: false, lastStatusAt: 1 };
    mocks.get.mockImplementation(async () => [state]);
    mocks.eval.mockImplementation(async () => { state = { ...state, login: 'logged_in', lastStatusAt: 2 }; });
    await prepareProviderPage('chatgpt');
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.park).toHaveBeenCalledWith('chatgpt', expect.anything());
    expect(mocks.eval).toHaveBeenCalledWith('chatgpt', expect.stringContaining('CHECK_STATUS'));
  });
  it('treats "script evaluation is not ready" on a just-opened page as transient and keeps polling', async () => {
    vi.useFakeTimers();
    try {
      let polls = 0;
      let state: ProviderState = { provider: 'claude', webview: 'none', dom: 'unknown', login: 'unknown', thinking: false, lastStatusAt: 0 };
      mocks.get.mockImplementation(async () => [state]);
      mocks.open.mockImplementation(async () => {
        state = { ...state, webview: 'loaded' };
      });
      mocks.eval.mockImplementation(async () => {
        polls += 1;
        if (polls < 3) throw new Error('script evaluation is not ready for provider: claude');
        state = { ...state, dom: 'ready', login: 'logged_in', lastStatusAt: 5 };
      });
      const ready = prepareProviderPage('claude');
      await vi.advanceTimersByTimeAsync(5000);
      await ready;
      expect(polls).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it('calls newSession without awaiting any state read first, so a cancelled run cannot slip in a session', async () => {
    mocks.get.mockImplementation(() => new Promise(() => undefined)); // a stuck state read must not delay or gate the call
    mocks.newSession.mockResolvedValue(undefined);
    void createRealChatLedEnv().newSession('claude');
    await Promise.resolve();
    expect(mocks.newSession).toHaveBeenCalledTimes(1);
  });
  it('waits for a site that loads a new document to boot before reading its new-session identity', async () => {
    vi.useFakeTimers();
    try {
      let polls = 0;
      let state: ProviderState = { provider: 'gemini', webview: 'loaded', dom: 'ready', login: 'logged_in', thinking: false, lastStatusAt: 10 };
      mocks.get.mockImplementation(async () => [state]);
      // The new document resets the page state; it reports again only after a few polls.
      mocks.newSession.mockImplementation(async () => { state = { ...state, dom: 'unknown', login: 'unknown' }; });
      mocks.eval.mockImplementation(async () => {
        polls += 1;
        if (polls < 3) throw new Error('script evaluation is not ready for provider: gemini');
        state = { ...state, dom: 'ready', login: 'logged_in', lastStatusAt: Date.now() + 1 };
      });
      mocks.evalWithCallback.mockResolvedValue(JSON.stringify({ url: 'https://gemini.google.com/app', documentId: 'boot-2' }));
      const created = createRealChatLedEnv().newSession('gemini');
      await vi.advanceTimersByTimeAsync(6000);
      await expect(created).resolves.toMatchObject({ url: 'https://gemini.google.com/app', documentId: 'boot-2', freshDocument: true });
      expect(polls).toBeGreaterThanOrEqual(3);
      // The identity read happens only after the page reported ready again.
      expect(mocks.evalWithCallback.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.eval.mock.invocationCallOrder[2]);
    } finally { vi.useRealTimers(); }
  });
});

describe('multi-instance preparation', () => {
  beforeEach(() => vi.resetAllMocks());
  it('addresses the instance while CHECK_STATUS uses the base provider', async () => {
    const states = [
      { provider: 'chatgpt', webview: 'loaded', dom: 'ready', login: 'logged_in', thinking: false, lastStatusAt: 4 },
      { provider: 'chatgpt#2', webview: 'loaded', dom: 'ready', login: 'logged_out', thinking: false, lastStatusAt: 1 },
    ];
    mocks.get.mockImplementation(async () => states);
    mocks.eval.mockImplementation(async (instance: string) => {
      if (instance === 'chatgpt#2') states[1] = { ...states[1], login: 'logged_in', lastStatusAt: 9 };
    });
    await prepareProviderPage('chatgpt#2');
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.eval.mock.calls[0][0]).toBe('chatgpt#2');
    expect(mocks.eval.mock.calls[0][1]).toContain('"provider":"chatgpt"');
    expect(mocks.eval.mock.calls[0][1]).not.toContain('"provider":"chatgpt#2"');
    expect(await createRealChatLedEnv().sendableProviders()).toContain('chatgpt#2');
  });
});
