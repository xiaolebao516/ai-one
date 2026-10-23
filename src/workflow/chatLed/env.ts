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

async function readProviderUrl(provider: AIProvider): Promise<string | undefined> {
  const raw = await host.provider.evalWithCallback(provider, 'location.href');
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return raw.startsWith('http') ? raw : undefined;
  }
}

interface BoundedUrlRead {
  url: string | undefined;
  timedOut: boolean;
}

async function readProviderUrlBounded(
  provider: AIProvider,
  timeoutMs = 2_000,
): Promise<BoundedUrlRead> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      readProviderUrl(provider).then(
        (url) => ({ url, timedOut: false }),
        () => ({ url: undefined, timedOut: false }),
      ),
      new Promise<BoundedUrlRead>((resolve) => {
        timer = globalThis.setTimeout(() => resolve({ url: undefined, timedOut: true }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}

function hasConversationPath(url: string): boolean {
  try {
    return new URL(url).pathname.length > 1;
  } catch {
    return false;
  }
}

function sameConversation(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return false;
  }
}

let bridgeStart: Promise<void> | undefined;

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
  return {
    now: () => Date.now(),
    async initialize() {
      // Do not reset shared workflow state or start asynchronous bridge work during create().
      // start() awaits this hook, so subscription failures become a visible startup failure.
      prepareWorkflowRun();
      if (!bridgeStart) {
        bridgeStart = startBridgePull().then(
          () => undefined,
          (error: unknown) => {
            bridgeStart = undefined;
            throw error;
          },
        );
      }
      await bridgeStart;
    },
    async sendableProviders() {
      const snapshot = await host.connections.get();
      return snapshot.filter(isSendable).map((state) => state.provider);
    },
    prepare: prepareProviderPage,
    async newSession(provider, previousUrl) {
      await host.provider.newSession(provider);
      // Capture the first changed conversation URL before the separate readiness check.
      // If navigation never changes, return the observed URL and let the controller fail closed.
      const deadline = Date.now() + 10_000;
      let url: string | undefined;
      do {
        await sleep(250);
        const read = await readProviderUrlBounded(provider, Math.min(2_000, Math.max(1, deadline - Date.now())));
        if (read.timedOut) return { url: undefined };
        url = read.url;
        if (url && hasConversationPath(url) && (!previousUrl || !sameConversation(previousUrl, url))) {
          return { url };
        }
      } while (Date.now() < deadline);
      return { url };
    },
    async send(provider, text) {
      const { response } = await sendAndWait(provider, text);
      return response;
    },
    async stop(provider) {
      await stopProvider(provider);
    },
    async readConversationUrl(provider) {
      return (await readProviderUrlBounded(provider)).url;
    },
  };
}
