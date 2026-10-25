import type { AIProvider, ProviderInstance } from '../../../shared/types';

/**
 * Chat-led coordination (#113). A web AI (the coordinator) emits fenced `ai-one-send` blocks;
 * ai-one forwards the COMPLETE message text to the named web AIs, waits for their complete reply,
 * feeds it back to the coordinator, and loops until `ai-one-done`, the round limit or a stop.
 *
 * This file is the shared contract between protocol.ts, machine.ts, cleanup.ts, controller.ts
 * and the timeline view. Keep it free of runtime imports (types and constants only).
 */

export const DEFAULT_COORDINATOR: AIProvider = 'chatgpt';
export const DEFAULT_ROUND_LIMIT = 8;
export const MAX_CONSECUTIVE_AUTO_REMINDERS = 2;
export type ChatLedMode = 'general' | 'repo' | 'discuss';
/** Max forward targets in one `ai-one-send` block. */
export const MAX_TARGETS_PER_DIRECTIVE = 4;

export const SEND_FENCE = 'ai-one-send';
export const DONE_FENCE = 'ai-one-done';

/** Parsed content of one ```ai-one-send block (strict JSON, no unknown keys tolerated). */
export interface SendDirective {
  kind: 'send';
  to: ProviderInstance[]; // deduplicated, order kept, at least one, never the coordinator itself
  message: string; // non-empty, forwarded verbatim
}

/** Parsed content of one ```ai-one-done block: {"summary":"..."} */
export interface DoneDirective {
  kind: 'done';
  summary: string;
}

export type ProtocolViolationCode =
  | 'no-directive' // reply has no ai-one fence at all
  | 'multiple-directives' // more than one ai-one fence (top level)
  | 'invalid-json'
  | 'invalid-shape' // JSON ok but wrong keys / types / empty message / unknown key
  | 'unknown-target' // `to` names something that is not a known provider
  | 'unavailable-target' // known provider but not in the available list (not logged in / disabled)
  | 'self-target' // coordinator addressed itself
  | 'too-many-targets'
  | 'duplicate-directive'; // same {to,message} as the previous directive

export interface ProtocolViolation {
  kind: 'violation';
  code: ProtocolViolationCode;
  detail: string; // short human readable explanation (English; the view localises the code)
}

export type ParsedReply = SendDirective | DoneDirective | ProtocolViolation;

/** One forwarded exchange shown as a timeline row. */
export type ForwardStatus = 'queued' | 'sending' | 'waiting' | 'done' | 'failed' | 'timed-out' | 'cancelled';

export interface ForwardRecord {
  id: string; // unique within the run, e.g. "r3-claude"
  round: number; // 1-based coordinator round that issued it
  from: AIProvider; // always the coordinator
  to: ProviderInstance;
  message: string; // the coordinator's message for `to`
  /** The user's standing note for `to` (#200), sent before `message`; absent when there is none. */
  note?: string;
  messageChars: number;
  status: ForwardStatus;
  reply?: string; // complete reply once status === 'done'
  replyChars?: number;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export type RunPhase =
  | 'idle' // created, not started
  | 'coordinator-thinking' // waiting for the coordinator reply
  | 'forwarding' // forwarding to targets
  | 'paused' // user paused; resume continues from pausedFrom
  | 'awaiting-user' // stopped on a violation / round limit / failure; user decides
  | 'finished' // coordinator said done
  | 'stopped'; // user ended the run

export type StopReason =
  | { type: 'protocol-violation'; violation: ProtocolViolation; rawReply: string }
  | { type: 'round-limit'; limit: number }
  | { type: 'provider-failure'; provider: ProviderInstance; error: string }
  | { type: 'user' };

export type SessionInitializationStatus = 'pending' | 'registered' | 'manual' | 'not-created';

export interface SessionInitialization {
  id: string;
  provider: ProviderInstance;
  status: SessionInitializationStatus;
  startedAt: number;
  updatedAt: number;
  /** Set only when the new conversation URL was positively confirmed. */
  url?: string;
  /** Short local-only explanation; never includes conversation text or a private URL. */
  note?: string;
}

export interface RegisteredConversation {
  provider: ProviderInstance;
  url: string; // empty for an unconfirmed creation attempt; such records are manual-only
  title?: string;
  /**
   * This run invoked newSession for the record. registrationStatus prevents an uncertain attempt
   * with an empty URL from ever being treated as a confirmed, actionable conversation.
   */
  createdByAiOne: true;
  registrationStatus?: 'confirmed' | 'manual';
  registeredAt: number;
}

/** Progress events, localised by the view (#196). */
export type ChatLedLogEvent =
  | 'prepare-start' // provider page is being opened / checked
  | 'prepare-ok'
  | 'prepare-failed' // detail: reason
  | 'targets-ready' // detail: comma-separated provider ids the coordinator may address
  | 'paused'
  | 'resumed'
  | 'stopped';

/**
 * The run's process log (#196), shown collapsed. Messages to the coordinator other than feedback
 * keep their full text; feedback is rebuilt from the round's forwards so replies are not stored twice.
 */
export type ChatLedLogEntry =
  | { at: number; kind: 'event'; event: ChatLedLogEvent; provider?: ProviderInstance; detail?: string }
  | { at: number; kind: 'to-coordinator'; text: string }
  | { at: number; kind: 'feedback'; round: number; remaining: number };

export const MAX_LOG_ENTRIES = 300;

export interface UnavailableProvider {
  provider: ProviderInstance;
  reason: string;
}

export interface ChatLedRun {
  id: string;
  goal: string; // the user's task text
  coordinator: AIProvider;
  available: ProviderInstance[]; // logged-in providers the coordinator may address (never includes coordinator)
  /** Process log, oldest first; absent in runs saved before #196. */
  log?: ChatLedLogEntry[];
  /** Candidates that failed startup readiness, with the reason; shown to the user and the coordinator. */
  unavailable?: UnavailableProvider[];
  roundLimit: number;
  workers?: 0 | 1 | 2; // absent in old storage means zero
  /**
   * Send into the conversation each page already has open instead of opening a new one (#198), so
   * the mode, model and thinking level the user picked on the page stay. Such conversations are the
   * user's own: never registered, never cleaned up.
   */
  keepPages?: boolean;
  /** The user's standing note per AI (#200), put before every message forwarded to it. */
  forwardNotes?: Partial<Record<ProviderInstance, string>>;
  mode?: ChatLedMode; // absent in v1 storage means general
  autoReminderStreak?: number; // consecutive automatic retries since a successful send
  round: number; // number of coordinator replies processed so far
  phase: RunPhase;
  pausedFrom?: RunPhase;
  stop?: StopReason;
  doneSummary?: string;
  forwards: ForwardRecord[];
  conversations: RegisteredConversation[];
  /** Creation/address-registration attempts; pending records hold the single-run lock. */
  sessionInitializations: SessionInitialization[];
  /** True while bridge/provider readiness is being prepared before the first send. */
  initializationPending?: boolean;
  /** Raw coordinator replies in order (kept locally for the timeline; never uploaded). */
  coordinatorReplies: { round: number; text: string; at: number; autoReminder?: string }[];
  createdAt: number;
  updatedAt: number;
  closed?: { at: number; exportedMarkdown: boolean }; // set once cleanup finished or user closed
  /** Set when the user exported the Markdown log; cleanup is gated on it. */
  exportedAt?: number;
  /** Persisted cleanup outcome; once present the run is never offered cleanup again. */
  cleanupResults?: CleanupItemResult[];
  /** True while a cleanup is executing; a reload in this state marks the rest as manual. */
  cleanupRunning?: boolean;
}

/** Cleanup outcome per registered conversation. Only readback-confirmed outcomes count. */
export type CleanupOutcome =
  | 'deleted' // delete done AND read back as gone from the list
  | 'archived' // archived AND read back
  | 'manual' // could not delete or archive, or not confirmed: user must clean up by hand
  | 'skipped'; // not registered / not created by ai-one: never touched

export interface CleanupItemResult {
  provider: ProviderInstance;
  url?: string;
  title?: string;
  outcome: CleanupOutcome;
  note: string;
}
