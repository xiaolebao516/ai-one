import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeMessage } from '../../shared/types';
import { onBridgeMessage, resetBusForTests } from '../bridge/bus';
import { resetBridgePullForTests } from '../bridge/pull';
import { host, type ProviderStopResult } from '../host';
import { getInFlightProviders, markInFlight, resetCancelState, setStopNoticeLocale, stopProvider } from '../workflow/cancel';
import { activateTurn, resetWorkflowStateForTests } from '../workflow/state';
import { tearDownWaiters } from '../workflow/teardown';
import { hasWaiter, resetWaitForResponseForTests, waitForResponse } from '../workflow/waitForResponse';

vi.mock('../host', () => ({ host: { provider: { stop: vi.fn() } } }));

function pendingStop() {
  let resolve!: (result: ProviderStopResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ProviderStopResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('concurrent provider stop cleanup', () => {
  let messages: BridgeMessage[];
  let unsubscribe: () => void;

  const systemErrors = () => messages.filter((message) =>
    message.action === 'RESPONSE_DONE' && message.provider === ('system' as BridgeMessage['provider']),
  );

  beforeEach(() => {
    vi.resetAllMocks();
    resetBusForTests();
    resetBridgePullForTests();
    resetWaitForResponseForTests();
    resetWorkflowStateForTests();
    resetCancelState();
    setStopNoticeLocale('en');
    messages = [];
    unsubscribe = onBridgeMessage((message) => messages.push(message));
  });

  afterEach(() => {
    unsubscribe();
    resetWaitForResponseForTests();
    resetBridgePullForTests();
    resetCancelState();
    resetWorkflowStateForTests();
    resetBusForTests();
  });

  it('stops once and reports once when two cleanups target the same active provider', async () => {
    const stop = pendingStop();
    vi.mocked(host.provider.stop).mockReturnValue(stop.promise);
    const waiter = waitForResponse('chatgpt', 1).catch((error: unknown) => error);
    activateTurn('chatgpt', 1);
    markInFlight('chatgpt');

    const firstCleanup = tearDownWaiters(['chatgpt'], { stopClick: true });
    const secondCleanup = tearDownWaiters(['chatgpt'], { stopClick: true });
    stop.resolve({ outcome: 'not-found', generating: true });
    await Promise.all([firstCleanup, secondCleanup]);

    expect(host.provider.stop).toHaveBeenCalledTimes(1);
    expect(systemErrors()).toHaveLength(1);
    expect(systemErrors()[0].payload).toContain('stop button for ChatGPT was not found');
    await expect(waiter).resolves.toMatchObject({ message: 'Workflow cancelled by user' });
    expect(hasWaiter('chatgpt', 1)).toBe(false);
    expect(getInFlightProviders()).toEqual([]);
  });

  it('executes a new stop after the earlier stop has settled', async () => {
    vi.mocked(host.provider.stop)
      .mockResolvedValueOnce({ outcome: 'not-found', generating: false })
      .mockResolvedValueOnce({ outcome: 'clicked', generating: true });

    await expect(stopProvider('claude')).resolves.toEqual({ outcome: 'not-found', generating: false });
    await expect(stopProvider('claude')).resolves.toEqual({ outcome: 'clicked', generating: true });

    expect(host.provider.stop).toHaveBeenCalledTimes(2);
    expect(systemErrors()).toHaveLength(1);
  });

  it('keeps stops for different providers independent', async () => {
    const claude = pendingStop();
    const gemini = pendingStop();
    vi.mocked(host.provider.stop).mockImplementation((provider) => provider === 'claude' ? claude.promise : gemini.promise);
    const claudeStop = stopProvider('claude');
    let geminiSettled = false;
    const geminiStop = stopProvider('gemini').then((result) => {
      geminiSettled = true;
      return result;
    });

    claude.resolve({ outcome: 'clicked', generating: true });
    await expect(claudeStop).resolves.toEqual({ outcome: 'clicked', generating: true });
    expect(geminiSettled).toBe(false);
    gemini.resolve({ outcome: 'not-found', generating: true });
    await expect(geminiStop).resolves.toEqual({ outcome: 'not-found', generating: true });

    expect(host.provider.stop).toHaveBeenCalledTimes(2);
    expect(systemErrors()).toHaveLength(1);
    expect(systemErrors()[0].payload).toContain('stop button for Gemini was not found');
  });

  it('reports a shared stop failure once and permits a later independent attempt', async () => {
    const stop = pendingStop();
    vi.mocked(host.provider.stop).mockReturnValue(stop.promise);
    const first = stopProvider('gemini');
    const second = stopProvider('gemini');
    stop.reject(new Error('callback timed out'));
    const result = { outcome: 'error', detail: 'callback timed out' };
    await expect(Promise.all([first, second])).resolves.toEqual([result, result]);

    expect(host.provider.stop).toHaveBeenCalledTimes(1);
    expect(systemErrors()).toHaveLength(1);
    expect(systemErrors()[0].payload).toContain('callback timed out');

    vi.mocked(host.provider.stop).mockResolvedValueOnce({ outcome: 'clicked' });
    await expect(stopProvider('gemini')).resolves.toEqual({ outcome: 'clicked' });
    expect(host.provider.stop).toHaveBeenCalledTimes(2);
  });
});
