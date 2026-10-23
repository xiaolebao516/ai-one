import type { AIProvider } from '../../../shared/types';

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
/** Max forward targets in one `ai-one-send` block. */
export const MAX_TARGETS_PER_DIRECTIVE = 4;

export const SEND_FENCE = 'ai-one-send';
export const DONE_FENCE = 'ai-one-done';

/** Parsed content of one ```ai-one-send block (strict JSON, no unknown keys tolerated). */
export interface SendDirective {
  kind: 'send';
  to: AIProvider[]; // deduplicated, order kept, at least one, never the coordinator itself
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
export type ForwardStatus = 'queued' | 'sending' | 'waiting' | 'done' | 'failed' | 'cancelled';

export interface ForwardRecord {
  id: string; // unique within the run, e.g. "r3-claude"
  round: number; // 1-based coordinator round that issued it
  from: AIProvider; // always the coordinator
  to: AIProvider;
  message: string; // exact text sent to `to`
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
  | { type: 'provider-failure'; provider: AIProvider; error: string }
  | { type: 'user' };

export interface RegisteredConversation {
  provider: AIProvider;
  url: string; // conversation address read from the provider page after the first send
  title?: string;
  createdByAiOne: true; // only conversations created (new session) by this run are ever registered
  registeredAt: number;
}

export interface ChatLedRun {
  id: string;
  goal: string; // the user's task text
  coordinator: AIProvider;
  available: AIProvider[]; // logged-in providers the coordinator may address (never includes coordinator)
  roundLimit: number;
  round: number; // number of coordinator replies processed so far
  phase: RunPhase;
  pausedFrom?: RunPhase;
  stop?: StopReason;
  doneSummary?: string;
  forwards: ForwardRecord[];
  conversations: RegisteredConversation[];
  /** Raw coordinator replies in order (kept locally for the timeline; never uploaded). */
  coordinatorReplies: { round: number; text: string; at: number }[];
  createdAt: number;
  updatedAt: number;
  closed?: { at: number; exportedMarkdown: boolean }; // set once cleanup finished or user closed
}

/** Cleanup outcome per registered conversation. Only readback-confirmed outcomes count. */
export type CleanupOutcome =
  | 'deleted' // delete done AND read back as gone from the list
  | 'archived' // archived AND read back
  | 'manual' // could not delete or archive, or not confirmed: user must clean up by hand
  | 'skipped'; // not registered / not created by ai-one: never touched

export interface CleanupItemResult {
  provider: AIProvider;
  url?: string;
  title?: string;
  outcome: CleanupOutcome;
  note: string;
}
