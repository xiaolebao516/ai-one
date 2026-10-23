import type { AIProvider } from '../../../shared/types';
import {
  DEFAULT_COORDINATOR,
  DEFAULT_ROUND_LIMIT,
  type ChatLedRun,
  type CleanupItemResult,
  type ForwardRecord,
  type ForwardStatus,
  type RegisteredConversation,
  type RunPhase,
} from './types';
import { parseCoordinatorReply, PROVIDER_LABELS } from './protocol';

export interface FeedbackItem {
  from: AIProvider;
  label: string;
  reply?: string;
  error?: string;
}

export function createRun(input: {
  id: string;
  goal: string;
  coordinator?: AIProvider;
  available: readonly AIProvider[];
  roundLimit?: number;
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
    round: 0,
    phase: 'idle',
    forwards: [],
    conversations: [],
    coordinatorReplies: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function isTerminal(run: ChatLedRun): boolean {
  return run.phase === 'finished' || run.phase === 'stopped' || run.closed !== undefined;
}

/** A run that is using (or about to use) the provider pages. Only one may exist at a time. */
export function isRunActive(run: ChatLedRun): boolean {
  return run.phase === 'idle' || run.phase === 'coordinator-thinking' || run.phase === 'forwarding' || run.phase === 'paused';
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

function previousSend(run: ChatLedRun): { to: AIProvider[]; message: string } | undefined {
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
  if (current.status === 'done' || current.status === 'failed' || current.status === 'cancelled') {
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

export function settledFeedbackItems(
  run: ChatLedRun,
  round: number,
): FeedbackItem[] | undefined {
  const forwards = run.forwards.filter((forward) => forward.round === round);
  if (forwards.length === 0) return undefined;

  const settledStatuses: readonly ForwardStatus[] = ['done', 'failed', 'cancelled'];
  if (forwards.some((forward) => !settledStatuses.includes(forward.status))) {
    return undefined;
  }

  return forwards.map((forward) => {
    if (forward.status === 'done') {
      return {
        from: forward.to,
        label: PROVIDER_LABELS[forward.to],
        reply: forward.reply ?? '',
      };
    }

    return {
      from: forward.to,
      label: PROVIDER_LABELS[forward.to],
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

export function failProvider(
  run: ChatLedRun,
  provider: AIProvider,
  error: string,
  now: number,
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
    stop: { type: 'provider-failure', provider, error },
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
  if (run.cleanupResults || (run.phase !== 'finished' && run.phase !== 'stopped')) return run;
  return { ...run, cleanupResults: results, updatedAt: now };
}

/** Cleanup starts once per run; the results list then grows one confirmed item at a time. */
export function beginCleanup(run: ChatLedRun, now: number): ChatLedRun {
  if (run.closed || run.cleanupResults || run.cleanupRunning) return run;
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
export function interruptCleanup(run: ChatLedRun, now: number): ChatLedRun {
  if (!run.cleanupRunning) return run;
  const done = new Set((run.cleanupResults ?? []).map((r) => r.provider + '\n' + (r.url ?? '')));
  const rest: CleanupItemResult[] = run.conversations
    .filter((c) => !done.has(c.provider + '\n' + c.url))
    .map((c) => ({
      provider: c.provider,
      url: c.url,
      outcome: 'manual' as const,
      note: 'Cleanup was interrupted before this conversation was confirmed; check it by hand.',
    }));
  return { ...run, cleanupRunning: false, cleanupResults: [...(run.cleanupResults ?? []), ...rest], updatedAt: now };
}

export function closeRun(
  run: ChatLedRun,
  exportedMarkdown: boolean,
  now: number,
): ChatLedRun {
  if (run.closed || (run.phase !== 'finished' && run.phase !== 'stopped')) return run;
  return {
    ...run,
    closed: { at: now, exportedMarkdown },
    updatedAt: now,
  };
}
