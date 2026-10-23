import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderState } from '../../shared/types';
const mocks = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn(), park: vi.fn(), eval: vi.fn() }));
vi.mock('../host', () => ({ host: { connections: { get: mocks.get }, provider: { open: mocks.open, park: mocks.park, eval: mocks.eval } } }));
vi.mock('../bridge/pull', () => ({ resetProviderBootState: vi.fn(), startBridgePull: vi.fn() }));
vi.mock('../workflow/runtime', () => ({ prepareWorkflowRun: vi.fn() }));
vi.mock('../workflow/sendAndWait', () => ({ sendAndWait: vi.fn() }));
vi.mock('../workflow/cancel', () => ({ stopProvider: vi.fn() }));
import { prepareProviderPage } from '../workflow/chatLed/env';

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
});
