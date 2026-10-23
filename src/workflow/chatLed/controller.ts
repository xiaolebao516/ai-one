import type { AIProvider } from '../../../shared/types';
import {
  applyCoordinatorReply,
  closeRun,
  createRun,
  recordCleanup,
  recordExport,
  extendRoundLimit,
  failProvider,
  pauseRun,
  registerConversation,
  resumeAfterStop,
  resumeRun,
  settledFeedbackItems,
  startRun,
  stopRun,
  updateForward,
} from './machine';
import { buildFeedbackPrompt, buildIntroPrompt, buildViolationReminder, PROVIDER_LABELS } from './protocol';
import type { ChatLedRun, CleanupItemResult, ForwardRecord } from './types';
import { DEFAULT_COORDINATOR, DEFAULT_ROUND_LIMIT } from './types';

/**
 * Everything the controller needs from the outside world. The real implementation (env.ts) wires
 * it to the Tauri host and the shared workflow send/receive primitives; tests inject fakes.
 */
export interface ChatLedEnv {
  now(): number;
  /** Providers that can be addressed right now (loaded, DOM ready, logged in). */
  sendableProviders(): Promise<AIProvider[]>;
  /** Make sure the provider page exists (parked offscreen) and is idle (busy gate, #15). */
  prepare(provider: AIProvider): Promise<void>;
  /** Start a brand-new conversation in the provider page (so ai-one owns it). */
  newSession(provider: AIProvider): Promise<void>;
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
  /** Candidate targets; only those currently sendable are offered to the coordinator. */
  candidates: readonly AIProvider[];
  roundLimit?: number;
}

type Listener = (run: ChatLedRun) => void;

/**
 * Drives one chat-led run (#113). The run state lives in machine.ts (pure); this class only does
 * the I/O around it: send, wait, forward, feed back. A coordinator reply is never interpreted
 * outside parseCoordinatorReply, and no web page button is clicked here.
 */
export class ChatLedController {
  private run: ChatLedRun;
  private readonly listeners = new Set<Listener>();
  private readonly started = new Set<AIProvider>(); // providers that already have their own new session
  private generation = 0;
  private resumeWaiters: (() => void)[] = [];
  private stopWaiters: (() => void)[] = [];
  private driving = false;

  constructor(
    private readonly env: ChatLedEnv,
    run: ChatLedRun,
  ) {
    this.run = run;
  }

  /** Creates a run, offering the coordinator only providers that are sendable right now. */
  static async create(env: ChatLedEnv, input: ChatLedStartInput): Promise<ChatLedController> {
    const coordinator = input.coordinator ?? DEFAULT_COORDINATOR;
    const sendable = new Set(await env.sendableProviders());
    const available = input.candidates.filter((provider) => provider !== coordinator && sendable.has(provider));
    const run = createRun({
      id: input.id,
      goal: input.goal,
      coordinator,
      available,
      roundLimit: input.roundLimit ?? DEFAULT_ROUND_LIMIT,
      now: env.now(),
    });
    const controller = new ChatLedController(env, run);
    controller.coordinatorSendable = sendable.has(coordinator);
    return controller;
  }

  private coordinatorSendable = true;

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

  /** Begin: sends the intro prompt to the coordinator and runs until the run stops or finishes. */
  async start(): Promise<void> {
    if (this.run.phase !== 'idle') return;
    if (!this.coordinatorSendable) {
      this.set(failProvider(this.run, this.run.coordinator, 'Coordinator is not logged in or its page is not ready.', this.env.now()));
      return;
    }
    this.set(startRun(this.run, this.env.now()));
    const intro = buildIntroPrompt({
      goal: this.run.goal,
      coordinator: this.run.coordinator,
      available: this.run.available.map((provider) => ({ provider, label: PROVIDER_LABELS[provider] ?? provider })),
      roundLimit: this.run.roundLimit,
    });
    await this.drive(intro);
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

  /** Ends the run. In-flight providers are asked to stop; their late replies are ignored. */
  async stop(): Promise<void> {
    const inFlight = this.run.forwards.filter((f) => f.status === 'sending' || f.status === 'waiting').map((f) => f.to);
    const coordinatorBusy =
      this.run.phase === 'coordinator-thinking' ||
      (this.run.phase === 'paused' && this.run.pausedFrom === 'coordinator-thinking');
    this.generation += 1;
    // Register the conversations created so far before the run turns terminal (a terminal run
    // refuses new registrations), so cleanup still knows about them.
    for (const provider of this.started) await this.registerUrl(provider);
    this.set(stopRun(this.run, this.env.now()));
    for (const wake of this.resumeWaiters.splice(0)) wake();
    for (const wake of this.stopWaiters.splice(0)) wake();
    const targets = new Set<AIProvider>(inFlight);
    if (coordinatorBusy) targets.add(this.run.coordinator);
    await Promise.all([...targets].map((provider) => this.env.stop(provider).catch(() => undefined)));
  }

  /** After a protocol violation or failure: remind the coordinator and continue. */
  async remind(): Promise<void> {
    const stop = this.run.stop;
    if (!stop || this.driving) return;
    const text =
      stop.type === 'protocol-violation'
        ? buildViolationReminder(stop.violation.code)
        : buildViolationReminder('no-directive');
    const next = resumeAfterStop(this.run, this.env.now());
    if (next === this.run) return;
    this.set(next);
    await this.drive(text);
  }

  /** After the round limit: allow `extra` more rounds and ask the coordinator to continue. */
  async extendLimit(extra: number): Promise<void> {
    if (this.driving) return;
    const next = extendRoundLimit(this.run, extra, this.env.now());
    if (next === this.run) return;
    this.set(next);
    await this.drive(buildViolationReminder('no-directive'));
  }

  markExported(): void {
    this.set(recordExport(this.run, this.env.now()));
  }

  recordCleanupResults(results: CleanupItemResult[]): void {
    this.set(recordCleanup(this.run, results, this.env.now()));
  }

  markClosed(exportedMarkdown: boolean): void {
    this.set(closeRun(this.run, exportedMarkdown, this.env.now()));
  }

  // ---- internals -------------------------------------------------------------------------

  private async waitWhilePaused(): Promise<boolean> {
    while (this.run.phase === 'paused') {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    }
    return !this.stopped;
  }

  private async drive(firstText: string): Promise<void> {
    if (this.driving) return;
    this.driving = true;
    const generation = this.generation;
    const live = () => generation === this.generation && !this.stopped;
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
        await this.registerUrl(coordinator);
        const applied = applyCoordinatorReply(this.run, reply, this.env.now());
        this.set(applied.run);
        if (applied.parsed.kind !== 'send' || this.run.phase !== 'forwarding') return;
        const round = this.run.round;
        await this.forwardRound(round, live);
        if (!live()) return;
        const items = settledFeedbackItems(this.run, round);
        if (!items) return;
        text = buildFeedbackPrompt(items, round, Math.max(0, this.run.roundLimit - this.run.round));
        // Back to waiting for the coordinator.
        this.set(resumeAfterForwarding(this.run, this.env.now()));
      }
    } finally {
      this.driving = false;
    }
  }

  private async forwardRound(round: number, live: () => boolean): Promise<void> {
    const queued = this.run.forwards.filter((f) => f.round === round && f.status === 'queued');
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
      await this.registerUrl(forward.to);
      patch({ status: 'done', reply, replyChars: reply.length, finishedAt: this.env.now() });
    } catch (error) {
      patch({ status: 'failed', error: errorMessage(error), finishedAt: this.env.now() });
    }
  }

  /**
   * prepare (idle gate) -> own new session on first use -> send -> complete reply.
   * Every async boundary re-checks "still live" and waits out a pause, so stop/pause during
   * prepare or newSession can never lead to a send. The stop waiter is registered first.
   */
  private async sendOwned(provider: AIProvider, text: string, live: () => boolean): Promise<string> {
    const stopped = new Promise<never>((_, reject) => {
      this.stopWaiters.push(() => reject(new Error('Run stopped by user')));
    });
    const work = (async (): Promise<string> => {
      const proceed = async (): Promise<void> => {
        if (!(await this.waitWhilePaused()) || !live()) throw new Error('Run stopped by user');
      };
      await proceed();
      await this.env.prepare(provider);
      await proceed();
      if (!this.started.has(provider)) {
        await this.env.newSession(provider);
        this.started.add(provider);
        if (!live()) {
          // The session exists now: keep it known so cleanup can list it.
          await this.registerUrl(provider);
        }
        await proceed();
      }
      try {
        return await this.env.send(provider, text);
      } catch (error) {
        // The conversation was created by this run even though the send failed.
        if (live()) await this.registerUrl(provider);
        throw error;
      }
    })();
    work.catch(() => undefined);
    return Promise.race([work, stopped]);
  }

  private async registerUrl(provider: AIProvider): Promise<void> {
    if (this.run.conversations.some((c) => c.provider === provider && hasConversationPath(c.url))) return;
    let url: string | undefined;
    try {
      url = await this.env.readConversationUrl(provider);
    } catch {
      url = undefined;
    }
    // An unreadable address is still recorded (empty url) so cleanup lists it as "manual".
    this.set(
      registerConversation(
        this.run,
        { provider, url: url ?? '', createdByAiOne: true },
        this.env.now(),
      ),
    );
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
