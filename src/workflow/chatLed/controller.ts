import type { AIProvider } from '../../../shared/types';
import {
  applyCoordinatorReply,
  beginSessionInitialization,
  closeRun,
  createRun,
  extendRoundLimit,
  failProvider,
  finishSessionInitialization,
  hasPendingInitialization,
  pauseRun,
  recordCleanup,
  recordExport,
  registerConversation,
  resumeAfterStop,
  resumeRun,
  settledFeedbackItems,
  setAvailableProviders,
  setInitializationPending,
  startRun,
  stopRun,
  updateForward,
} from './machine';
import { buildFeedbackPrompt, buildIntroPrompt, buildViolationReminder, PROVIDER_LABELS } from './protocol';
import { providerResponseError } from '../providerResponse';
import type { ChatLedRun, CleanupItemResult, ForwardRecord, SessionInitializationStatus } from './types';
import { DEFAULT_COORDINATOR, DEFAULT_ROUND_LIMIT } from './types';

export const CHAT_LED_URL_READ_TIMEOUT_MS = 3_000;
export const CHAT_LED_INIT_SETTLE_TIMEOUT_MS = 5_000;
export const CHAT_LED_STOP_WAIT_TIMEOUT_MS = 5_000;

type Listener = (run: ChatLedRun) => void;
type InitStage = 'before-url' | 'creating' | 'after-url';

interface SessionInitAttempt {
  id: string;
  provider: AIProvider;
  stage: InitStage;
  finalized: boolean;
  promise: Promise<void>;
}

function waitWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs);
    promise.then(
      () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(true);
      },
      () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

function readUrlWithin(env: ChatLedEnv, provider: AIProvider): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof globalThis.setTimeout>;
    const finish = (url: string | undefined) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(url);
    };
    timer = globalThis.setTimeout(() => finish(undefined), CHAT_LED_URL_READ_TIMEOUT_MS);
    Promise.resolve()
      .then(() => env.readConversationUrl(provider))
      .then(
        (url) => finish(typeof url === 'string' ? url : undefined),
        () => finish(undefined),
      );
  });
}

/** The controller needs only explicit provider I/O; tests can inject deterministic fakes. */
export interface ChatLedEnv {
  now(): number;
  /** Await bridge/runtime initialization before touching provider pages. */
  initialize?(): Promise<void>;
  /** Providers that can be addressed right now (loaded, DOM ready, logged in). */
  sendableProviders(): Promise<AIProvider[]>;
  /** Make sure the provider page exists (parked offscreen) and is idle (busy gate, #15). */
  prepare(provider: AIProvider): Promise<void>;
  /** Create a session and capture the URL observed immediately after its navigation. */
  newSession(provider: AIProvider, previousUrl?: string): Promise<void | { url?: string }>;
  /** Send complete text, resolve with the complete reply. Must reject on failure/timeout. */
  send(provider: AIProvider, text: string): Promise<string>;
  /** Best effort: ask a still-generating provider to stop (used by stop). */
  stop(provider: AIProvider): Promise<void>;
  /** Conversation address of the provider page, undefined when unreadable. */
  readConversationUrl(provider: AIProvider): Promise<string | undefined>;
}

export interface ChatLedStartInput {
  id: string;
  goal: string;
  coordinator?: AIProvider;
  /** Candidate targets; only those prepared and confirmed sendable are offered to the coordinator. */
  candidates: readonly AIProvider[];
  roundLimit?: number;
}

/** Drives one chat-led run (#113), with pure state transitions and bounded provider I/O. */
export class ChatLedController {
  private run: ChatLedRun;
  private readonly listeners = new Set<Listener>();
  private readonly candidates: readonly AIProvider[];
  private generation = 0;
  private resumeWaiters: (() => void)[] = [];
  private stopWaiters: (() => void)[] = [];
  private driving = false;
  private initSequence = 0;
  private readonly preparingProviders = new Set<AIProvider>();
  /** Each item covers a possible new-session side effect through address registration. */
  private readonly pendingInit = new Set<SessionInitAttempt>();
  /** Startup preparation is bounded by stop(), even if a host readiness call never returns. */
  private startupOperation: Promise<boolean> | undefined;

  constructor(
    private readonly env: ChatLedEnv,
    run: ChatLedRun,
    candidates: readonly AIProvider[] = run.available,
  ) {
    this.run = run;
    this.candidates = [...new Set(candidates)];
  }

  /** Controller creation is I/O-free; readiness runs after start acquires the active-run lock. */
  static create(env: ChatLedEnv, input: ChatLedStartInput): Promise<ChatLedController> {
    const run = createRun({
      id: input.id,
      goal: input.goal,
      coordinator: input.coordinator ?? DEFAULT_COORDINATOR,
      available: [],
      roundLimit: input.roundLimit ?? DEFAULT_ROUND_LIMIT,
      now: env.now(),
    });
    return Promise.resolve(new ChatLedController(env, run, input.candidates));
  }

  getRun(): ChatLedRun {
    return this.run;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: ChatLedRun): void {
    if (next === this.run) return;
    this.run = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  private get stopped(): boolean {
    return this.run.phase === 'stopped';
  }

  private isLive(generation: number): boolean {
    return generation === this.generation && !this.stopped;
  }

  /** Prepare coordinator and candidates before reading the confirmed sendable list. */
  async start(): Promise<void> {
    if (this.run.phase !== 'idle') return;
    const generation = this.generation;
    this.set(setInitializationPending(startRun(this.run, this.env.now()), true, this.env.now()));

    const startup = this.prepareProviders(generation);
    this.startupOperation = startup;
    let ready = false;
    try {
      ready = await startup;
    } catch (error) {
      if (this.isLive(generation)) {
        this.set(failProvider(this.run, this.run.coordinator, errorMessage(error), this.env.now()));
      }
    } finally {
      if (this.startupOperation === startup) this.startupOperation = undefined;
      this.set(setInitializationPending(this.run, false, this.env.now()));
    }
    if (!ready || !this.isLive(generation)) return;

    const intro = buildIntroPrompt({
      goal: this.run.goal,
      coordinator: this.run.coordinator,
      available: this.run.available.map((provider) => ({ provider, label: PROVIDER_LABELS[provider] ?? provider })),
      roundLimit: this.run.roundLimit,
    });
    await this.drive(intro);
  }

  private async prepareProviders(generation: number): Promise<boolean> {
    const live = () => this.isLive(generation);
    const coordinator = this.run.coordinator;
    const failures: string[] = [];
    const prepared = new Set<AIProvider>();

    try {
      await this.env.initialize?.();
      if (!(await this.waitWhilePaused()) || !live()) return false;

      const providers = [...new Set([coordinator, ...this.candidates.filter((provider) => provider !== coordinator)])];
      for (const provider of providers) {
        if (!(await this.waitWhilePaused()) || !live()) return false;
        this.preparingProviders.add(provider);
        try {
          await this.env.prepare(provider);
          if (!live()) return false;
          prepared.add(provider);
        } catch (error) {
          if (!live()) return false;
          if (provider === coordinator) {
            this.set(failProvider(this.run, coordinator, errorMessage(error), this.env.now()));
            return false;
          }
          failures.push(provider + ': ' + errorMessage(error));
        } finally {
          this.preparingProviders.delete(provider);
        }
      }

      if (!(await this.waitWhilePaused()) || !live()) return false;
      const sendable = new Set(await this.env.sendableProviders());
      if (!live()) return false;
      if (!prepared.has(coordinator) || !sendable.has(coordinator)) {
        this.set(failProvider(
          this.run,
          coordinator,
          'Coordinator is not logged in or its page is not ready after preparation.',
          this.env.now(),
        ));
        return false;
      }

      const available = [...new Set(this.candidates.filter(
        (provider) => provider !== coordinator && prepared.has(provider) && sendable.has(provider),
      ))];
      if (available.length === 0) {
        const detail = failures.length > 0 ? ' Preparation failures: ' + failures.join('; ') : '';
        this.set(failProvider(
          this.run,
          coordinator,
          'No candidate target AI is confirmed logged in and ready. Log in manually, then start a new run.' + detail,
          this.env.now(),
        ));
        return false;
      }

      this.set(setAvailableProviders(this.run, available, this.env.now()));
      return true;
    } catch (error) {
      if (live()) this.set(failProvider(this.run, coordinator, errorMessage(error), this.env.now()));
      return false;
    }
  }

  pause(): void {
    this.set(pauseRun(this.run, this.env.now()));
  }

  resume(): void {
    this.set(resumeRun(this.run, this.env.now()));
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const wake of waiters) wake();
  }

  /** Stop immediately, then give creation/address registration a bounded chance to settle. */
  async stop(): Promise<void> {
    const inFlight = this.run.forwards
      .filter((forward) => forward.status === 'sending' || forward.status === 'waiting')
      .map((forward) => forward.to);
    const coordinatorBusy =
      this.run.phase === 'coordinator-thinking' ||
      (this.run.phase === 'paused' && this.run.pausedFrom === 'coordinator-thinking');
    this.generation += 1;
    this.set(stopRun(this.run, this.env.now()));
    for (const wake of this.resumeWaiters.splice(0)) wake();
    for (const wake of this.stopWaiters.splice(0)) wake();

    const targets = new Set<AIProvider>([
      ...inFlight,
      ...this.preparingProviders,
      ...[...this.pendingInit].map((attempt) => attempt.provider),
    ]);
    if (coordinatorBusy) targets.add(this.run.coordinator);
    const stops = Promise.all([...targets].map((provider) => {
      try {
        return Promise.resolve(this.env.stop(provider)).catch(() => undefined);
      } catch {
        return Promise.resolve();
      }
    }));

    await this.settleInit();
    await waitWithin(stops, CHAT_LED_STOP_WAIT_TIMEOUT_MS);
  }

  hasPendingSessions(): boolean {
    return hasPendingInitialization(this.run) || this.pendingInit.size > 0;
  }

  apply(transition: (run: ChatLedRun) => ChatLedRun): void {
    this.set(transition(this.run));
  }

  markExported(): void {
    this.set(recordExport(this.run, this.env.now()));
  }

  recordCleanupResults(results: CleanupItemResult[]): void {
    this.set(recordCleanup(this.run, results, this.env.now()));
  }

  markClosed(exportedMarkdown: boolean): void {
    if (this.hasPendingSessions()) return;
    this.set(closeRun(this.run, exportedMarkdown, this.env.now()));
  }

  private async waitWhilePaused(): Promise<boolean> {
    while (this.run.phase === 'paused') {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    }
    return !this.stopped;
  }

  private async settleInit(): Promise<void> {
    const attempts = [...this.pendingInit];
    const startup = this.startupOperation;
    const waits: Promise<unknown>[] = attempts.map((attempt) => attempt.promise);
    if (startup) waits.push(startup);
    await waitWithin(Promise.allSettled(waits), CHAT_LED_INIT_SETTLE_TIMEOUT_MS);

    for (const attempt of [...this.pendingInit]) {
      if (attempt.finalized) continue;
      const sideEffectPossible = attempt.stage === 'creating' || attempt.stage === 'after-url';
      this.finishSessionAttempt(
        attempt,
        sideEffectPossible ? 'manual' : 'not-created',
        undefined,
        sideEffectPossible
          ? 'Stop timed out while session creation/address registration was in flight; check the provider manually.'
          : 'Stopped before newSession was invoked; no session was created by this attempt.',
      );
    }
    if (startup && this.startupOperation === startup) this.startupOperation = undefined;
    this.set(setInitializationPending(this.run, false, this.env.now()));
  }

  async remind(): Promise<void> {
    const stop = this.run.stop;
    if (!stop || this.driving || this.run.available.length === 0) return;
    const text =
      stop.type === 'protocol-violation'
        ? buildViolationReminder(stop.violation.code)
        : buildViolationReminder('no-directive');
    const next = resumeAfterStop(this.run, this.env.now());
    if (next === this.run) return;
    this.set(next);
    await this.drive(text);
  }

  async extendLimit(extra: number): Promise<void> {
    if (this.driving) return;
    const next = extendRoundLimit(this.run, extra, this.env.now());
    if (next === this.run) return;
    this.set(next);
    await this.drive(buildViolationReminder('no-directive'));
  }

  private async drive(firstText: string): Promise<void> {
    if (this.driving) return;
    this.driving = true;
    const generation = this.generation;
    const live = () => this.isLive(generation);
    try {
      let text = firstText;
      for (;;) {
        if (!(await this.waitWhilePaused()) || !live()) return;
        const coordinator = this.run.coordinator;
        let reply: string;
        try {
          reply = await this.sendOwned(coordinator, text, live);
        } catch (error) {
          if (!live()) return;
          this.set(failProvider(this.run, coordinator, errorMessage(error), this.env.now()));
          return;
        }
        if (!(await this.waitWhilePaused()) || !live()) return;
        const applied = applyCoordinatorReply(this.run, reply, this.env.now());
        this.set(applied.run);
        if (applied.parsed.kind !== 'send' || this.run.phase !== 'forwarding') return;
        const round = this.run.round;
        await this.forwardRound(round, live);
        if (!live()) return;
        const items = settledFeedbackItems(this.run, round);
        if (!items) return;
        text = buildFeedbackPrompt(items, round, Math.max(0, this.run.roundLimit - this.run.round));
        this.set(resumeAfterForwarding(this.run, this.env.now()));
      }
    } finally {
      this.driving = false;
    }
  }

  private async forwardRound(round: number, live: () => boolean): Promise<void> {
    const queued = this.run.forwards.filter((forward) => forward.round === round && forward.status === 'queued');
    await Promise.all(queued.map((forward) => this.forwardOne(forward, live)));
  }

  private async forwardOne(forward: ForwardRecord, live: () => boolean): Promise<void> {
    const patch = (p: Partial<ForwardRecord>) => {
      if (live()) this.set(updateForward(this.run, forward.id, p, this.env.now()));
    };
    try {
      if (!(await this.waitWhilePaused()) || !live()) return;
      patch({ status: 'sending', startedAt: this.env.now() });
      const sendable = await this.env.sendableProviders();
      if (!sendable.includes(forward.to)) throw new Error('Target AI is not logged in or its page is not ready.');
      patch({ status: 'waiting' });
      const reply = await this.sendOwned(forward.to, forward.message, live);
      if (!live()) return;
      patch({ status: 'done', reply, replyChars: reply.length, finishedAt: this.env.now() });
    } catch (error) {
      patch({ status: 'failed', error: errorMessage(error), finishedAt: this.env.now() });
    }
  }

  private async sendOwned(provider: AIProvider, text: string, live: () => boolean): Promise<string> {
    let rejectStopped!: (reason: Error) => void;
    const stopped = new Promise<never>((_, reject) => {
      rejectStopped = reject;
    });
    const stopWaiter = () => rejectStopped(new Error('Run stopped by user'));
    this.stopWaiters.push(stopWaiter);
    const proceed = async (): Promise<void> => {
      if (!(await this.waitWhilePaused()) || !live()) throw new Error('Run stopped by user');
    };

    const work = (async (): Promise<string> => {
      await proceed();
      await this.env.prepare(provider);
      await proceed();

      const owned = this.run.conversations.find(
        (conversation) =>
          conversation.provider === provider &&
          conversation.registrationStatus !== 'manual' &&
          hasConversationPath(conversation.url),
      );
      if (owned) {
        const current = await readUrlWithin(this.env, provider);
        await proceed();
        if (!current || !sameConversation(current, owned.url)) {
          throw new Error('The page is no longer on the conversation ai-one created; not sending.');
        }
      } else {
        const attempt = this.beginSessionAttempt(provider);
        const init = this.initializeSession(attempt, live, proceed);
        const initDone = init.finally(() => {
          this.pendingInit.delete(attempt);
          this.notify();
        });
        attempt.promise = initDone;
        initDone.catch(() => undefined);
        await initDone;
        await proceed();
      }

      const response = await this.env.send(provider, text);
      const providerError = providerResponseError(provider, response);
      if (providerError) throw providerError;
      return response;
    })();
    work.catch(() => undefined);

    try {
      return await Promise.race([work, stopped]);
    } finally {
      const index = this.stopWaiters.indexOf(stopWaiter);
      if (index >= 0) this.stopWaiters.splice(index, 1);
    }
  }

  private beginSessionAttempt(provider: AIProvider): SessionInitAttempt {
    const id = this.run.id + ':' + provider + ':' + String(++this.initSequence);
    const attempt: SessionInitAttempt = {
      id,
      provider,
      stage: 'before-url',
      finalized: false,
      promise: Promise.resolve(),
    };
    this.pendingInit.add(attempt);
    this.set(beginSessionInitialization(this.run, id, provider, this.env.now()));
    return attempt;
  }

  private async initializeSession(
    attempt: SessionInitAttempt,
    live: () => boolean,
    proceed: () => Promise<void>,
  ): Promise<void> {
    let beforeUrl: string | undefined;
    try {
      await proceed();
      attempt.stage = 'before-url';
      beforeUrl = await readUrlWithin(this.env, attempt.provider);
      if (attempt.finalized) return;
      if (!live()) {
        this.finishSessionAttempt(attempt, 'not-created', undefined, 'Stopped before newSession was invoked.');
        throw new Error('Run stopped by user');
      }

      attempt.stage = 'creating';
      let creationFailed = false;
      let creationError: unknown;
      let createdUrl: string | undefined;
      let hasCreationSnapshot = false;
      try {
        const result = await this.env.newSession(attempt.provider, beforeUrl);
        if (result && typeof result === 'object') {
          hasCreationSnapshot = true;
          createdUrl = result.url;
        }
      } catch (error) {
        creationFailed = true;
        creationError = error;
      }
      if (attempt.finalized) return;

      attempt.stage = 'after-url';
      if (creationFailed) {
        this.finishSessionAttempt(
          attempt,
          'manual',
          undefined,
          'newSession failed after it may have created a page; check the provider manually.',
        );
        throw creationError;
      }

      const afterUrl = await readUrlWithin(this.env, attempt.provider);
      if (attempt.finalized) return;
      // The real environment supplies a URL snapshot taken as part of newSession. If the page has
      // since changed, do not register that arbitrary current URL as a session owned by this run.
      const candidateUrl = hasCreationSnapshot ? createdUrl : afterUrl;
      const creationAddressConfirmed = Boolean(
        beforeUrl &&
        candidateUrl &&
        afterUrl &&
        hasConversationPath(candidateUrl) &&
        !sameConversation(beforeUrl, candidateUrl) &&
        sameConversation(candidateUrl, afterUrl),
      );
      if (!creationAddressConfirmed || !candidateUrl) {
        this.finishSessionAttempt(
          attempt,
          'manual',
          undefined,
          'Session creation was attempted, but its ownership/address could not be confirmed; check manually.',
        );
        throw new Error('Could not confirm a new conversation address; not sending to an unverified page.');
      }
      if (!live()) throw new Error('Run stopped by user');

      // Keep initialization pending through readiness and a second URL check. A readiness failure
      // must leave a manual record rather than releasing an unverified session to cleanup.
      this.preparingProviders.add(attempt.provider);
      try {
        await this.env.prepare(attempt.provider);
      } finally {
        this.preparingProviders.delete(attempt.provider);
      }
      if (attempt.finalized) return;
      if (!live()) throw new Error('Run stopped by user');

      const readyUrl = await readUrlWithin(this.env, attempt.provider);
      if (attempt.finalized) return;
      if (!live()) throw new Error('Run stopped by user');
      if (!readyUrl || !hasConversationPath(readyUrl) || !sameConversation(candidateUrl, readyUrl)) {
        this.finishSessionAttempt(
          attempt,
          'manual',
          undefined,
          'The new session did not remain on the confirmed address after readiness; check manually.',
        );
        throw new Error('Could not re-confirm the new conversation address after readiness.');
      }

      this.finishSessionAttempt(attempt, 'registered', candidateUrl, 'New conversation address was confirmed after readiness.');
      await proceed();
    } catch (error) {
      if (!attempt.finalized) {
        const sideEffectPossible = attempt.stage === 'creating' || attempt.stage === 'after-url';
        this.finishSessionAttempt(
          attempt,
          sideEffectPossible ? 'manual' : 'not-created',
          undefined,
          sideEffectPossible
            ? 'Session creation may have occurred, but its address could not be confirmed; check manually.'
            : 'Stopped or failed before creating a new session.',
        );
      }
      throw error;
    }
  }

  private finishSessionAttempt(
    attempt: SessionInitAttempt,
    status: Exclude<SessionInitializationStatus, 'pending'>,
    url: string | undefined,
    note: string,
  ): void {
    if (attempt.finalized) return;
    attempt.finalized = true;
    this.pendingInit.delete(attempt);
    let next = this.run;
    if (status === 'registered' && url) {
      next = registerConversation(next, {
        provider: attempt.provider,
        url,
        createdByAiOne: true,
        registrationStatus: 'confirmed',
      }, this.env.now());
    } else if (status === 'manual') {
      // Empty URL is intentional: cleanup planning can only produce a manual item for this record.
      // Never attach the current page URL unless it was proven to be a new conversation.
      next = registerConversation(next, {
        provider: attempt.provider,
        url: '',
        createdByAiOne: true,
        registrationStatus: 'manual',
      }, this.env.now());
    }
    next = finishSessionInitialization(next, attempt.id, status, this.env.now(), {
      ...(status === 'registered' && url ? { url } : {}),
      note,
    });
    this.set(next);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener(this.run);
  }
}

function resumeAfterForwarding(run: ChatLedRun, now: number): ChatLedRun {
  if (run.phase !== 'forwarding') return run;
  return { ...run, phase: 'coordinator-thinking', updatedAt: now };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A bare site address (no path) is not a conversation address. */
function hasConversationPath(url: string): boolean {
  try {
    return new URL(url).pathname.length > 1;
  } catch {
    return false;
  }
}

/** Same conversation = same origin and path; query and hash do not matter. */
function sameConversation(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return false;
  }
}
