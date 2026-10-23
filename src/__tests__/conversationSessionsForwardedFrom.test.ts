import { describe, expect, it } from 'vitest';
import { bubblesFromSession, conversationMessages } from '../ui/legacyConversationAdapters';
import {
  createConversationSession,
  normalizeConversationSessionMessage,
  sessionContentChanged,
  type ConversationSessionMessage,
} from '../ui/conversationSessions';

describe('forwarded conversation message metadata', () => {
  it('normalizes a valid forwarding source and ignores an unknown provider', () => {
    expect(normalizeConversationSessionMessage({
      id: 'relay-1',
      role: 'user',
      content: 'full relay prompt',
      forwardedFrom: 'chatgpt',
    })).toMatchObject({
      id: 'relay-1',
      role: 'user',
      content: 'full relay prompt',
      forwardedFrom: 'chatgpt',
    });
    expect(normalizeConversationSessionMessage({
      id: 'relay-2',
      role: 'ai',
      content: 'reply',
      forwardedFrom: 'not-a-provider',
    })).not.toHaveProperty('forwardedFrom');
  });

  it('round-trips forwardedFrom through the classic UI adapters', () => {
    const message: ConversationSessionMessage = {
      id: 'relay-round-trip',
      role: 'user',
      content: 'complete forwarded prompt',
      forwardedFrom: 'chatgpt',
      final: true,
    };
    const session = createConversationSession({ id: 'round-trip', messages: [message], now: 20 });
    const classicBubbles = bubblesFromSession(session);
    expect(classicBubbles[0]?.forwardedFrom).toBe('chatgpt');
    expect(conversationMessages(classicBubbles)[0]?.forwardedFrom).toBe('chatgpt');
  });

  it('treats forwarding metadata as a persisted content change without changing message fields', () => {
    const original: ConversationSessionMessage = {
      id: 'relay-1',
      role: 'user',
      content: 'full relay prompt',
    };
    const forwarded: ConversationSessionMessage = { ...original, forwardedFrom: 'claude' };
    const session = createConversationSession({ messages: [original], now: 10 });
    expect(sessionContentChanged(session, [original], 'free')).toBe(false);
    expect(sessionContentChanged(session, [forwarded], 'free')).toBe(true);
    expect(normalizeConversationSessionMessage({ ...forwarded, authorLabel: 'User' })).toMatchObject({
      role: 'user',
      content: 'full relay prompt',
      authorLabel: 'User',
      forwardedFrom: 'claude',
    });
  });
});
