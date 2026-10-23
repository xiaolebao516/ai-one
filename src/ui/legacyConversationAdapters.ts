import type { AIProvider } from '../../shared/types';
import type { ConversationSession, ConversationSessionMessage } from './conversationSessions';

/** The classic App.tsx bubble shape, kept separate so its session adapter can be regression-tested. */
export interface LegacyConversationBubble {
  id: string;
  provider?: AIProvider | 'system' | (string & {});
  authorLabel?: string;
  role: 'user' | 'ai';
  content: string;
  final?: boolean;
  truncated?: boolean;
  modeRole?: string;
  forwardedFrom?: AIProvider;
}

export function conversationMessages(messages: readonly LegacyConversationBubble[]): ConversationSessionMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.provider ? { provider: message.provider } : {}),
    ...(message.authorLabel ? { authorLabel: message.authorLabel } : {}),
    ...(message.modeRole ? { modeRole: message.modeRole } : {}),
    ...(message.forwardedFrom ? { forwardedFrom: message.forwardedFrom } : {}),
    ...(typeof message.final === 'boolean' ? { final: message.final } : {}),
    ...(typeof message.truncated === 'boolean' ? { truncated: message.truncated } : {}),
  }));
}

export function bubblesFromSession(session: ConversationSession): LegacyConversationBubble[] {
  return session.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.provider ? { provider: message.provider } : {}),
    ...(message.authorLabel ? { authorLabel: message.authorLabel } : {}),
    ...(message.modeRole ? { modeRole: message.modeRole } : {}),
    ...(message.forwardedFrom ? { forwardedFrom: message.forwardedFrom } : {}),
    ...(typeof message.final === 'boolean' ? { final: message.final } : {}),
    ...(typeof message.truncated === 'boolean' ? { truncated: message.truncated } : {}),
  }));
}
