import type { AIProvider, ProviderInstance } from '../../../shared/types';
import { providerInstanceBase, providerInstanceName } from '../../../shared/providerInstances';
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
  resetAutoRemindersAfterForward,
  scheduleAutoReminder,
  settledFeedbackItems,
  setAvailableProviders,
  appendLog,
  setInitializationPending,
  startRun,
  stopRun,
  updateForward,
} from './machine';
import { buildFeedbackPrompt, buildIntroPrompt, buildViolationReminder, goalNamesProvider, PROVIDER_LABELS } from './protocol';
import { providerResponseError } from '../providerResponse';
import type { ChatLedMode, ChatLedRun, CleanupItemResult, ForwardRecord, SessionInitializationStatus } from './types';
import { DEFAULT_COORDINATOR, DEFAULT_ROUND_LIMIT } from './types';

export const CHAT_LED_URL_READ_TIMEOUT_MS = 3_000;
export const CHAT_LED_INIT_SETTLE_TIMEOUT_MS = 5_000;
export const CHAT_LED_STOP_WAIT_TIMEOUT_MS = 5_000;
export const CHAT_LED_FORWARD_TIMEOUT_MS = 180_000;

class ForwardTimeoutError extends Error {}

type Listener = (run: ChatLedRun) => boolean | void;
type InitStage = 'before-url' | 'creating' | 'after-url';

interface SessionInitAttempt {
  id: string;
  provider: ProviderInstance;
  stage: InitStage;
  finalized: boolean;
  promise: Promise<void>;
  blankUrl?: string;
  documentId?: string;
  confirmedUrl?: string;
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

function readUrlWithin(env: ChatLedEnv, provider: ProviderInstance, documentId = false): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (url: string | undefined) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(url);
    };
    const timer = globalThis.setTimeout(() => finish(undefined), CHAT_LED_URL_READ_TIMEOUT_MS);
    Promise.resolve()
      .then(() => documentId ? env.readDocumentId?.(provider) : env.readConversationUrl(provider))
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
  sendableProviders(): Promise<ProviderInstance[]>;
  /** Make sure the provider page exists (parked offscreen) and is idle (busy gate, #15). */
  prepare(provider: ProviderInstance): Promise<void>;
  /** Create a session and capture the URL observed immediately after its navigation. */
  newSession(provider: ProviderInstance, previousUrl?: string): Promise<void | { url?: string; freshDocument?: boolean; documentId?: string }>;
  /** Send complete text, resolve with the complete reply. Must reject on failure/timeout. */
  send(provider: ProviderInstance, text: string): Promise<string>;
  /** Best effort: ask a still-generating provider to stop (used by stop). */
  stop(provider: ProviderInstance): Promise<void>;
  /** Conversation address of the provider page, undefined when unreadable. */
  readConversationUrl(provider: ProviderInstance): Promise<string | undefined>;
  readDocumentId?(provider: ProviderInstance): Promise<string | undefined>;
}

export interface ChatLedStartInput {
  id: string;
  goal: string;
  coordinator?: AIProvider;
  /** Candidate targets; only those prepared and confirmed sendable are offered to the coordinator. */
  candidates: readonly ProviderInstance[];
  roundLimit?: number;
  mode?: ChatLedMode;
  workers?: 0 | 1 | 2;
}

/** Drives one chat-led run (#113), with pure state transitions and bounded provider I/O. */
export class ChatLedController {
  private run: ChatLedRun;
  private readonly listeners = new Set<Listener>();
  private readonly candidates: readonly ProviderInstance[];
  private generation = 0;
  private resumeWaiters: (() => void)[] = [];
  private stopWaiters: (() => void)[] = [];
  private driving = false;
  /** Sticky: once a checkpoint fails, this controller never performs further provider I/O. */
  private persistenceFailed = false;
  private initSequence = 0;
  private readonly preparingProviders = new Set<ProviderInstance>();
  /** Each item covers a possible new-session side effect through address registration. */
  private readonly pendingInit = new Set<SessionInitAttempt>();
  /** Startup preparation is bounded by stop(), even if a host readiness call never returns. */
  private startupOperation: Promise<boolean> | undefined;

  constructor(
    private readonly env: ChatLedEnv,
    run: ChatLedRun,
    candidates: readonly ProviderInstance[] = run.available,
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
      mode: input.mode ?? 'general',
      workers: input.workers ?? 0,
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

  private log(entry: Parameters<typeof appendLog>[1]): void {
    this.set(appendLog(this.run, entry, this.env.now()));
  }

  private set(next: ChatLedRun): void {
    if (next === this.run) return;
    this.run = next;
    this.notify();
  }

  private assertPersisted(): void {
    if (this.persistenceFailed) {
      throw new Error('Run state could not be saved; stopping provider I/O to protect session ownership.');
    }
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
    try {
      this.assertPersisted();
    } catch (error) {
      if (this.isLive(generation)) {
        this.set(failProvider(this.run, this.run.coordinator, errorMessage(error), this.env.now()));
      }
      this.set(setInitializationPending(this.run, false, this.env.now()));
      return;
    }

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
      available: this.run.available.map((provider) => ({ provider, label: providerInstanceName(provider, PROVIDER_LABELS) })),
      unavailable: (this.run.unavailable ?? []).map(({ provider, reason }) => ({
        provider,
        label: providerInstanceName(provider, PROVIDER_LABELS),
        reason,
      })),
      roundLimit: this.run.roundLimit,
      mode: this.run.mode ?? 'general',
    });
    await this.drive(intro);
  }

  private async prepareProviders(generation: number): Promise<boolean> {
    const live = () => this.isLive(generation);
    const coordinator = this.run.coordinator;
    const failures = new Map<ProviderInstance, string>();
    const prepared = new Set<ProviderInstance>();

    try {
      this.assertPersisted();
      await this.env.initialize?.();
      this.assertPersisted();
      if (!(await this.waitWhilePaused()) || !live()) return false;

      const providers = [...new Set([coordinator, ...this.candidates.filter((provider) => provider !== coordinator)])];
      for (const provider of providers) {
        if (!(await this.waitWhilePaused()) || !live()) return false;
        this.preparingProviders.add(provider);
        this.log({ kind: 'event', event: 'prepare-start', provider });
        try {
          this.assertPersisted();
          await this.env.prepare(provider);
          this.assertPersisted();
          if (!live()) return false;
          prepared.add(provider);
          this.log({ kind: 'event', event: 'prepare-ok', provider });
        } catch (error) {
          if (!live()) return false;
          this.log({ kind: 'event', event: 'prepare-failed', provider, detail: errorMessage(error) });
          if (provider === coordinator) {
            this.set(failProvider(this.run, coordinator, errorMessage(error), this.env.now()));
            return false;
          }
          failures.set(provider, errorMessage(error));
        } finally {
          this.preparingProviders.delete(provider);
        }
      }

      if (!(await this.waitWhilePaused()) || !live()) return false;
      this.assertPersisted();
      const sendable = new Set(await this.env.sendableProviders());
      this.assertPersisted();
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
        const detail = failures.size > 0
          ? ' Preparation failures: ' + [...failures].map(([provider, reason]) => provider + ': ' + reason).join('; ')
          : '';
        this.set(failProvider(
          this.run,
          coordinator,
          'No candidate target AI is confirmed logged in and ready. Log in manually, then start a new run.' + detail,
          this.env.now(),
        ));
        return false;
      }

      // Never drop a candidate silently: the user and the coordinator both see who is missing and why (#189).
      const unavailable = this.candidates
        .filter((provider) => provider !== coordinator && !available.includes(provider) && goalNamesProvider(this.run.goal, provider))
        .map((provider) => ({ provider, reason: failures.get(provider) ?? 'Not logged in or the page is not ready.' }));
      this.set(setAvailableProviders(this.run, available, this.env.now(), unavailable));
      this.log({ kind: 'event', event: 'targets-ready', detail: available.join(', ') });
      this.assertPersisted();
      return true;
    } catch (error) {
      if (live()) this.set(failProvider(this.run, coordinator, errorMessage(error), this.env.now()));
      return false;
    }
  }

  pause(): void {
    const next = pauseRun(this.run, this.env.now());
    if (next === this.run) return;
    this.set(next);
    this.log({ kind: 'event', event: 'paused' });
  }

  resume(): void {
    const next = resumeRun(this.run, this.env.now());
    if (next !== this.run) {
      this.set(next);
      this.log({ kind: 'event', event: 'resumed' });
    }
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
    const stoppedRun = stopRun(this.run, this.env.now());
    if (stoppedRun !== this.run) {
      this.set(stoppedRun);
      this.log({ kind: 'event', event: 'stopped' });
    }
    for (const wake of this.resumeWaiters.splice(0)) wake();
    for (const wake of this.stopWaiters.splice(0)) wake();

    const targets = new Set<ProviderInstance>([
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
      let feedback: { round: number; remaining: number } | undefined;
      for (;;) {
        if (!(await this.waitWhilePaused()) || !live()) return;
        const coordinator = this.run.coordinator;
        this.log(feedback ? { kind: 'feedback', ...feedback } : { kind: 'to-coordinator', text });
        feedback = undefined;
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
        if (applied.parsed.kind === 'violation') {
          const reminder = buildViolationReminder(applied.parsed.code);
          const scheduled = scheduleAutoReminder(this.run, reminder, this.env.now());
          if (scheduled !== this.run) {
            this.set(scheduled);
            text = reminder;
            continue;
          }
          return;
        }
        if (applied.parsed.kind !== 'send' || this.run.phase !== 'forwarding') return;
        const round = this.run.round;
        await this.forwardRound(round, live);
        if (!live()) return;
        const items = settledFeedbackItems(this.run, round);
        if (!items) return;
        this.set(resetAutoRemindersAfterForward(this.run, round, this.env.now()));
        const remaining = Math.max(0, this.run.roundLimit - this.run.round);
        text = buildFeedbackPrompt(items, round, remaining);
        feedback = { round, remaining };
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
    if (!(await this.waitWhilePaused()) || !live()) return;
    patch({ status: 'sending', startedAt: this.env.now() });
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    // Once this target has timed out its late work must not start anything new (no session creation,
    // no send): a stalled prepare can return after the run has finished or the user has moved on.
    let timedOut = false;
    const forwardLive = () => !timedOut && live();
    const work = (async () => {
      this.assertPersisted();
      const sendable = await this.env.sendableProviders();
      this.assertPersisted();
      if (!forwardLive()) return;
      if (!sendable.includes(forward.to)) throw new Error('Target AI is not logged in or its page is not ready.');
      patch({ status: 'waiting' });
      const reply = await this.sendOwned(forward.to, forward.message, forwardLive);
      if (!forwardLive()) return;
      patch({ status: 'done', reply, replyChars: reply.length, finishedAt: this.env.now() });
    })();
    // A timed-out send can still finish later; it must never overwrite the settled timeout.
    work.catch(() => undefined);
    const deadline = new Promise<never>((_, reject) => {
      timer = globalThis.setTimeout(() => {
        timedOut = true;
        reject(new ForwardTimeoutError('Target AI exceeded the forwarding timeout.'));
      }, CHAT_LED_FORWARD_TIMEOUT_MS);
    });
    try {
      await Promise.race([work, deadline]);
    } catch (error) {
      if (error instanceof ForwardTimeoutError) {
        patch({ status: 'timed-out', error: error.message, finishedAt: this.env.now() });
        // An unresolved first send cannot prove its conversation address; keep cleanup manual.
        for (const attempt of [...this.pendingInit].filter((item) => item.provider === forward.to)) {
          this.finishSessionAttempt(
            attempt,
            'manual',
            undefined,
            'Forwarding timed out before session registration was confirmed; check this conversation manually.',
          );
        }
        if (live()) void Promise.resolve().then(() => this.env.stop(forward.to)).catch(() => undefined);
      } else {
        patch({ status: 'failed', error: errorMessage(error), finishedAt: this.env.now() });
      }
    } finally {
      if (timer !== undefined) globalThis.clearTimeout(timer);
    }
  }

  private async sendOwned(provider: ProviderInstance, text: string, live: () => boolean): Promise<string> {
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
      this.assertPersisted();
      await this.env.prepare(provider);
      this.assertPersisted();
      await proceed();

      const owned = this.run.conversations.find(
        (conversation) =>
          conversation.provider === provider &&
          conversation.registrationStatus !== 'manual' &&
          hasConversationPath(conversation.url),
      );
      let firstSend: SessionInitAttempt | undefined;
      let expectedUrl: string | undefined;
      let expectedDocumentId: string | undefined;

      if (owned) {
        expectedUrl = owned.url;
      } else {
        const attempt = this.beginSessionAttempt(provider);
        const init = this.initializeSession(attempt, live, proceed);
        const initDone = init.finally(() => {
          if (attempt.finalized) this.pendingInit.delete(attempt);
          this.notify();
        });
        attempt.promise = initDone;
        initDone.catch(() => undefined);
        await initDone;
        this.assertPersisted();
        await proceed();
        if (attempt.blankUrl) {
          firstSend = attempt;
          expectedUrl = attempt.blankUrl;
          expectedDocumentId = attempt.documentId;
        } else {
          expectedUrl = attempt.confirmedUrl;
        }
      }

      if (!expectedUrl) {
        throw new Error('The conversation address is not confirmed; not sending.');
      }

      // The last pause wait must happen BEFORE the final identity read. If another pause begins
      // while either read is pending, discard that snapshot and repeat after resume.
      for (;;) {
        await proceed();
        this.assertPersisted();
        const current = await readUrlWithin(this.env, provider);
        const documentId = expectedDocumentId !== undefined
          ? await readUrlWithin(this.env, provider, true)
          : undefined;
        if (!live()) throw new Error('Run stopped by user');
        if (this.run.phase === 'paused') continue;
        if (
          !current ||
          !sameConversation(current, expectedUrl) ||
          (expectedDocumentId !== undefined && documentId !== expectedDocumentId)
        ) {
          if (firstSend && !firstSend.finalized) {
            this.finishSessionAttempt(firstSend, 'manual', undefined, 'The fresh page changed before its first send; check manually.');
          }
          throw new Error('The page is no longer on the conversation ai-one created; not sending.');
        }
        break;
      }

      this.assertPersisted();
      const sending = this.env.send(provider, text);
      if (firstSend) firstSend.promise = sending.then(() => undefined, () => undefined);

      let response: string;
      try {
        response = await sending;
      } catch (error) {
        if (firstSend && !firstSend.finalized) await this.registerFirstSend(firstSend, live);
        throw error;
      }

      if (firstSend) await this.registerFirstSend(firstSend, live);
      this.assertPersisted();
      const providerError = providerResponseError(providerInstanceBase(provider), response);
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

  private beginSessionAttempt(provider: ProviderInstance): SessionInitAttempt {
    this.assertPersisted();
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
    try {
      this.assertPersisted();
    } catch (error) {
      this.finishSessionAttempt(attempt, 'not-created', undefined, 'Creation was not attempted because its intent could not be saved.');
      throw error;
    }
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
      this.assertPersisted();
      attempt.stage = 'before-url';
      beforeUrl = await readUrlWithin(this.env, attempt.provider);
      if (attempt.finalized) return;
      if (!live()) {
        this.finishSessionAttempt(attempt, 'not-created', undefined, 'Stopped before newSession was invoked.');
        throw new Error('Run stopped by user');
      }

      this.assertPersisted();
      attempt.stage = 'creating';
      let creationFailed = false;
      let creationError: unknown;
      let createdUrl: string | undefined;
      let hasCreationSnapshot = false;
      let freshDocument = false;
      let createdDocumentId: string | undefined;
      try {
        const result = await this.env.newSession(attempt.provider, beforeUrl);
        if (result && typeof result === 'object') {
          hasCreationSnapshot = true;
          createdUrl = result.url;
          freshDocument = result.freshDocument === true;
          createdDocumentId = result.documentId;
        }
      } catch (error) {
        creationFailed = true;
        creationError = error;
      }
      if (attempt.finalized) return;

      attempt.stage = 'after-url';
      this.assertPersisted();
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
      const blankPage = Boolean(freshDocument && createdDocumentId && candidateUrl && isBlankStart(attempt.provider, candidateUrl));
      if (freshDocument && !blankPage) {
        throw new Error('Native new-session acknowledgement is not a blank provider page.');
      }
      const creationAddressConfirmed = blankPage || Boolean(
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
        this.assertPersisted();
        await this.env.prepare(attempt.provider);
        this.assertPersisted();
      } finally {
        this.preparingProviders.delete(attempt.provider);
      }
      if (attempt.finalized) return;
      if (!live()) throw new Error('Run stopped by user');

      this.assertPersisted();
      const readyUrl = await readUrlWithin(this.env, attempt.provider);
      if (attempt.finalized) return;
      if (!live()) throw new Error('Run stopped by user');
      if (!readyUrl || (!blankPage && !hasConversationPath(readyUrl)) || !sameConversation(candidateUrl, readyUrl)) {
        this.finishSessionAttempt(
          attempt,
          'manual',
          undefined,
          'The new session did not remain on the confirmed address after readiness; check manually.',
        );
        throw new Error('Could not re-confirm the new conversation address after readiness.');
      }

      if (blankPage) {
        attempt.blankUrl = candidateUrl;
        attempt.documentId = createdDocumentId;
        // The provider creates its conversation ID only after the first prompt is accepted.
        // Keep the attempt pending through that send instead of requiring an ID prematurely.
      } else {
        this.finishSessionAttempt(attempt, 'registered', candidateUrl, 'New conversation address was confirmed after readiness.');
      }
      this.assertPersisted();
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

  private async registerFirstSend(attempt: SessionInitAttempt, live: () => boolean): Promise<void> {
    if (attempt.finalized) return;
    this.assertPersisted();
    const url = await readUrlWithin(this.env, attempt.provider);
    this.assertPersisted();
    const documentId = await readUrlWithin(this.env, attempt.provider, true);
    if (attempt.finalized) return;
    if (live() && url && isConversationAddress(attempt.provider, url) && documentId === attempt.documentId) {
      this.finishSessionAttempt(attempt, 'registered', url, 'Conversation address confirmed after the first prompt on the fresh document.');
    } else {
      this.finishSessionAttempt(attempt, 'manual', undefined, 'The first prompt may have created a conversation, but its address or document could not be confirmed.');
    }
    this.assertPersisted();
  }

  private finishSessionAttempt(
    attempt: SessionInitAttempt,
    status: Exclude<SessionInitializationStatus, 'pending'>,
    url: string | undefined,
    note: string,
  ): void {
    if (attempt.finalized) return;
    attempt.finalized = true;
    if (status === 'registered' && url) attempt.confirmedUrl = url;
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
    for (const listener of [...this.listeners]) {
      try {
        if (listener(this.run) === false) this.persistenceFailed = true;
      } catch {
        // Persistence listeners are a checkpoint contract, not control flow. Avoid recursive
        // listener failures; the next provider-I/O boundary will fail closed.
        this.persistenceFailed = true;
      }
    }
  }
}

function resumeAfterForwarding(run: ChatLedRun, now: number): ChatLedRun {
  if (run.phase !== 'forwarding') return run;
  return { ...run, phase: 'coordinator-thinking', updatedAt: now };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const PROVIDER_START: Record<AIProvider, [string[], string[]]> = {
  chatgpt: [['chatgpt.com', 'chat.openai.com'], ['/']],
  claude: [['claude.ai'], ['/new']],
  gemini: [['gemini.google.com'], ['/app']],
  grok: [['grok.com'], ['/', '/chat']],
  meta: [['www.meta.ai', 'meta.ai'], ['/']],
};

function isBlankStart(provider: ProviderInstance, raw: string): boolean {
  try {
    const url = new URL(raw);
    const [hosts, paths] = PROVIDER_START[providerInstanceBase(provider)];
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname) && paths.includes(url.pathname);
  } catch { return false; }
}

function isConversationAddress(provider: ProviderInstance, raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !PROVIDER_START[providerInstanceBase(provider)][0].includes(url.hostname)) return false;
    const patterns: Record<AIProvider, RegExp> = {
      chatgpt: /^(?:\/g\/[^/]+)?\/c\/[^/]+$/,
      claude: /^\/chat\/[^/]+$/,
      gemini: /^\/app\/[^/]+$/,
      grok: /^\/(?:c|chat)\/[^/]+$/,
      meta: /^\/(?:c|chat)\/[^/]+$/,
    };
    return patterns[providerInstanceBase(provider)].test(url.pathname);
  } catch { return false; }
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
