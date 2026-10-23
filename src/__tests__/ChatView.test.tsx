// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_AI_PROVIDERS } from '../../shared/constants';
import type { AIProvider, ProviderState } from '../../shared/types';
import { createConversationSession } from '../ui/conversationSessions';
import { I18nProvider } from '../i18n/context';
import { ChatView } from '../workbench/views/chat/ChatView';
import { CHAT_RESPONSE_TIMEOUT_MS } from '../workbench/views/chat/chatModel';
import type { ChatRuntime } from '../workbench/views/chat/useChatRuntime';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.reject(new Error('no tauri'))),
  isTauri: vi.fn(() => false),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));

const mounted: { root: Root; container: HTMLElement }[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});

afterEach(async () => {
  for (const { root } of mounted.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
});

function providerState(provider: AIProvider): ProviderState {
  return {
    provider,
    webview: 'loaded',
    dom: 'ready',
    login: 'logged_in',
    thinking: false,
    lastStatusAt: 5_000_000,
    bridge: 'ok',
    adapter: 'ok',
  };
}

function fakeRuntime(overrides: Partial<ChatRuntime> = {}): ChatRuntime {
  const now = 5_000_000;
  const session = createConversationSession({
    id: 'chat-test',
    title: 'Test chat',
    mode: 'free',
    now,
    messages: [
      { id: 'question-1', role: 'user', content: 'What should I compare?' },
      { id: 'answer-1', role: 'ai', provider: 'chatgpt', content: 'Complete original reply\nSecond line', final: true },
    ],
  });
  const providerStates = Object.fromEntries(ALL_AI_PROVIDERS.map((provider) => [provider, providerState(provider)])) as Record<AIProvider, ProviderState>;
  const runtime: ChatRuntime = {
    providerStates,
    sessions: [session],
    activeSessionId: session.id,
    activeSession: session,
    replyStates: {
      chatgpt: { status: 'completed', content: 'Complete original reply\nSecond line' },
      claude: { status: 'generating', content: 'partial', startedAt: now - 2_000 },
      gemini: { status: 'notSent', content: '', notSentReason: 'not-selected' },
      grok: { status: 'failed', content: '[Error: provider failed]', error: 'provider failed' },
    },
    comparisonTargets: ['chatgpt', 'claude', 'grok'],
    selectedTargets: ['chatgpt'],
    busyProviders: ['claude'],
    now,
    notice: undefined,
    desktopAvailable: false,
    setSelectedTargets: vi.fn(),
    clearNotice: vi.fn(),
    newConversation: vi.fn(),
    selectSession: vi.fn(),
    renameSession: vi.fn(),
    deleteSession: vi.fn(),
    sendMessage: vi.fn(async () => true),
    forwardMessage: vi.fn(async () => true),
    retryProvider: vi.fn(async () => true),
    skipProvider: vi.fn(),
    setPreset: vi.fn(),
  };
  return { ...runtime, ...overrides };
}

async function mount(runtime: ChatRuntime) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(
    <I18nProvider language="en">
      <ChatView locale="en" runtime={runtime} onConvertToTask={() => {}} onStartGrill={() => {}} />
    </I18nProvider>,
  ));
  return { root, container };
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('button not found');
  await act(async () => (element as HTMLElement).click());
}

function buttonByText(container: ParentNode, value: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === value) as HTMLButtonElement | undefined;
}

describe('ChatView', () => {
  it('renders completed, generating, not-sent, failed and timed-out card states', async () => {
    const runtime = fakeRuntime();
    const { root, container } = await mount(runtime);
    expect(container.textContent).toContain('Completed');
    expect(container.textContent).toContain('Replying · 2s');
    expect(container.textContent).toContain('Not selected');
    expect(container.textContent).toContain('Failed');
    const options = [...container.querySelectorAll<HTMLOptionElement>('#chat-preset-select option')];
    expect(options.map((option) => option.value)).toEqual(['free', 'debate', 'consult', 'deliberation']);

    const timedOutRuntime = {
      ...runtime,
      replyStates: {
        ...runtime.replyStates,
        chatgpt: { status: 'generating' as const, content: 'partial reply', startedAt: runtime.now - CHAT_RESPONSE_TIMEOUT_MS },
      },
    };
    await act(async () => root.render(
      <I18nProvider language="en">
        <ChatView locale="en" runtime={timedOutRuntime} onConvertToTask={() => {}} onStartGrill={() => {}} />
      </I18nProvider>,
    ));
    expect(container.textContent).toContain('Timed out · 600s');
  });

  it('forwards the complete source reply with the chosen recipient and optional note', async () => {
    const original = 'Full response line one\n\nFull response line two — keep every character.';
    const runtime = fakeRuntime({
      replyStates: {
        chatgpt: { status: 'completed', content: original },
      },
      busyProviders: [],
    });
    const { container } = await mount(runtime);
    const chatgptCard = [...container.querySelectorAll('article')].find((card) => card.querySelector('h2')?.textContent === 'ChatGPT');
    await click(buttonByText(chatgptCard ?? container, 'Forward to…'));
    await click(buttonByText(chatgptCard ?? container, 'Claude'));

    const note = container.querySelector<HTMLTextAreaElement>('#chat-forward-note-chatgpt');
    if (!note) throw new Error('forward note input not found');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(note, 'Check the second section');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonByText(chatgptCard ?? container, 'Send forward'));
    await act(async () => Promise.resolve());
    expect(runtime.forwardMessage).toHaveBeenCalledWith('chatgpt', original, ['claude'], 'Check the second section');
  });

});
