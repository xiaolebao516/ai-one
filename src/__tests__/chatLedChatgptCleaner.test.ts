// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildArchiveScript,
  buildConfirmArchivedScript,
  buildConfirmGoneScript,
  buildDeleteScript,
  buildConfirmScript,
  buildOpenMenuScript,
  createChatGptCleaner,
  normalizeConversationUrl,
} from '../workflow/chatLed/drivers/chatgpt';

const CONVERSATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION_PATH = '/c/' + CONVERSATION_ID;
const CONVERSATION_URL = 'https://chatgpt.com' + CONVERSATION_PATH;

function runPageScript(script: string): string {
  // eslint-disable-next-line no-new-func
  const execute = new Function('window', 'return ' + script) as (target: Window) => unknown;
  return String(execute(window));
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('ChatGPT conversation URL matching', () => {
  it('accepts only canonical conversation UUID URLs on supported origins', () => {
    expect(normalizeConversationUrl(CONVERSATION_URL)?.path).toBe(CONVERSATION_PATH);
    expect(normalizeConversationUrl('https://chat.openai.com' + CONVERSATION_PATH + '?q=1#top')?.id)
      .toBe(CONVERSATION_ID);
    expect(normalizeConversationUrl('https://chatgpt.com' + CONVERSATION_PATH + '?q=1#top')?.href)
      .toBe('https://chatgpt.com' + CONVERSATION_PATH + '?q=1#top');

    expect(normalizeConversationUrl('https://example.test' + CONVERSATION_PATH)).toBeUndefined();
    expect(normalizeConversationUrl('http://chatgpt.com' + CONVERSATION_PATH)).toBeUndefined();
    expect(normalizeConversationUrl(CONVERSATION_URL + '/extra')).toBeUndefined();
    expect(normalizeConversationUrl(CONVERSATION_URL + '/')).toBeUndefined();
    expect(normalizeConversationUrl('https://chatgpt.com/c/not-a-uuid')).toBeUndefined();
    expect(normalizeConversationUrl('https://user:pass@chatgpt.com' + CONVERSATION_PATH)).toBeUndefined();
  });
});

describe('ChatGPT page scripts', () => {
  it('refuses to click the delete action when the pathname does not match', () => {
    window.history.replaceState({}, '', '/c/123e4567-e89b-42d3-a456-426614174001');
    document.body.innerHTML = '<button data-testid="delete-chat-button">Delete</button>';
    const button = document.querySelector('button');
    if (!button) throw new Error('Test fixture button was not created');
    const click = vi.fn();
    button.addEventListener('click', click);

    const result = JSON.parse(runPageScript(buildDeleteScript(CONVERSATION_PATH))) as { ok: boolean; note: string };

    expect(result.ok).toBe(false);
    expect(result.note).toContain('path mismatch');
    expect(click).not.toHaveBeenCalled();
  });

  it('clicks a matching delete action after the pathname guard passes', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = '<button data-testid="delete-chat-button">Delete</button>';
    const button = document.querySelector('button');
    if (!button) throw new Error('Test fixture button was not created');
    const click = vi.fn();
    button.addEventListener('click', click);

    const result = JSON.parse(runPageScript(buildDeleteScript(CONVERSATION_PATH))) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('does not click an archive confirmation while deleting', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<div role="dialog">',
      '<button data-testid="confirm-archive-button">Archive</button>',
      '<button data-testid="confirm-delete-button">Delete</button>',
      '</div>',
    ].join('');
    const archiveButton = document.querySelector('[data-testid="confirm-archive-button"]');
    const deleteButton = document.querySelector('[data-testid="confirm-delete-button"]');
    if (!archiveButton || !deleteButton) throw new Error('Test fixture buttons were not created');
    const archiveClick = vi.fn();
    const deleteClick = vi.fn();
    archiveButton.addEventListener('click', archiveClick);
    deleteButton.addEventListener('click', deleteClick);

    const result = JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(deleteClick).toHaveBeenCalledTimes(1);
    expect(archiveClick).not.toHaveBeenCalled();
  });

  it('opens options and selects archive actions only on the registered path', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<button data-testid="conversation-menu-trigger" aria-label="More options">Options</button>',
      '<div role="menu"><button data-testid="archive-chat-button">Archive</button></div>',
    ].join('');
    const menuButton = document.querySelector('[data-testid="conversation-menu-trigger"]');
    const archiveButton = document.querySelector('[data-testid="archive-chat-button"]');
    if (!menuButton || !archiveButton) throw new Error('Test fixture buttons were not created');
    const menuClick = vi.fn();
    const archiveClick = vi.fn();
    menuButton.addEventListener('click', menuClick);
    archiveButton.addEventListener('click', archiveClick);

    expect(JSON.parse(runPageScript(buildOpenMenuScript(CONVERSATION_PATH))).ok).toBe(true);
    expect(JSON.parse(runPageScript(buildArchiveScript(CONVERSATION_PATH))).ok).toBe(true);
    expect(menuClick).toHaveBeenCalledTimes(1);
    expect(archiveClick).toHaveBeenCalledTimes(1);
  });

  it('confirms deletion only when the page is gone and the sidebar no longer lists the conversation', () => {
    window.history.replaceState({}, '', '/');
    document.body.innerHTML = '<aside data-testid="history"></aside><main><h1>Conversation not found</h1></main>';

    expect(JSON.parse(runPageScript(buildConfirmGoneScript(CONVERSATION_ID))).ok).toBe(true);

    document.body.innerHTML = [
      '<aside data-testid="history"><a href="' + CONVERSATION_PATH + '">Existing conversation</a></aside>',
      '<main><h1>Conversation not found</h1></main>',
    ].join('');
    expect(JSON.parse(runPageScript(buildConfirmGoneScript(CONVERSATION_ID))).ok).toBe(false);
  });

  it('requires a history sidebar and a fresh absence check for archive confirmation', () => {
    document.body.innerHTML = '<aside data-testid="history"></aside>';
    expect(JSON.parse(runPageScript(buildConfirmArchivedScript(CONVERSATION_ID))).ok).toBe(true);

    document.body.innerHTML = '<aside data-testid="history"><a href="' + CONVERSATION_PATH + '">Still listed</a></aside>';
    expect(JSON.parse(runPageScript(buildConfirmArchivedScript(CONVERSATION_ID))).ok).toBe(false);

    document.body.innerHTML = '<main>No sidebar loaded</main>';
    expect(JSON.parse(runPageScript(buildConfirmArchivedScript(CONVERSATION_ID))).ok).toBe(false);
  });
});

describe('ChatGPT cleaner orchestration', () => {
  it('navigates to the normalized URL and runs guarded deletion stages', async () => {
    const responses = [
      JSON.stringify({ ok: true, note: 'menu opened' }),
      JSON.stringify({ ok: true, note: 'delete selected' }),
      JSON.stringify({ ok: true, note: 'confirmed' }),
    ];
    const evalInPage = vi.fn(async (_script: string) => responses.shift() ?? JSON.stringify({ ok: false }));
    const navigate = vi.fn(async (_url: string) => undefined);
    const sleep = vi.fn(async (_ms: number) => undefined);
    const cleaner = createChatGptCleaner({ evalInPage, navigate, sleep });
    const url = CONVERSATION_URL + '?source=test#latest';

    expect(cleaner.matchesConversationUrl(url)).toBe(true);
    const result = await cleaner.deleteConversation(url);

    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith(url);
    expect(evalInPage).toHaveBeenCalledTimes(3);
    expect(evalInPage.mock.calls.every(([script]) => script.includes('window.location.pathname !== expectedPath'))).toBe(true);
  });

  it('does not navigate or evaluate scripts for an unsupported URL', async () => {
    const evalInPage = vi.fn(async (_script: string) => JSON.stringify({ ok: true }));
    const navigate = vi.fn(async (_url: string) => undefined);
    const sleep = vi.fn(async (_ms: number) => undefined);
    const cleaner = createChatGptCleaner({ evalInPage, navigate, sleep });

    const result = await cleaner.deleteConversation('https://example.test/c/' + CONVERSATION_ID);

    expect(result.ok).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(evalInPage).not.toHaveBeenCalled();
  });
});
