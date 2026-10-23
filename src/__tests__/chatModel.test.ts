import { describe, expect, it } from 'vitest';
import type { AIProvider, ProviderState } from '../../shared/types';
import {
  CHAT_PRESET_IDS,
  buildForwardMessage,
  buildTaskPrefill,
  busyTargets,
  deriveCardState,
  deriveLoginState,
  insertMarkdownQuote,
  lastUserQuestion,
  settlePendingTargets,
  truncateReplySummary,
  type ProviderReplyState,
} from '../workbench/views/chat/chatModel';

function state(provider: AIProvider, overrides: Partial<ProviderState> = {}): ProviderState {
  return {
    provider,
    webview: 'loaded',
    dom: 'ready',
    login: 'logged_in',
    thinking: false,
    lastStatusAt: 1,
    bridge: 'ok',
    adapter: 'ok',
    ...overrides,
  };
}

describe('chat model login and card state', () => {
  it('keeps login as a real three-state value', () => {
    expect(deriveLoginState(state('chatgpt', { login: 'logged_in' }))).toBe('loggedIn');
    expect(deriveLoginState(state('chatgpt', { login: 'logged_out' }))).toBe('loggedOut');
    expect(deriveLoginState(state('chatgpt', { login: 'blocked' }))).toBe('loggedOut');
    expect(deriveLoginState(state('chatgpt', { login: 'unknown' }))).toBe('unknown');
    expect(deriveLoginState(undefined)).toBe('unknown');
  });

  it('derives all five card states and the timeout boundary', () => {
    expect(deriveCardState({ providerState: state('chatgpt'), selected: true, reply: { status: 'completed', content: 'full reply' } }))
      .toMatchObject({ status: 'completed', content: 'full reply' });
    expect(deriveCardState({ providerState: state('chatgpt'), selected: true, reply: { status: 'generating', content: 'partial', startedAt: 1_000 }, now: 12_999 }))
      .toMatchObject({ status: 'generating', elapsedSeconds: 11, content: 'partial' });
    expect(deriveCardState({ providerState: state('chatgpt'), selected: true, reply: { status: 'generating', content: 'partial', startedAt: 1_000 }, now: 601_000 }))
      .toMatchObject({ status: 'timedOut', elapsedSeconds: 600 });
    expect(deriveCardState({ providerState: state('chatgpt'), selected: false }))
      .toMatchObject({ status: 'notSent', reason: 'not-selected' });
    expect(deriveCardState({ providerState: state('chatgpt', { login: 'logged_out' }), selected: true }))
      .toMatchObject({ status: 'notSent', reason: 'not-logged-in' });
    expect(deriveCardState({ providerState: state('chatgpt', { login: 'unknown' }), selected: true }))
      .toMatchObject({ status: 'notSent', reason: 'not-probed' });
    expect(deriveCardState({ providerState: state('chatgpt'), selected: true, reply: { status: 'failed', content: 'error', error: 'failed' } }))
      .toMatchObject({ status: 'failed', content: 'error' });
  });

  it('keeps the original relay text intact and appends an optional note', () => {
    const original = 'line one\n\nline two — '.repeat(900);
    const forwarded = buildForwardMessage('ChatGPT', original, 'Check the second section');
    expect(forwarded).toContain('以下是另一位 AI 的新回复（完整内容，本对话尚未收到过）：');
    expect(forwarded).toContain(`独立初答 · ChatGPT\n${original}`);
    expect(forwarded.endsWith('附言：\nCheck the second section')).toBe(true);
    expect(buildForwardMessage('Claude', original)).not.toContain('附言：');
    expect(forwarded).toContain(original);
  });

  it('quotes the selected snippet or the complete reply into the existing draft', () => {
    expect(insertMarkdownQuote('existing', 'selected\nsecond', 'full reply')).toBe('existing\n\n> selected\n> second\n');
    expect(insertMarkdownQuote('', undefined, 'first\nsecond')).toBe('> first\n> second\n');
  });

  it('exposes exactly the four chat presets and detects busy targets', () => {
    expect(CHAT_PRESET_IDS).toEqual(['free', 'debate', 'consult', 'deliberation']);
    expect(busyTargets(['chatgpt', 'claude', 'chatgpt'], new Set<AIProvider>(['claude']))).toEqual(['claude']);
  });

  it('converts the last real question and settles each provider independently', () => {
    const question = lastUserQuestion([
      { id: 'q', role: 'user', content: 'Original question' },
      { id: 'relay', role: 'user', content: 'relay body', forwardedFrom: 'chatgpt' },
    ]);
    expect(question).toBe('Original question');
    expect(buildTaskPrefill('Question', [{ provider: 'chatgpt', content: 'one\ntwo\nthree\nfour\nfive' }], true))
      .toContain('one\ntwo\nthree\nfour\n…');
    expect(truncateReplySummary('one\ntwo', 4)).toBe('one\ntwo');

    const current: Partial<Record<AIProvider, ProviderReplyState>> = {
      chatgpt: { status: 'completed', content: 'success' },
      claude: { status: 'generating', content: 'partial', startedAt: 10 },
    };
    const settled = settlePendingTargets(['chatgpt', 'claude'], current, {
      chatgpt: state('chatgpt'),
      claude: state('claude'),
      gemini: state('gemini'),
      grok: state('grok'),
      meta: state('meta'),
    });
    expect(settled.chatgpt).toMatchObject({ status: 'completed', content: 'success' });
    expect(settled.claude).toMatchObject({ status: 'failed', content: 'partial' });
  });
});
