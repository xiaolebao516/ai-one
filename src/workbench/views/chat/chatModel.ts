import { DOCK_SLOT_PROVIDERS, AI_PROVIDERS } from '../../../../shared/constants';
import type { AIProvider, ProviderState } from '../../../../shared/types';
import type { ConversationSessionMessage } from '../../../ui/conversationSessions';
import { isSendable } from '../../../workflow/sendability';
import { formatDeliberationRelaySection } from '../../../workflow/graph/deliberationRelay';

export const CHAT_PROVIDERS = DOCK_SLOT_PROVIDERS;
export const CHAT_PRESET_IDS = ['free', 'debate', 'consult', 'deliberation'] as const;
export type ChatPresetId = (typeof CHAT_PRESET_IDS)[number];
export type ChatSendPresetId = Exclude<ChatPresetId, 'deliberation'>;

export type LoginTriState = 'loggedIn' | 'loggedOut' | 'unknown';
export type CardStatus = 'completed' | 'generating' | 'notSent' | 'failed' | 'timedOut';
export type NotSentReason = 'not-selected' | 'not-logged-in' | 'not-probed' | 'not-ready';

export const CHAT_RESPONSE_TIMEOUT_MS = 10 * 60 * 1000;

export interface ProviderReplyState {
  status: 'generating' | 'completed' | 'notSent' | 'failed' | 'timedOut';
  content: string;
  startedAt?: number;
  forwardedFrom?: AIProvider;
  notSentReason?: NotSentReason;
  error?: string;
}

export type DerivedCardState =
  | { status: 'completed'; content: string; forwardedFrom?: AIProvider }
  | { status: 'generating'; content: string; elapsedSeconds: number; forwardedFrom?: AIProvider }
  | { status: 'notSent'; content: string; reason: NotSentReason }
  | { status: 'failed'; content: string; error?: string; forwardedFrom?: AIProvider }
  | { status: 'timedOut'; content: string; elapsedSeconds: number; forwardedFrom?: AIProvider };

export function deriveLoginState(state: ProviderState | undefined): LoginTriState {
  if (state?.login === 'logged_in') return 'loggedIn';
  if (state?.login === 'logged_out' || state?.login === 'blocked') return 'loggedOut';
  return 'unknown';
}

export function deriveCardState({
  providerState,
  selected,
  reply,
  now = Date.now(),
  timeoutMs = CHAT_RESPONSE_TIMEOUT_MS,
}: {
  providerState?: ProviderState;
  selected: boolean;
  reply?: ProviderReplyState;
  now?: number;
  timeoutMs?: number;
}): DerivedCardState {
  if (reply?.status === 'completed') {
    return { status: 'completed', content: reply.content, ...(reply.forwardedFrom ? { forwardedFrom: reply.forwardedFrom } : {}) };
  }
  if (reply?.status === 'failed') {
    return { status: 'failed', content: reply.content, ...(reply.error ? { error: reply.error } : {}), ...(reply.forwardedFrom ? { forwardedFrom: reply.forwardedFrom } : {}) };
  }
  if (reply?.status === 'timedOut') {
    const elapsedSeconds = Math.max(0, Math.floor((now - (reply.startedAt ?? now)) / 1000));
    return { status: 'timedOut', content: reply.content, elapsedSeconds, ...(reply.forwardedFrom ? { forwardedFrom: reply.forwardedFrom } : {}) };
  }
  if (reply?.status === 'generating') {
    const elapsedMs = Math.max(0, now - (reply.startedAt ?? now));
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    if (elapsedMs >= timeoutMs) {
      return { status: 'timedOut', content: reply.content, elapsedSeconds, ...(reply.forwardedFrom ? { forwardedFrom: reply.forwardedFrom } : {}) };
    }
    return { status: 'generating', content: reply.content, elapsedSeconds, ...(reply.forwardedFrom ? { forwardedFrom: reply.forwardedFrom } : {}) };
  }
  if (reply?.status === 'notSent') {
    return { status: 'notSent', content: reply.content, reason: reply.notSentReason ?? 'not-ready' };
  }
  if (!selected) return { status: 'notSent', content: '', reason: 'not-selected' };

  const login = deriveLoginState(providerState);
  if (login === 'loggedOut') return { status: 'notSent', content: '', reason: 'not-logged-in' };
  if (login === 'unknown') return { status: 'notSent', content: '', reason: 'not-probed' };
  if (!providerState || !isSendable(providerState)) return { status: 'notSent', content: '', reason: 'not-ready' };
  return { status: 'notSent', content: '', reason: 'not-ready' };
}

/** Reuse the discussion engine's existing full-reply relay heading and transcript format. */
export function buildForwardMessage(sourceName: string, originalReply: string, note = ''): string {
  const relay = formatDeliberationRelaySection([{ name: sourceName, text: originalReply }]);
  const normalizedNote = note.trim();
  return normalizedNote ? `${relay}\n\n附言：\n${normalizedNote}` : relay;
}

export function insertMarkdownQuote(currentText: string, selectedText: string | undefined, fullReply: string): string {
  const quote = selectedText && selectedText.length > 0 ? selectedText : fullReply;
  const quoted = quote.split('\n').map((line) => `> ${line}`).join('\n');
  if (!currentText) return `${quoted}\n`;
  const separator = currentText.endsWith('\n') ? '\n' : '\n\n';
  return `${currentText}${separator}${quoted}\n`;
}

/** Relay prompts are user messages too, but are not the original question for task conversion. */
export function lastUserQuestion(messages: readonly ConversationSessionMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && !message.forwardedFrom) return message.content;
  }
  return undefined;
}

/** Truncates by line only; it never paraphrases or edits the source text. */
export function truncateReplySummary(content: string, maxLines = 4): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return `${lines.slice(0, maxLines).join('\n')}\n…`;
}

export function buildTaskPrefill(
  question: string,
  summaries: readonly { provider: AIProvider; content: string }[],
  includeSummaries: boolean,
  summaryHeading = '对比摘要',
): string {
  if (!includeSummaries || summaries.length === 0) return question;
  const summaryText = summaries
    .map(({ provider, content }) => `## ${AI_PROVIDERS[provider].name}\n\n${truncateReplySummary(content)}`)
    .join('\n\n');
  return `${question}\n\n---\n\n${summaryHeading}\n\n${summaryText}`;
}

export function busyTargets(targets: readonly AIProvider[], busy: ReadonlySet<AIProvider>): AIProvider[] {
  return [...new Set(targets)].filter((provider) => busy.has(provider));
}

export function classifyResponseContent(content: string): 'completed' | 'failed' | 'timedOut' {
  if (!/^\s*\[Error:/i.test(content)) return 'completed';
  return /time.?out|timed out|timeout/i.test(content) ? 'timedOut' : 'failed';
}

/** Resolve pending providers independently: a completed peer remains completed if another fails. */
export function settlePendingTargets(
  targets: readonly AIProvider[],
  current: Partial<Record<AIProvider, ProviderReplyState>>,
  states: Record<AIProvider, ProviderState>,
): Partial<Record<AIProvider, ProviderReplyState>> {
  const next = { ...current };
  for (const provider of targets) {
    const reply = next[provider];
    if (reply?.status !== 'generating') continue;
    const state = states[provider];
    const login = deriveLoginState(state);
    if (login === 'loggedOut') {
      next[provider] = { status: 'notSent', content: reply.content, notSentReason: 'not-logged-in' };
    } else if (login === 'unknown') {
      next[provider] = { status: 'notSent', content: reply.content, notSentReason: 'not-probed' };
    } else if (!isSendable(state)) {
      next[provider] = { status: 'notSent', content: reply.content, notSentReason: 'not-ready' };
    } else {
      next[provider] = { status: 'failed', content: reply.content, error: 'No final response was received.' };
    }
  }
  return next;
}
