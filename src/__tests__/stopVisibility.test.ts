import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProvider, BridgeMessage, ProviderState } from '../../shared/types';
import { onBridgeMessage, publishBridgeMessage, resetBusForTests } from '../bridge/bus';
import { resetBridgePullForTests } from '../bridge/pull';
import { host } from '../host';
import { formatI18n, t } from '../i18n/t';
import { StepTimeoutDialog } from '../ui/StepTimeoutDialog';
import { resetCancelState, setStopNoticeLocale, stopProvider } from '../workflow/cancel';
import { resetSessionCheckpointForTests } from '../workflow/sessionCheckpoint';
import { resetStepTimeoutForTests } from '../workflow/stepTimeout';
import { resetWorkflowStateForTests } from '../workflow/state';
import { resetWaitForResponseForTests } from '../workflow/waitForResponse';
import { resetWorkflowRuntimeForTests, runWorkflow } from '../workflow';

vi.mock('../host', () => ({
  host: {
    provider: {
      send: vi.fn(),
      fill: vi.fn(),
      eval: vi.fn(),
      evalWithCallback: vi.fn(),
      stop: vi.fn(),
    },
    connections: { get: vi.fn() },
    bridge: { subscribeTitle: vi.fn() },
    sessionCheckpoint: { save: vi.fn(), load: vi.fn(), clear: vi.fn() },
  },
}));

const providers: AIProvider[] = ['chatgpt', 'claude', 'gemini', 'grok', 'meta'];
const state = (provider: AIProvider): ProviderState => ({
  provider,
  webview: 'loaded',
  dom: 'ready',
  login: 'logged_in',
  thinking: false,
  lastStatusAt: 1,
});

function systemErrors(messages: BridgeMessage[]): string[] {
  return messages
    .filter((message) => message.action === 'RESPONSE_DONE' && message.provider === ('system' as AIProvider))
    .map((message) => String(message.payload));
}

function reset(): void {
  resetBusForTests();
  resetBridgePullForTests();
  resetWorkflowStateForTests();
  resetWaitForResponseForTests();
  resetWorkflowRuntimeForTests();
  resetCancelState();
  resetStepTimeoutForTests();
  resetSessionCheckpointForTests();
  setStopNoticeLocale('en');
}

describe('stop outcomes are visible (#15)', () => {
  let messages: BridgeMessage[];
  let unsubscribe: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    reset();
    messages = [];
    unsubscribe = onBridgeMessage((message) => messages.push(message));
    vi.mocked(host.provider.send).mockResolvedValue(undefined);
    vi.mocked(host.provider.eval).mockResolvedValue(undefined);
    vi.mocked(host.provider.evalWithCallback).mockResolvedValue(JSON.stringify([]));
    vi.mocked(host.connections.get).mockResolvedValue(providers.map(state));
    vi.mocked(host.sessionCheckpoint.save).mockResolvedValue(undefined);
    vi.mocked(host.sessionCheckpoint.clear).mockResolvedValue(undefined);
  });

  afterEach(() => {
    unsubscribe();
    reset();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('stays quiet when the stop control was clicked', async () => {
    vi.mocked(host.provider.stop).mockResolvedValue({ outcome: 'clicked', generating: true });

    await expect(stopProvider('chatgpt')).resolves.toEqual({ outcome: 'clicked', generating: true });
    expect(systemErrors(messages)).toEqual([]);
  });

  it('shows a localized warning when the stop control was not found', async () => {
    vi.mocked(host.provider.stop).mockResolvedValue({ outcome: 'not-found', generating: true });
    setStopNoticeLocale('zh-TW');

    await stopProvider('gemini');

    expect(systemErrors(messages)).toEqual([
      `Error: ${formatI18n(t('workflow.providerStopNotClicked', 'zh-TW'), { provider: 'Gemini' })}`,
    ]);
  });

  it('shows the failure detail when the host stop call itself fails', async () => {
    vi.mocked(host.provider.stop).mockRejectedValue(new Error('eval_with_callback timed out'));

    await expect(stopProvider('chatgpt')).resolves.toEqual({ outcome: 'error', detail: 'eval_with_callback timed out' });
    expect(systemErrors(messages)).toEqual([
      `Error: ${formatI18n(t('workflow.providerStopFailed', 'en'), { provider: 'ChatGPT', detail: 'eval_with_callback timed out' })}`,
    ]);
  });

  it('reports an unclicked stop when the user cancels a running Consult step, and sends nothing more', async () => {
    vi.mocked(host.provider.stop).mockResolvedValue({ outcome: 'not-found', generating: true });
    const run = runWorkflow({
      text: 'review the rules',
      mode: 'consult',
      roles: { first: 'chatgpt', second: 'gemini', reviewer: 'gemini', summary: 'chatgpt' },
      locale: 'en',
    });
    await vi.waitFor(() => expect(host.provider.send).toHaveBeenCalledTimes(2));

    publishBridgeMessage({ v: 1, action: 'CANCEL_WORKFLOW', transport: 'local' } as BridgeMessage);
    await expect(run).resolves.toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(host.provider.stop).toHaveBeenCalled();
    const warnings = systemErrors(messages).filter((text) => text.includes('stop button'));
    expect(warnings.length).toBeGreaterThan(0);
    expect(host.provider.send).toHaveBeenCalledTimes(2);
  });
});

describe('Retry warns that it re-sends the whole prompt (#15)', () => {
  it.each(['timeout', 'provider-error'] as const)('shows the resend warning in the %s recovery dialog', (failureKind) => {
    const html = renderToStaticMarkup(
      createElement(StepTimeoutDialog, {
        event: { provider: 'chatgpt', remainingMs: 0, timedOut: true, failureKind },
        onClose: vi.fn(),
        locale: 'en',
      }),
    );

    expect(html).toContain(formatI18n(t('stepTimeout.retryResendWarning', 'en'), { provider: 'chatgpt' }).replace(/'/g, '&#x27;'));
    expect(html).toContain(t('stepTimeout.retry', 'en'));
  });
});
