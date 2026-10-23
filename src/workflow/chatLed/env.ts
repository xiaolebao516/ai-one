import type { ProviderInstance, ProviderState } from '../../../shared/types';
import { providerInstanceBase } from '../../../shared/providerInstances';
import { sendAndWaitInstance, cancelInstanceSend } from './sendInstance';
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

async function stateOf(provider: ProviderInstance): Promise<ProviderState<ProviderInstance> | undefined> {
  const snapshot = await host.connections.getAll();
  return snapshot.find((state) => state.provider === provider);
}

async function readProviderUrl(provider: ProviderInstance): Promise<string | undefined> {
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
  provider: ProviderInstance,
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

let bridgeStart: Promise<void> | undefined;

/**
 * Makes sure the provider page exists (parked offscreen), is logged in and idle (busy gate, #15).
 * Does not touch shared workflow state, so cleanup can use it while nothing else is running.
 */
export async function prepareProviderPage(provider: ProviderInstance): Promise<void> {
  const state = await stateOf(provider);
  const previousStatusAt = state?.lastStatusAt ?? 0;
  if (!state || state.webview !== 'loaded') {
    if (provider === providerInstanceBase(provider)) resetProviderBootState(providerInstanceBase(provider));
    await host.provider.open(provider, parkedBounds());
  }
  // Workbench hides loaded views. They must be shown offscreen again to obtain live DOM status.
  await host.provider.park(provider, parkedBounds());
  await waitUntilFreshSendable(provider, previousStatusAt);
  // Busy gate (#15): never write into a page that is still generating something else.
  const idleDeadline = Date.now() + IDLE_TIMEOUT_MS;
  while ((await stateOf(provider))?.thinking) {
    if (Date.now() > idleDeadline) throw new Error(`${provider} stayed busy; not sending into a generating page.`);
    await sleep(POLL_MS);
  }
}

/**
 * Polls CHECK_STATUS until the page has reported a status newer than `previousStatusAt` and is
 * sendable. A page that was just opened, reloaded or given a new document refuses script evaluation
 * until its DOM is ready ("script evaluation is not ready"). That is a transient state, not a
 * failure: ask again on the next poll until the readiness deadline.
 */
async function waitUntilFreshSendable(provider: ProviderInstance, previousStatusAt: number): Promise<void> {
  const checkStatusScript = `window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch(${JSON.stringify({ v: 1, action: "CHECK_STATUS", provider: providerInstanceBase(provider) })})`;
  const readyDeadline = Date.now() + PAGE_READY_TIMEOUT_MS;
  for (;;) {
    try {
      await host.provider.eval(provider, checkStatusScript);
    } catch {
      // not ready yet
    }
    const state = await stateOf(provider);
    const fresh = Boolean(state && state.lastStatusAt > previousStatusAt);
    if (state && fresh && isSendable({ ...state, provider: providerInstanceBase(state.provider) })) return;
    if (Date.now() > readyDeadline) {
      if (state?.login === 'logged_out' || state?.login === 'blocked') {
        throw new Error(`${provider} is not logged in (state: ${state.login}). Log in from the classic UI or Resources page first.`);
      }
      throw new Error(`${provider} page did not become ready in time.`);
    }
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
      const snapshot = await host.connections.getAll();
      return snapshot.filter((state) => isSendable({ ...state, provider: providerInstanceBase(state.provider) })).map((state) => state.provider);
    },
    prepare: prepareProviderPage,
    async newSession(provider) {
      // No await before newSession: the controller's stop/timeout checks happen right before this call,
      // and a slower state read here would reopen a window in which a cancelled run still creates a session.
      const startedAt = Date.now();
      await host.provider.newSession(provider);
      // A site that loads a whole new document (Gemini) reports status again only once its page has
      // booted; evaluating or sending before that fails with "script evaluation is not ready". Status
      // timestamps come from the same machine clock, so "newer than startedAt" means "after this call".
      await waitUntilFreshSendable(provider, startedAt);
      // Capture the native new-document acknowledgement, including its still-blank URL.
      const raw = await host.provider.evalWithCallback(provider, 'JSON.stringify({url: location.href, documentId: window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.bootId})');
      let snapshot: unknown = JSON.parse(raw);
      if (typeof snapshot === 'string') snapshot = JSON.parse(snapshot);
      if (!snapshot || typeof snapshot !== 'object') throw new Error('New document acknowledgement is missing.');
      const page = snapshot as { url?: unknown; documentId?: unknown };
      if (typeof page.url !== 'string' || typeof page.documentId !== 'string' || !page.documentId) throw new Error('New document identity is missing.');
      return { url: page.url, documentId: page.documentId, freshDocument: true };
    },
    async send(provider, text) {
      if (provider === providerInstanceBase(provider)) {
        const { response } = await sendAndWait(providerInstanceBase(provider), text);
        return response;
      }
      return sendAndWaitInstance(provider, text);
    },
    async stop(provider) {
      if (provider === providerInstanceBase(provider)) await stopProvider(providerInstanceBase(provider));
      else {
        cancelInstanceSend(provider);
        await host.provider.stop(provider);
      }
    },
    async readConversationUrl(provider) {
      return (await readProviderUrlBounded(provider)).url;
    },
    async readDocumentId(provider) {
      const raw = await host.provider.evalWithCallback(provider, 'window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.bootId');
      const value: unknown = JSON.parse(raw);
      return typeof value === 'string' ? value : undefined;
    },
  };
}
