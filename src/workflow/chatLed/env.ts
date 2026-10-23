import type { AIProvider, ProviderState } from '../../../shared/types';
import { resetProviderBootState, startBridgePull } from '../../bridge/pull';
import { host } from '../../host';
import { prepareWorkflowRun } from '../runtime';
import { isSendable } from '../sendability';
import { sendAndWait } from '../sendAndWait';
import { stopProvider } from '../cancel';
import type { ChatLedEnv } from './controller';

const PAGE_READY_TIMEOUT_MS = 45_000;
const IDLE_TIMEOUT_MS = 120_000;
const POLL_MS = 1_000;

/** Same offscreen parking rectangle the classic UI uses for background provider pages. */
function parkedBounds(): DOMRectReadOnly {
  return {
    x: -10_000,
    y: -10_000,
    width: 420,
    height: 320,
    top: -10_000,
    left: -10_000,
    right: -9_580,
    bottom: -9_680,
    toJSON: () => ({}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function stateOf(provider: AIProvider): Promise<ProviderState | undefined> {
  const snapshot = await host.connections.get();
  return snapshot.find((state) => state.provider === provider);
}

let bridgeStop: (() => void) | undefined;

/**
 * Makes sure the provider page exists (parked offscreen), is logged in and idle (busy gate, #15).
 * Does not touch shared workflow state, so cleanup can use it while nothing else is running.
 */
export async function prepareProviderPage(provider: AIProvider): Promise<void> {
  let state = await stateOf(provider);
  if (!state || state.webview !== 'loaded') {
    resetProviderBootState(provider);
    await host.provider.open(provider, parkedBounds());
    await host.provider.park(provider, parkedBounds());
  }
  const readyDeadline = Date.now() + PAGE_READY_TIMEOUT_MS;
  for (;;) {
    state = await stateOf(provider);
    if (state && isSendable(state)) break;
    if (state?.login === 'logged_out' || state?.login === 'blocked') {
      throw new Error(`${provider} is not logged in (state: ${state.login}). Log in from the classic UI or Resources page first.`);
    }
    if (Date.now() > readyDeadline) throw new Error(`${provider} page did not become ready in time.`);
    await sleep(POLL_MS);
  }
  // Busy gate (#15): never write into a page that is still generating something else.
  const idleDeadline = Date.now() + IDLE_TIMEOUT_MS;
  while ((await stateOf(provider))?.thinking) {
    if (Date.now() > idleDeadline) throw new Error(`${provider} stayed busy; not sending into a generating page.`);
    await sleep(POLL_MS);
  }
}

/** Real environment (UNVERIFIED on a logged-in desktop until the #113 user acceptance run). */
export function createRealChatLedEnv(): ChatLedEnv {
  // The response bridge (title pull) and the workflow waiter bus are normally started by the
  // classic UI; the workbench starts them here. startBridgePull is reference counted.
  prepareWorkflowRun();
  if (!bridgeStop) {
    void startBridgePull().then((stop) => {
      bridgeStop = stop;
    });
  }
  return {
    now: () => Date.now(),
    async sendableProviders() {
      const snapshot = await host.connections.get();
      return snapshot.filter(isSendable).map((state) => state.provider);
    },
    prepare: prepareProviderPage,
    async newSession(provider) {
      await host.provider.newSession(provider);
      // Give the page a moment to navigate to its blank conversation before the first send.
      await sleep(2_000);
      const deadline = Date.now() + PAGE_READY_TIMEOUT_MS;
      for (;;) {
        const state = await stateOf(provider);
        if (state && isSendable(state)) return;
        if (Date.now() > deadline) throw new Error(`${provider} page did not become ready after starting a new conversation.`);
        await sleep(POLL_MS);
      }
    },
    async send(provider, text) {
      const { response } = await sendAndWait(provider, text);
      return response;
    },
    async stop(provider) {
      await stopProvider(provider);
    },
    async readConversationUrl(provider) {
      const raw = await host.provider.evalWithCallback(provider, 'location.href');
      try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'string' ? parsed : undefined;
      } catch {
        return raw.startsWith('http') ? raw : undefined;
      }
    },
  };
}
