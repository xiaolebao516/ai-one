import { interruptCleanup } from './machine';
import type { ChatLedRun } from './types';

/**
 * Local-only persistence of chat-led runs (#113). The records contain conversation text, so they
 * stay in this browser profile (same rule as conversationSessions) and are never uploaded.
 * A run that was still in flight when the app closed cannot continue: it is loaded as stopped.
 */
export const CHAT_LED_STORAGE_KEY = 'ai-one:chat-led:runs:v1';
export const MAX_STORED_RUNS = 20;

export interface ChatLedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Without a live controller none of these can continue; awaiting-user needs the controller too.
const IN_FLIGHT = new Set(['idle', 'coordinator-thinking', 'forwarding', 'paused', 'awaiting-user']);

function isRunLike(value: unknown): value is ChatLedRun {
  if (!value || typeof value !== 'object') return false;
  const run = value as Partial<ChatLedRun>;
  return (
    typeof run.id === 'string' &&
    typeof run.goal === 'string' &&
    typeof run.coordinator === 'string' &&
    typeof run.phase === 'string' &&
    Array.isArray(run.forwards) &&
    Array.isArray(run.conversations) &&
    Array.isArray(run.coordinatorReplies)
  );
}

export function loadRuns(storage: ChatLedStorage | undefined): ChatLedRun[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(CHAT_LED_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRunLike).map((loaded) => {
      const run = interruptCleanup(loaded, Date.now());
      return IN_FLIGHT.has(run.phase)
        ? {
            ...run,
            phase: 'stopped' as const,
            pausedFrom: undefined,
            stop: { type: 'user' as const },
            forwards: run.forwards.map((f) =>
              f.status === 'queued' || f.status === 'sending' || f.status === 'waiting' ? { ...f, status: 'cancelled' as const } : f,
            ),
          }
        : run;
    });
  } catch {
    return [];
  }
}

/** Upserts `run` (newest first), keeping at most MAX_STORED_RUNS. Returns the saved list. */
export function saveRun(storage: ChatLedStorage | undefined, run: ChatLedRun, existing: readonly ChatLedRun[]): ChatLedRun[] {
  const next = [run, ...existing.filter((item) => item.id !== run.id)].slice(0, MAX_STORED_RUNS);
  try {
    storage?.setItem(CHAT_LED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable: the run stays in memory for this session.
  }
  return next;
}
