import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProvider, BridgeMessage, ProviderState } from '../../shared/types';
import { PULL_MAX_DECODED_BYTES } from '../../shared/constants';
import { capOutboxEntry, type OutboxEntry } from '../../injected/bootstrap';
import { publishBridgeMessage, resetBusForTests } from '../bridge/bus';
import { handleTitleMessage, pullProvider, resetBridgePullForTests } from '../bridge/pull';
import { host } from '../host';
import { resetCancelState } from '../workflow/cancel';
import { ProviderResponseError, ProviderResponseTruncatedError } from '../workflow/providerResponse';
import { resetSessionCheckpointForTests } from '../workflow/sessionCheckpoint';
import { runStep } from '../workflow/stepRunner';
import { chooseStepTimeoutAction, onStepTimeoutEvent, resetStepTimeoutForTests, type StepTimeoutEvent } from '../workflow/stepTimeout';
import { SKIP_RESPONSE, resetWorkflowStateForTests } from '../workflow/state';
import { hasWaiter, resetWaitForResponseForTests, waitForResponse } from '../workflow/waitForResponse';
import { resetWorkflowRuntimeForTests, runWorkflow } from '../workflow';

vi.mock('../host', () => ({
  host: {
    provider: {
      send: vi.fn(),
      fill: vi.fn(),
      eval: vi.fn(),
      evalWithCallback: vi.fn(),
      stop: vi.fn(() => Promise.resolve({ outcome: 'clicked' as const })),
    },
    connections: {
      get: vi.fn(),
    },
    bridge: {
      subscribeTitle: vi.fn(),
    },
    sessionCheckpoint: {
      save: vi.fn(),
      load: vi.fn(),
      clear: vi.fn(),
    },
  },
}));

const providers: AIProvider[] = ['chatgpt', 'claude', 'gemini', 'grok', 'meta'];
const PARTIAL_MARKER = 'PARTIAL_REPLY_MARKER';

function state(provider: AIProvider): ProviderState {
  return {
    provider,
    webview: 'loaded',
    dom: 'ready',
    login: 'logged_in',
    thinking: false,
    lastStatusAt: 1,
  };
}

function done(provider: AIProvider, payload: unknown): BridgeMessage {
  return { v: 1, action: 'RESPONSE_DONE', provider, payload, transport: 'pull' };
}

function sentPrompts(): string[] {
  return vi.mocked(host.provider.send).mock.calls.map((call) => String(call[1]));
}

describe('truncated RESPONSE_DONE', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetBusForTests();
    resetBridgePullForTests();
    resetWorkflowStateForTests();
    resetWaitForResponseForTests();
    resetWorkflowRuntimeForTests();
    resetCancelState();
    resetStepTimeoutForTests();
    resetSessionCheckpointForTests();
    vi.mocked(host.provider.send).mockResolvedValue(undefined);
    vi.mocked(host.provider.eval).mockResolvedValue(undefined);
    vi.mocked(host.provider.evalWithCallback).mockResolvedValue(JSON.stringify([]));
    vi.mocked(host.connections.get).mockResolvedValue(providers.map((provider) => state(provider)));
    vi.mocked(host.sessionCheckpoint.save).mockResolvedValue(undefined);
    vi.mocked(host.sessionCheckpoint.clear).mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetBusForTests();
    resetBridgePullForTests();
    resetWorkflowStateForTests();
    resetWaitForResponseForTests();
    resetWorkflowRuntimeForTests();
    resetCancelState();
    resetStepTimeoutForTests();
    resetSessionCheckpointForTests();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each([
    ['with partial text', { text: `${PARTIAL_MARKER} first three quarters`, truncated: true }],
    ['without text', { truncated: true }],
  ])('rejects a DONE %s as a provider error instead of resolving it', async (_label, payload) => {
    const promise = waitForResponse('gemini', 1);
    const rejection = promise.catch((error: unknown) => error);

    publishBridgeMessage(done('gemini', payload));
    const error = await rejection;

    expect(error).toBeInstanceOf(ProviderResponseTruncatedError);
    expect(error).toBeInstanceOf(ProviderResponseError);
    expect(error).toMatchObject({ provider: 'gemini', message: 'response truncated in transport' });
    expect(String((error as ProviderResponseError).response)).not.toContain(PARTIAL_MARKER);
    expect(hasWaiter('gemini', 1)).toBe(false);
  });

  it('still resolves complete string and text payloads unchanged', async () => {
    const plain = waitForResponse('chatgpt', 1);
    publishBridgeMessage(done('chatgpt', 'complete answer'));
    await expect(plain).resolves.toBe('complete answer');

    const object = waitForResponse('chatgpt', 2);
    publishBridgeMessage(done('chatgpt', { text: 'complete object answer', truncated: false }));
    await expect(object).resolves.toBe('complete object answer');
  });

  it('accepts a complete DONE after a truncated streaming chunk', async () => {
    const promise = waitForResponse('gemini', 3);
    publishBridgeMessage({ v: 1, action: 'RESPONSE_CHUNK', provider: 'gemini', payload: 'cut preview', transport: 'pull' });
    publishBridgeMessage(done('gemini', 'final full answer'));
    await expect(promise).resolves.toBe('final full answer');
  });

  it('rejects an oversized DONE capped by the page outbox and pulled through the host bridge', async () => {
    const original: OutboxEntry = {
      v: 1,
      action: 'RESPONSE_DONE',
      provider: 'gemini',
      bootId: 'boot-a',
      mid: 1,
      payload: `${PARTIAL_MARKER}${'界'.repeat(PULL_MAX_DECODED_BYTES)}END_MARKER`,
    };
    const capped = capOutboxEntry(original);
    expect(capped.payload).toMatchObject({ truncated: true });

    handleTitleMessage({ v: 1, action: 'STATUS_REPORT', provider: 'gemini', bootId: 'boot-a', seq: 1, transport: 'title' });
    const promise = waitForResponse('gemini', 4);
    const rejection = promise.catch((error: unknown) => error);
    vi.mocked(host.provider.evalWithCallback).mockResolvedValue(JSON.stringify(JSON.stringify([capped])));

    await pullProvider('gemini', { force: true });

    await expect(rejection).resolves.toBeInstanceOf(ProviderResponseTruncatedError);
  });

  it('stops a consult run before the reviewer receives a truncated first answer', async () => {
    const run = runWorkflow({
      text: 'UNIQUE_QUESTION_TOKEN review the rules',
      mode: 'consult',
      roles: { first: 'chatgpt', second: 'gemini', reviewer: 'gemini', summary: 'chatgpt' },
      locale: 'en',
    });

    await vi.waitFor(() => expect(host.provider.send).toHaveBeenCalledTimes(2));
    expect(vi.mocked(host.provider.send).mock.calls.map((call) => call[0]).sort()).toEqual(['chatgpt', 'gemini']);

    publishBridgeMessage(done('chatgpt', { text: `${PARTIAL_MARKER} gpt half`, truncated: true }));
    publishBridgeMessage(done('gemini', 'argon complete independent answer'));

    await expect(run).resolves.toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(host.provider.send).toHaveBeenCalledTimes(2);
    expect(sentPrompts().some((prompt) => prompt.includes(PARTIAL_MARKER))).toBe(false);
  });

  it('offers recovery without forwarding partial text when provider errors are recoverable', async () => {
    const events: StepTimeoutEvent[] = [];
    const unsubscribe = onStepTimeoutEvent((event) => events.push(event));

    const step = runStep('gemini', 'brainstorm seat prompt', undefined, { recoverProviderErrors: true });
    await vi.waitFor(() => expect(host.provider.send).toHaveBeenCalledTimes(1));
    publishBridgeMessage(done('gemini', { text: `${PARTIAL_MARKER} seat half`, truncated: true }));
    await vi.waitFor(() => expect(events.some((event) => event.timedOut)).toBe(true));
    expect(events.find((event) => event.timedOut)).toMatchObject({ provider: 'gemini', failureKind: 'provider-error' });

    chooseStepTimeoutAction('skip');
    await expect(step).resolves.toEqual({ response: SKIP_RESPONSE, turn: -1 });
    expect(host.provider.send).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
