import type { AIProvider, ProviderInstance } from '../../../shared/types';
import { providerInstanceName } from '../../../shared/providerInstances';
import {
  DEFAULT_COORDINATOR,
  DEFAULT_ROUND_LIMIT,
  MAX_CONSECUTIVE_AUTO_REMINDERS,
  MAX_CONSECUTIVE_FORWARD_FAILURES,
  MAX_LOG_ENTRIES,
  type ChatLedLogEntry,
  type ChatLedMode,
  type ChatLedRun,
  type CleanupItemResult,
  type ForwardRecord,
  type ForwardStatus,
  type RegisteredConversation,
  type RunPhase,
  type SessionInitializationStatus,
  type UnavailableProvider,
} from './types';
import { parseCoordinatorReply, PROVIDER_LABELS } from './protocol';

export interface FeedbackItem {
  from: ProviderInstance;
  label: string;
  reply?: string;
  error?: string;
}

function notesOrUndefined(notes: Partial<Record<ProviderInstance, string>> | undefined): Partial<Record<ProviderInstance, string>> | undefined {
  if (!notes) return undefined;
  const kept = Object.fromEntries(Object.entries(notes).filter(([, note]) => typeof note === 'string' && note.trim()).map(([provider, note]) => [provider, (note as string).trim()]));
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** The exact text a forward sends: the user's standing note for that AI, then the coordinator's message. */
export function forwardText(forward: Pick<ForwardRecord, 'message' | 'note'>): string {
  return forward.note ? forward.note + '\n\n' + forward.message : forward.message;
}

export function createRun(input: {
  id: string;
  goal: string;
  coordinator?: AIProvider;
  available: readonly ProviderInstance[];
  roundLimit?: number;
  mode?: ChatLedMode;
  workers?: 0 | 1 | 2;
  keepPages?: boolean;
  forwardNotes?: Partial<Record<ProviderInstance, string>>;
  now: number;
}): ChatLedRun {
  const coordinator = input.coordinator ?? DEFAULT_COORDINATOR;
  const available = [...new Set(input.available.filter((provider) => provider !== coordinator))];

  return {
    id: input.id,
    goal: input.goal,
    coordinator,
    available,
    roundLimit: input.roundLimit ?? DEFAULT_ROUND_LIMIT,
    mode: input.mode ?? 'general',
    workers: input.workers ?? 0,
    ...(input.keepPages ? { keepPages: true } : {}),
    ...(notesOrUndefined(input.forwardNotes) ? { forwardNotes: notesOrUndefined(input.forwardNotes) } : {}),
    round: 0,
    phase: 'idle',
    forwards: [],
    conversations: [],
    sessionInitializations: [],
    initializationPending: false,
    coordinatorReplies: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function isTerminal(run: ChatLedRun): boolean {
  return run.phase === 'finished' || run.phase === 'stopped' || run.closed !== undefined;
}

/** Pending startup or session registration must keep the shared provider pages locked. */
export function hasPendingInitialization(run: ChatLedRun): boolean {
  return (
    run.initializationPending === true ||
    (run.sessionInitializations ?? []).some((item) => item.status === 'pending')
  );
}

/**
 * Loaded after the app closed while a session creation was still unresolved: nothing can finish it
 * now, so it becomes a manual-only record (empty address) instead of locking the run forever or
 * being cleaned up without confirmation.
 */
export function recoverPendingInitialization(run: ChatLedRun, now: number): ChatLedRun {
  if (!hasPendingInitialization(run)) return run;
  const pending = (run.sessionInitializations ?? []).filter((item) => item.status === 'pending');
  const conversations = [...run.conversations];
  for (const item of pending) {
    if (conversations.some((c) => c.provider === item.provider && c.url === '')) continue;
    conversations.push({ provider: item.provider, url: '', createdByAiOne: true, registrationStatus: 'manual', registeredAt: now });
  }
  return {
    ...run,
    initializationPending: false,
    sessionInitializations: (run.sessionInitializations ?? []).map((item) =>
      item.status === 'pending'
        ? { ...item, status: 'manual' as const, updatedAt: now, note: 'The app closed before this session creation was confirmed; check it by hand.' }
        : item,
    ),
    conversations,
    updatedAt: now,
  };
}

/** A run that is using, waiting to use, or still registering shared provider pages is active. */
export function isRunActive(run: ChatLedRun): boolean {
  return (
    hasPendingInitialization(run) ||
    run.phase === 'idle' ||
    run.phase === 'coordinator-thinking' ||
    run.phase === 'forwarding' ||
    run.phase === 'paused' ||
    run.phase === 'awaiting-user'
  );
}

export function setInitializationPending(run: ChatLedRun, pending: boolean, now: number): ChatLedRun {
  if (run.initializationPending === pending) return run;
  return { ...run, initializationPending: pending, updatedAt: now };
}

export function setAvailableProviders(
  run: ChatLedRun,
  available: readonly ProviderInstance[],
  now: number,
  unavailable: readonly UnavailableProvider[] = [],
): ChatLedRun {
  if (run.phase !== 'coordinator-thinking') return run;
  const next = [...new Set(available.filter((provider) => provider !== run.coordinator))];
  const skipped = unavailable.filter(({ provider }) => provider !== run.coordinator && !next.includes(provider));
  if (
    next.length === run.available.length &&
    next.every((provider, index) => provider === run.available[index]) &&
    skipped.length === (run.unavailable?.length ?? 0)
  ) return run;
  return { ...run, available: next, unavailable: skipped.length > 0 ? skipped : undefined, updatedAt: now };
}

export function beginSessionInitialization(
  run: ChatLedRun,
  id: string,
  provider: ProviderInstance,
  now: number,
): ChatLedRun {
  if (run.closed || (run.sessionInitializations ?? []).some((item) => item.id === id)) return run;
  return {
    ...run,
    sessionInitializations: [
      ...(run.sessionInitializations ?? []),
      { id, provider, status: 'pending', startedAt: now, updatedAt: now },
    ],
    updatedAt: now,
  };
}

export function finishSessionInitialization(
  run: ChatLedRun,
  id: string,
  status: Exclude<SessionInitializationStatus, 'pending'>,
  now: number,
  details: { url?: string; note?: string } = {},
): ChatLedRun {
  const items = run.sessionInitializations ?? [];
  const index = items.findIndex((item) => item.id === id && item.status === 'pending');
  if (index < 0) return run;
  const current = items[index];
  const next = items.slice();
  next[index] = {
    ...current,
    status,
    updatedAt: now,
    ...(details.url === undefined ? {} : { url: details.url }),
    ...(details.note === undefined ? {} : { note: details.note }),
  };
  return { ...run, sessionInitializations: next, updatedAt: now };
}

export function canPause(run: ChatLedRun): boolean {
  return run.phase === 'coordinator-thinking' || run.phase === 'forwarding';
}

export function canResume(run: ChatLedRun): boolean {
  return run.phase === 'paused' &&
    (run.pausedFrom === 'coordinator-thinking' || run.pausedFrom === 'forwarding');
}

export function canExtendRoundLimit(run: ChatLedRun): boolean {
  return run.phase === 'awaiting-user' && run.stop?.type === 'round-limit';
}

export function canResumeAfterStop(run: ChatLedRun): boolean {
  return run.phase === 'awaiting-user' &&
    (run.stop?.type === 'protocol-violation' || run.stop?.type === 'provider-failure');
}

function previousSend(run: ChatLedRun): { to: ProviderInstance[]; message: string } | undefined {
  let latestRound = 0;
  for (const forward of run.forwards) {
    if (forward.round > latestRound) latestRound = forward.round;
  }
  if (latestRound === 0) return undefined;

  const previousForwards = run.forwards.filter((forward) => forward.round === latestRound);
  const first = previousForwards[0];
  if (!first) return undefined;

  return {
    to: previousForwards.map((forward) => forward.to),
    message: first.message,
  };
}

function canAcceptCoordinatorReply(run: ChatLedRun): boolean {
  if (run.phase === 'coordinator-thinking') return true;
  return run.phase === 'forwarding' && settledFeedbackItems(run, run.round) !== undefined;
}

export function startRun(run: ChatLedRun, now: number): ChatLedRun {
  if (run.phase !== 'idle') return run;
  return { ...run, phase: 'coordinator-thinking', updatedAt: now };
}

export function applyCoordinatorReply(
  run: ChatLedRun,
  reply: string,
  now: number,
): { run: ChatLedRun; parsed: ReturnType<typeof parseCoordinatorReply> } {
  const previous = previousSend(run);
  const context = {
    coordinator: run.coordinator,
    available: run.available,
    ...(previous ? { previous } : {}),
  };
  const parsed = parseCoordinatorReply(reply, context);

  if (!canAcceptCoordinatorReply(run)) return { run, parsed };

  const nextRound = run.round + 1;
  const nextRun: ChatLedRun = {
    ...run,
    round: nextRound,
    coordinatorReplies: [...run.coordinatorReplies, { round: nextRound, text: reply, at: now }],
    updatedAt: now,
  };

  if (nextRound > run.roundLimit) {
    return {
      run: {
        ...nextRun,
        phase: 'awaiting-user',
        pausedFrom: undefined,
        stop: { type: 'round-limit', limit: run.roundLimit },
      },
      parsed,
    };
  }

  if (parsed.kind === 'send') {
    const newForwards: ForwardRecord[] = parsed.to.map((provider) => ({
      id: 'r' + nextRound + '-' + provider,
      round: nextRound,
      from: run.coordinator,
      to: provider,
      message: parsed.message,
      ...(run.forwardNotes?.[provider] ? { note: run.forwardNotes[provider] } : {}),
      messageChars: parsed.message.length,
      status: 'queued' as const,
    }));
    return {
      run: {
        ...nextRun,
        phase: 'forwarding',
        pausedFrom: undefined,
        stop: undefined,
        forwards: [...run.forwards, ...newForwards],
      },
      parsed,
    };
  }

  if (parsed.kind === 'done') {
    return {
      run: {
        ...nextRun,
        phase: 'finished',
        pausedFrom: undefined,
        stop: undefined,
        doneSummary: parsed.summary,
      },
      parsed,
    };
  }

  return {
    run: {
      ...nextRun,
      phase: 'awaiting-user',
      pausedFrom: undefined,
      stop: { type: 'protocol-violation', violation: parsed, rawReply: reply },
    },
    parsed,
  };
}

const RECOVERABLE_VIOLATIONS: ReadonlySet<string> = new Set([
  'no-directive', 'invalid-json', 'multiple-directives', 'invalid-shape',
]);

/** Checkpoint retries before sending so the timeline retains the decision after reload. */
export function scheduleAutoReminder(run: ChatLedRun, reminder: string, now: number): ChatLedRun {
  if (
    run.phase !== 'awaiting-user' ||
    run.stop?.type !== 'protocol-violation' ||
    !RECOVERABLE_VIOLATIONS.has(run.stop.violation.code) ||
    (run.autoReminderStreak ?? 0) >= MAX_CONSECUTIVE_AUTO_REMINDERS ||
    run.round >= run.roundLimit ||
    run.closed
  ) return run;
  const replies = run.coordinatorReplies.slice();
  const last = replies[replies.length - 1];
  if (!last || last.round !== run.round || last.autoReminder !== undefined) return run;
  replies[replies.length - 1] = { ...last, autoReminder: reminder };
  return {
    ...run,
    coordinatorReplies: replies,
    autoReminderStreak: (run.autoReminderStreak ?? 0) + 1,
    phase: 'coordinator-thinking',
    stop: undefined,
    updatedAt: now,
  };
}

/** Only a confirmed successful target reply breaks a streak of automatic reminders. */
export function resetAutoRemindersAfterForward(run: ChatLedRun, round: number, now: number): ChatLedRun {
  if (!run.autoReminderStreak) return run;
  const settled = settledFeedbackItems(run, round);
  if (!settled || !settled.some((item) => item.reply !== undefined)) return run;
  return { ...run, autoReminderStreak: 0, updatedAt: now };
}

export function updateForward(
  run: ChatLedRun,
  id: string,
  patch: Partial<ForwardRecord>,
  now: number,
): ChatLedRun {
  if (isTerminal(run)) return run;
  const index = run.forwards.findIndex((forward) => forward.id === id);
  if (index < 0) return run;

  const current = run.forwards[index];
  if (current.status === 'done' || current.status === 'failed' || current.status === 'timed-out' || current.status === 'cancelled') {
    return run;
  }

  const updated: ForwardRecord = {
    ...current,
    ...patch,
    id: current.id,
    round: current.round,
    from: current.from,
    to: current.to,
    message: current.message,
    messageChars: current.messageChars,
    status: patch.status ?? current.status,
  };
  const forwards = run.forwards.slice();
  forwards[index] = updated;
  return { ...run, forwards, updatedAt: now };
}

export function registerConversation(
  run: ChatLedRun,
  conv: Omit<RegisteredConversation, 'registeredAt'>,
  now: number,
): ChatLedRun {
  // Finished and stopped runs still accept registrations (a conversation created while the
  // run was being stopped must stay known to cleanup); only a closed run is frozen.
  if (run.closed) return run;
  if (run.conversations.some((item) => item.provider === conv.provider && item.url === conv.url)) {
    return run;
  }

  const registered: RegisteredConversation = { ...conv, registeredAt: now };
  return {
    ...run,
    conversations: [...run.conversations, registered],
    updatedAt: now,
  };
}

type LogInput = ChatLedLogEntry extends infer Entry ? (Entry extends ChatLedLogEntry ? Omit<Entry, 'at'> : never) : never;

/** Appends one process-log entry (#196); the oldest entries go once the log is full. */
export function appendLog(run: ChatLedRun, entry: LogInput, now: number): ChatLedRun {
  const log = [...(run.log ?? []), { ...entry, at: now } as ChatLedLogEntry];
  return { ...run, log: log.length > MAX_LOG_ENTRIES ? log.slice(-MAX_LOG_ENTRIES) : log, updatedAt: now };
}

export function settledFeedbackItems(
  run: ChatLedRun,
  round: number,
): FeedbackItem[] | undefined {
  const forwards = run.forwards.filter((forward) => forward.round === round);
  if (forwards.length === 0) return undefined;

  const settledStatuses: readonly ForwardStatus[] = ['done', 'failed', 'timed-out', 'cancelled'];
  if (forwards.some((forward) => !settledStatuses.includes(forward.status))) {
    return undefined;
  }

  return forwards.map((forward) => {
    if (forward.status === 'done') {
      return {
        from: forward.to,
        label: providerInstanceName(forward.to, PROVIDER_LABELS),
        reply: forward.reply ?? '',
      };
    }

    return {
      from: forward.to,
      label: providerInstanceName(forward.to, PROVIDER_LABELS),
      error: forward.error ?? (forward.status === 'cancelled' ? 'Cancelled' : 'Unknown error'),
    };
  });
}

export function pauseRun(run: ChatLedRun, now: number): ChatLedRun {
  if (!canPause(run)) return run;
  return { ...run, phase: 'paused', pausedFrom: run.phase, updatedAt: now };
}

export function resumeRun(run: ChatLedRun, now: number): ChatLedRun {
  if (!canResume(run) || !run.pausedFrom) return run;
  const phase: RunPhase = run.pausedFrom;
  return { ...run, phase, pausedFrom: undefined, updatedAt: now };
}

export function stopRun(run: ChatLedRun, now: number): ChatLedRun {
  if (isTerminal(run)) return run;

  const activeStatuses: readonly ForwardStatus[] = ['queued', 'sending', 'waiting'];
  const forwards = run.forwards.map((forward) =>
    activeStatuses.includes(forward.status)
      ? { ...forward, status: 'cancelled' as const, finishedAt: now }
      : forward,
  );

  return {
    ...run,
    phase: 'stopped',
    pausedFrom: undefined,
    stop: { type: 'user' },
    forwards,
    updatedAt: now,
  };
}

export function extendRoundLimit(run: ChatLedRun, extra: number, now: number): ChatLedRun {
  if (!canExtendRoundLimit(run) || !Number.isInteger(extra) || extra <= 0) return run;
  return {
    ...run,
    phase: 'coordinator-thinking',
    pausedFrom: undefined,
    stop: undefined,
    roundLimit: run.roundLimit + extra,
    updatedAt: now,
  };
}

export function resumeAfterStop(run: ChatLedRun, now: number): ChatLedRun {
  if (!canResumeAfterStop(run)) return run;
  return {
    ...run,
    phase: 'coordinator-thinking',
    pausedFrom: undefined,
    stop: undefined,
    updatedAt: now,
  };
}

/**
 * An AI sent to in this round whose latest forwards all failed, MAX_CONSECUTIVE_FORWARD_FAILURES in a
 * row. Sending the coordinator another feedback round would only make it re-dispatch into the same
 * broken page. An AI the coordinator has moved away from no longer counts.
 */
export function repeatedForwardFailure(
  run: ChatLedRun,
  round: number,
): { provider: ProviderInstance; error: string } | undefined {
  const providers = [...new Set(run.forwards.filter((forward) => forward.round === round).map((forward) => forward.to))];
  for (const provider of providers) {
    const latest = run.forwards.filter((forward) => forward.to === provider).slice(-MAX_CONSECUTIVE_FORWARD_FAILURES);
    if (latest.length < MAX_CONSECUTIVE_FORWARD_FAILURES) continue;
    if (!latest.every((forward) => forward.status === 'failed' || forward.status === 'timed-out')) continue;
    return { provider, error: latest[latest.length - 1].error ?? latest[latest.length - 1].status };
  }
  return undefined;
}

export function failProvider(
  run: ChatLedRun,
  provider: ProviderInstance,
  error: string,
  now: number,
  repeated = false,
): ChatLedRun {
  if (
    run.phase !== 'coordinator-thinking' &&
    run.phase !== 'forwarding' &&
    run.phase !== 'paused'
  ) {
    return run;
  }

  const activeStatuses: readonly ForwardStatus[] = ['queued', 'sending', 'waiting'];
  const forwards = run.forwards.map((forward) =>
    forward.to === provider && activeStatuses.includes(forward.status)
      ? { ...forward, status: 'failed' as const, error, finishedAt: now }
      : forward,
  );

  return {
    ...run,
    phase: 'awaiting-user',
    pausedFrom: undefined,
    stop: repeated ? { type: 'provider-failure', provider, error, repeated: true } : { type: 'provider-failure', provider, error },
    forwards,
    updatedAt: now,
  };
}

export function recordExport(run: ChatLedRun, now: number): ChatLedRun {
  if (run.closed) return run;
  return { ...run, exportedAt: now, updatedAt: now };
}

/** Stores the cleanup outcome once; later calls are ignored so results are never overwritten. */
export function recordCleanup(run: ChatLedRun, results: CleanupItemResult[], now: number): ChatLedRun {
  if (hasPendingInitialization(run) || run.cleanupResults || (run.phase !== 'finished' && run.phase !== 'stopped')) return run;
  return { ...run, cleanupResults: results, updatedAt: now };
}

/** Cleanup starts once per run; the results list then grows one confirmed item at a time. */
export function beginCleanup(run: ChatLedRun, now: number): ChatLedRun {
  if (hasPendingInitialization(run) || run.closed || run.cleanupResults || run.cleanupRunning) return run;
  if (run.phase !== 'finished' && run.phase !== 'stopped') return run;
  return { ...run, cleanupRunning: true, cleanupResults: [], updatedAt: now };
}

export function appendCleanupResult(run: ChatLedRun, result: CleanupItemResult, now: number): ChatLedRun {
  if (!run.cleanupRunning) return run;
  return { ...run, cleanupResults: [...(run.cleanupResults ?? []), result], updatedAt: now };
}

export function finishCleanup(run: ChatLedRun, now: number): ChatLedRun {
  if (!run.cleanupRunning) return run;
  return { ...run, cleanupRunning: false, updatedAt: now };
}

/**
 * A cleanup that was cut off (app closed mid-way): nothing unconfirmed is replayed. Every
 * registered conversation without a confirmed result is marked manual, including the one that
 * was in flight when the app stopped.
 */
export function interruptCleanup(run: ChatLedRun, now: number, reason?: string): ChatLedRun {
  if (!run.cleanupRunning) return run;
  const done = new Set((run.cleanupResults ?? []).map((r) => r.provider + '\n' + (r.url ?? '')));
  // A reason (setup or checkpoint failure) is kept in the stored record: the UI error disappears on reload.
  const short = reason?.replace(/\s+/g, ' ').trim().slice(0, 160);
  const note = short
    ? `Cleanup stopped before this conversation was confirmed (${short}); check it by hand.`
    : 'Cleanup was interrupted before this conversation was confirmed; check it by hand.';
  const rest: CleanupItemResult[] = run.conversations
    .filter((c) => !done.has(c.provider + '\n' + c.url))
    .map((c) => ({
      provider: c.provider,
      url: c.url,
      outcome: 'manual' as const,
      note,
    }));
  return { ...run, cleanupRunning: false, cleanupResults: [...(run.cleanupResults ?? []), ...rest], updatedAt: now };
}

export function closeRun(
  run: ChatLedRun,
  exportedMarkdown: boolean,
  now: number,
): ChatLedRun {
  if (hasPendingInitialization(run) || run.closed || (run.phase !== 'finished' && run.phase !== 'stopped')) return run;
  return {
    ...run,
    closed: { at: now, exportedMarkdown },
    updatedAt: now,
  };
}
