// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildArchiveScript,
  buildConfirmArchivedScript,
  buildConfirmGoneScript,
  buildDeleteScript,
  buildSnapshotScript,
  buildConfirmScript,
  buildOpenMenuScript,
  createChatGptCleaner,
  normalizeConversationUrl,
} from '../workflow/chatLed/drivers/chatgpt';

const CONVERSATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION_PATH = '/c/' + CONVERSATION_ID;
const CONVERSATION_URL = 'https://chatgpt.com' + CONVERSATION_PATH;

function runPageScript(script: string): string {
  const execute = new Function('window', 'return ' + script) as (target: Window) => unknown;
  return String(execute(window));
}

const OTHER_ID_PATH = '/c/123e4567-e89b-42d3-a456-426614174999';

function arm(action: 'delete' | 'archive', path = CONVERSATION_PATH, at = Date.now()): void {
  const globals = window as unknown as Record<string, unknown>;
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]');
  globals.__aiOneArmed = JSON.stringify({ path, action, at, targetTitle: 'Mine' });
  globals.__aiOneDialogWatch = {
    path, action, at, targetTitle: 'Mine', dialog, invalid: false, observer: { disconnect: vi.fn() },
  };
}

beforeEach(() => {
  const globals = window as unknown as Record<string, unknown>;
  const watch = globals.__aiOneDialogWatch as { observer?: { disconnect?: () => void } } | undefined;
  watch?.observer?.disconnect?.();
  delete globals.__aiOneArmed;
  delete globals.__aiOneDialogWatch;
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
    document.body.innerHTML = [
      '<h1>Mine</h1>',
      '<button data-testid="conversation-options-menu" id="trigger" aria-expanded="true" aria-controls="menu-1">Options</button>',
      '<div role="menu" id="menu-1"><button data-testid="delete-chat-button">Delete</button></div>',
    ].join('');
    const button = document.querySelector('[data-testid="delete-chat-button"]');
    if (!button) throw new Error('Test fixture button was not created');
    const click = vi.fn();
    button.addEventListener('click', click);

    const result = JSON.parse(runPageScript(buildDeleteScript(CONVERSATION_PATH))) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });



  it('refuses destructive actions when only a generic conversation label can be proven', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<nav aria-label="History"><div><a href="' + CONVERSATION_PATH + '">Conversation</a><button data-testid="conversation-options-menu" id="trigger" aria-expanded="true" aria-controls="menu-1">Options</button></div></nav>',
      '<div role="menu" id="menu-1"><button data-testid="delete-chat-button" id="delete">Delete</button></div>',
    ].join('');
    const click = vi.fn();
    document.getElementById('delete')?.addEventListener('click', click);

    const result = JSON.parse(runPageScript(buildDeleteScript(CONVERSATION_PATH))) as { ok: boolean };

    expect(result.ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('fails closed when pointerdown does not actually open the target menu', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = '<h1>Mine</h1><button data-testid="conversation-options-menu" id="trigger" aria-expanded="false">Options</button>';
    const pointerDown = vi.fn();
    document.getElementById('trigger')?.addEventListener('pointerdown', pointerDown);

    const result = JSON.parse(runPageScript(buildOpenMenuScript(CONVERSATION_PATH))) as { ok: boolean; note: string };

    expect(result.ok).toBe(false);
    expect(result.note).toContain('did not open');
    expect(pointerDown).toHaveBeenCalledTimes(1);
  });

  it('does not click an archive confirmation while deleting', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<div role="dialog" aria-modal="true"><p>Delete Mine?</p>',
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

    arm('delete');
    const result = JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(deleteClick).toHaveBeenCalledTimes(1);
    expect(archiveClick).not.toHaveBeenCalled();
  });

  it('opens options and selects archive actions only on the registered path', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<h1>Mine</h1>',
      '<button data-testid="conversation-options-menu" aria-label="Conversation options" id="trigger" aria-expanded="true" aria-controls="menu-1">Options</button>',
      '<div role="menu" id="menu-1"><button data-testid="archive-chat-button">Archive</button></div>',
    ].join('');
    const menuButton = document.querySelector('[data-testid="conversation-options-menu"]');
    const archiveButton = document.querySelector('[data-testid="archive-chat-button"]');
    if (!menuButton || !archiveButton) throw new Error('Test fixture buttons were not created');
    const menuClick = vi.fn();
    const archiveClick = vi.fn();
    menuButton.addEventListener('pointerdown', menuClick);
    archiveButton.addEventListener('click', archiveClick);

    expect(JSON.parse(runPageScript(buildOpenMenuScript(CONVERSATION_PATH))).ok).toBe(true);
    expect(JSON.parse(runPageScript(buildArchiveScript(CONVERSATION_PATH))).ok).toBe(true);
    expect(menuClick).toHaveBeenCalledTimes(1);
    expect(archiveClick).toHaveBeenCalledTimes(1);
  });

  it('confirms deletion only when the page is gone and the sidebar no longer lists the conversation', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = '<aside data-testid="history"></aside><main><h1>Conversation not found</h1></main>';

    expect(JSON.parse(runPageScript(buildConfirmGoneScript(CONVERSATION_ID))).ok).toBe(true);

    document.body.innerHTML = [
      '<aside data-testid="history"><a href="' + CONVERSATION_PATH + '">Existing conversation</a></aside>',
      '<main><h1>Conversation not found</h1></main>',
    ].join('');
    expect(JSON.parse(runPageScript(buildConfirmGoneScript(CONVERSATION_ID))).ok).toBe(false);
  });

  it('requires a history sidebar and a fresh absence check for archive confirmation', () => {
    // An empty or still-loading history list proves nothing.
    document.body.innerHTML = '<aside data-testid="history"></aside>';
    expect(JSON.parse(runPageScript(buildConfirmArchivedScript(CONVERSATION_ID))).ok).toBe(false);

    // Other conversations were listed before the action and are all still there: evidence.
    document.body.innerHTML = '<aside data-testid="history"><a href="' + OTHER_ID_PATH + '">Other</a></aside>';
    expect(JSON.parse(runPageScript(buildConfirmArchivedScript(CONVERSATION_ID, [OTHER_ID_PATH]))).ok).toBe(true);
    // No snapshot (nothing to compare with): never confirmed.
    expect(JSON.parse(runPageScript(buildConfirmArchivedScript(CONVERSATION_ID))).ok).toBe(false);
    // Partially loaded list: a conversation that was listed before is missing, so the list is incomplete.
    document.body.innerHTML = '<aside data-testid="history"><a href="/c/123e4567-e89b-42d3-a456-426614174888">Another</a></aside>';
    expect(JSON.parse(runPageScript(buildConfirmArchivedScript(CONVERSATION_ID, [OTHER_ID_PATH]))).ok).toBe(false);

    document.body.innerHTML = '<aside data-testid="history"><a href="' + CONVERSATION_PATH + '">Still listed</a></aside>';
    expect(JSON.parse(runPageScript(buildConfirmArchivedScript(CONVERSATION_ID))).ok).toBe(false);

    document.body.innerHTML = '<main>No sidebar loaded</main>';
    expect(JSON.parse(runPageScript(buildConfirmArchivedScript(CONVERSATION_ID))).ok).toBe(false);
  });
});

describe('ChatGPT page scripts: only the registered conversation is touched', () => {
  it('finds the nested current ChatGPT row but never climbs into a multi-conversation container', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = '<nav aria-label="聊天记录"><div><div><div><a href="' + CONVERSATION_PATH + '">Mine</a></div></div><button aria-haspopup="menu" aria-expanded="false" aria-label="聊天操作" id="mine">...</button></div><div><a href="' + OTHER_ID_PATH + '">Other</a><button aria-label="More options" id="other">...</button></div></nav>';
    const mine = vi.fn(() => {
      const trigger = document.getElementById('mine');
      trigger?.setAttribute('aria-expanded', 'true');
      trigger?.setAttribute('aria-controls', 'menu-mine');
      const menu = document.createElement('div');
      menu.id = 'menu-mine';
      menu.setAttribute('role', 'menu');
      document.body.append(menu);
    });
    const other = vi.fn();
    document.getElementById('mine')?.addEventListener('pointerdown', mine);
    document.getElementById('other')?.addEventListener('pointerdown', other);
    expect(JSON.parse(runPageScript(buildOpenMenuScript(CONVERSATION_PATH))).ok).toBe(true);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    document.getElementById('mine')?.remove();
    expect(JSON.parse(runPageScript(buildOpenMenuScript(CONVERSATION_PATH))).ok).toBe(false);
    expect(other).not.toHaveBeenCalled();
  });

  const OTHER_PATH = '/c/123e4567-e89b-42d3-a456-426614174777';

  it('opens the options menu of the registered sidebar row, never another conversation row', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<nav><ul>',
      '<li><a href="' + OTHER_PATH + '">Other</a><button aria-label="More options" id="other">...</button></li>',
      '<li><a href="' + CONVERSATION_PATH + '">Mine</a><button aria-label="More options" id="mine">...</button></li>',
      '</ul></nav>',
    ].join('');
    const other = vi.fn();
    const mine = vi.fn();
    document.getElementById('other')?.addEventListener('click', other);
    document.getElementById('mine')?.addEventListener('click', mine);

    expect(JSON.parse(runPageScript(buildOpenMenuScript(CONVERSATION_PATH))).ok).toBe(true);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('does not click a sidebar options button when the registered row is not listed', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = '<nav><ul><li><a href="' + OTHER_PATH + '">Other</a><button aria-label="More options" id="other">...</button></li></ul></nav>';
    const other = vi.fn();
    document.getElementById('other')?.addEventListener('click', other);

    expect(JSON.parse(runPageScript(buildOpenMenuScript(CONVERSATION_PATH))).ok).toBe(false);
    expect(other).not.toHaveBeenCalled();
  });

  it('refuses to pick a delete action unless exactly one options menu is open', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<button data-testid="delete-chat-button" id="stray">Delete</button>',
      '<div role="menu"><button data-testid="delete-chat-button" id="a">Delete</button></div>',
      '<div role="menu"><button data-testid="delete-chat-button" id="b">Delete</button></div>',
    ].join('');
    const clicks = vi.fn();
    for (const id of ['stray', 'a', 'b']) document.getElementById(id)?.addEventListener('click', clicks);

    expect(JSON.parse(runPageScript(buildDeleteScript(CONVERSATION_PATH))).ok).toBe(false);
    expect(clicks).not.toHaveBeenCalled();

    // No menu at all: a loose Delete button elsewhere on the page must not be clicked either.
    document.body.innerHTML = '<button data-testid="delete-chat-button" id="stray">Delete</button>';
    document.getElementById('stray')?.addEventListener('click', clicks);
    expect(JSON.parse(runPageScript(buildDeleteScript(CONVERSATION_PATH))).ok).toBe(false);
    expect(clicks).not.toHaveBeenCalled();
  });

  it('requires exactly one confirmation dialog before confirming a delete', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<button data-testid="confirm-delete-button" id="stray">Delete</button>',
      '<div role="dialog" aria-modal="true"><button id="a">Delete</button></div>',
      '<div role="dialog" aria-modal="true"><button id="b">Delete</button></div>',
    ].join('');
    const clicks = vi.fn();
    for (const id of ['stray', 'a', 'b']) document.getElementById(id)?.addEventListener('click', clicks);

    expect(JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))).ok).toBe(false);
    expect(clicks).not.toHaveBeenCalled();
  });
});

describe('ChatGPT page scripts: ownership and readback fail closed', () => {
  const OTHER_PATH = '/c/123e4567-e89b-42d3-a456-426614174777';

  it('refuses a single open menu that belongs to another conversation row', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<nav><ul>',
      '<li><a href="' + OTHER_PATH + '">Other</a><button id="other" aria-label="More options" aria-expanded="true" aria-controls="menu-other">...</button></li>',
      '<li><a href="' + CONVERSATION_PATH + '">Mine</a><button id="mine" aria-label="More options" aria-expanded="false" aria-controls="menu-mine">...</button></li>',
      '</ul></nav>',
      '<div role="menu" id="menu-other"><button data-testid="delete-chat-button" id="del">Delete</button></div>',
    ].join('');
    const click = vi.fn();
    document.getElementById('del')?.addEventListener('click', click);

    expect(JSON.parse(runPageScript(buildDeleteScript(CONVERSATION_PATH))).ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('accepts the menu that the registered row trigger controls', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<nav><ul>',
      '<li><a href="' + CONVERSATION_PATH + '">Mine</a><button id="mine" aria-label="More options" aria-expanded="true" aria-controls="menu-mine">...</button></li>',
      '</ul></nav>',
      '<div role="menu" id="menu-mine"><button data-testid="delete-chat-button" id="del">Delete</button></div>',
    ].join('');
    const click = vi.fn();
    document.getElementById('del')?.addEventListener('click', click);

    expect(JSON.parse(runPageScript(buildDeleteScript(CONVERSATION_PATH))).ok).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('refuses to confirm while a menu is still open or the target trigger is still expanded', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<nav><ul><li><a href="' + CONVERSATION_PATH + '">Mine</a><button id="mine" aria-label="More options" aria-expanded="true" aria-controls="menu-mine">...</button></li></ul></nav>',
      '<div role="dialog" aria-modal="true"><button id="ok">Delete</button></div>',
    ].join('');
    const click = vi.fn();
    document.getElementById('ok')?.addEventListener('click', click);
    expect(JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))).ok).toBe(false);

    document.body.innerHTML = [
      '<div role="menu"><button>Other</button></div>',
      '<div role="dialog" aria-modal="true"><button id="ok">Delete</button></div>',
    ].join('');
    document.getElementById('ok')?.addEventListener('click', click);
    expect(JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))).ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('does not confirm when the history list is loading, ambiguous, or an empty home page', () => {
    window.history.replaceState({}, '', '/');
    // still loading
    document.body.innerHTML = '<aside data-testid="history"><div aria-busy="true"></div><a href="' + OTHER_ID_PATH + '">x</a></aside>';
    expect(JSON.parse(runPageScript(buildConfirmArchivedScript(CONVERSATION_ID, [OTHER_ID_PATH]))).ok).toBe(false);
    // two possible sidebars
    document.body.innerHTML = '<aside data-testid="history"><a href="' + OTHER_ID_PATH + '">x</a></aside><div data-testid="history"></div>';
    expect(JSON.parse(runPageScript(buildConfirmArchivedScript(CONVERSATION_ID, [OTHER_ID_PATH]))).ok).toBe(false);
    // deleted: home page with an empty list and no explicit not-found evidence proves nothing
    document.body.innerHTML = '<aside data-testid="history"></aside><main><p>Welcome</p></main>';
    expect(JSON.parse(runPageScript(buildConfirmGoneScript(CONVERSATION_ID))).ok).toBe(false);
    // deleted: home page that still lists everything seen before the action is evidence...
    document.body.innerHTML = '<aside data-testid="history"><a href="' + OTHER_ID_PATH + '">x</a></aside><main><p>Welcome</p></main>';
    expect(JSON.parse(runPageScript(buildConfirmGoneScript(CONVERSATION_ID, [OTHER_ID_PATH]))).ok).toBe(true);
    // ...but not when part of the previously seen list is missing (still loading)
    document.body.innerHTML = '<aside data-testid="history"><a href="/c/123e4567-e89b-42d3-a456-426614174888">x</a></aside><main><p>Welcome</p></main>';
    expect(JSON.parse(runPageScript(buildConfirmGoneScript(CONVERSATION_ID, [OTHER_ID_PATH]))).ok).toBe(false);
    // deleted: explicit not-found evidence is enough even with an empty list
    document.body.innerHTML = '<aside data-testid="history"></aside><main><h1>Conversation not found</h1></main>';
    expect(JSON.parse(runPageScript(buildConfirmGoneScript(CONVERSATION_ID))).ok).toBe(true);
  });

  it('picks the most specific unique history container even when a broad aside wraps it', () => {
    window.history.replaceState({}, '', '/');
    document.body.innerHTML =
      '<aside><nav aria-label="聊天记录"><a href="' + OTHER_ID_PATH + '">x</a></nav></aside><main><h1>Conversation not found</h1></main>';
    expect(JSON.parse(runPageScript(buildConfirmGoneScript(CONVERSATION_ID, [OTHER_ID_PATH]))).ok).toBe(true);
  });

  it('needs the readback evidence to hold twice', async () => {
    const answers = [JSON.stringify({ ok: true }), JSON.stringify({ ok: false, note: 'flaky' })];
    const evalInPage = vi.fn(async (_script: string) => answers.shift() ?? JSON.stringify({ ok: false }));
    const cleaner = createChatGptCleaner({ evalInPage, navigate: vi.fn(async () => undefined), sleep: vi.fn(async () => undefined) });
    expect(await cleaner.confirmGone(CONVERSATION_URL)).toBe(false);
    expect(evalInPage).toHaveBeenCalledTimes(2);
  });
});

describe('ChatGPT page scripts: the confirmation must come from our own click', () => {
  it('does not click a lone dialog that nothing armed (stray or belonging to another conversation)', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = '<div role="dialog" aria-modal="true"><p>Delete Mine?</p><button id="ok">Delete</button></div>';
    const click = vi.fn();
    document.getElementById('ok')?.addEventListener('click', click);

    expect(JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))).ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('rejects a marker for another path, another action, or a stale marker, and consumes it', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = '<div role="dialog" aria-modal="true"><p>Delete Mine?</p><button id="ok">Delete</button></div>';
    const click = vi.fn();
    document.getElementById('ok')?.addEventListener('click', click);

    arm('delete', '/c/123e4567-e89b-42d3-a456-426614174777');
    expect(JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))).ok).toBe(false);
    arm('archive');
    expect(JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))).ok).toBe(false);
    arm('delete', CONVERSATION_PATH, Date.now() - 60_000);
    expect(JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))).ok).toBe(false);
    expect(click).not.toHaveBeenCalled();

    // a valid marker works exactly once
    arm('delete');
    expect(JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))).ok).toBe(true);
    expect(JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))).ok).toBe(false);
    expect(click).toHaveBeenCalledTimes(1);
  });


  it('rejects a newly armed Delete dialog whose body names another conversation', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = '<div role="dialog" aria-modal="true"><p>Delete Other chat?</p><button id="ok">Delete</button></div>';
    const click = vi.fn();
    document.getElementById('ok')?.addEventListener('click', click);
    arm('delete');

    expect(JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))).ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('confirms only the dialog node observed after the registered target action', async () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<div role="dialog" aria-modal="false"><p>Completed task</p></div>',
      '<nav aria-label="History"><div><a href="' + CONVERSATION_PATH + '">Mine</a><button data-testid="conversation-options-menu" id="trigger" aria-expanded="true" aria-controls="menu-1">Options</button></div></nav>',
      '<div role="menu" id="menu-1"><button data-testid="delete-chat-button" id="delete">Delete</button></div>',
    ].join('');
    const deleteClick = vi.fn(() => {
      document.getElementById('trigger')?.setAttribute('aria-expanded', 'false');
      document.getElementById('menu-1')?.remove();
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.innerHTML = '<p>Delete Mine?</p><button data-testid="confirm-delete-button" id="confirm">Delete</button>';
      document.body.append(dialog);
    });
    const confirmClick = vi.fn();
    document.getElementById('delete')?.addEventListener('click', deleteClick);
    document.body.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).id === 'confirm') confirmClick();
    });

    expect(JSON.parse(runPageScript(buildDeleteScript(CONVERSATION_PATH))).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(runPageScript(buildConfirmScript(CONVERSATION_PATH, 'delete'))).ok).toBe(true);
    expect(deleteClick).toHaveBeenCalledTimes(1);
    expect(confirmClick).toHaveBeenCalledTimes(1);
  });

  it('refuses to start the delete when a dialog is already open (it could never be told apart later)', () => {
    window.history.replaceState({}, '', CONVERSATION_PATH);
    document.body.innerHTML = [
      '<h1>Mine</h1>',
      '<button data-testid="conversation-options-menu" id="trigger" aria-expanded="true" aria-controls="menu-1">Options</button>',
      '<div role="menu" id="menu-1"><button data-testid="delete-chat-button" id="del">Delete</button></div>',
      '<div role="dialog" aria-modal="true"><button>Something else</button></div>',
    ].join('');
    const click = vi.fn();
    document.getElementById('del')?.addEventListener('click', click);

    expect(JSON.parse(runPageScript(buildDeleteScript(CONVERSATION_PATH))).ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
    expect((window as unknown as Record<string, unknown>).__aiOneArmed).toBeUndefined();
  });
});

describe('ChatGPT cleaner orchestration', () => {
  it('requires the target to be positively present before attempting cleanup', async () => {
    const evalInPage = vi.fn(async () => JSON.stringify(JSON.stringify({
      ok: true, targetPresent: false, others: [OTHER_ID_PATH],
    })));
    const navigate = vi.fn(async () => undefined);
    const cleaner = createChatGptCleaner({ evalInPage, navigate, sleep: vi.fn(async () => undefined) });

    const result = await cleaner.deleteConversation(CONVERSATION_URL);

    expect(result.ok).toBe(false);
    expect(result.note).toContain('without a way to confirm');
    expect(evalInPage).toHaveBeenCalledTimes(1);
  });

  it('does not accept a generic alert containing 404 as target-specific deletion evidence', () => {
    window.history.replaceState({}, '', '/');
    document.body.innerHTML = '<aside data-testid="history"></aside><main><div role="alert">404: generic request failed</div></main>';
    expect(JSON.parse(runPageScript(buildConfirmGoneScript(CONVERSATION_ID))).ok).toBe(false);
  });

  it('snapshot reports target presence only from the exact selected history sidebar', () => {
    window.history.replaceState({}, '', '/');
    document.body.innerHTML = '<aside data-testid="history"><a href="' + OTHER_ID_PATH + '">Other</a></aside>';
    const absent = JSON.parse(runPageScript(buildSnapshotScript(CONVERSATION_ID))) as { ok: boolean; targetPresent?: boolean };
    expect(absent.ok).toBe(false);
    expect(absent.targetPresent).toBeUndefined();

    document.body.innerHTML = '<aside data-testid="history"><a href="' + CONVERSATION_PATH + '">Mine</a><a href="' + OTHER_ID_PATH + '">Other</a></aside>';
    const present = JSON.parse(runPageScript(buildSnapshotScript(CONVERSATION_ID))) as { ok: boolean; targetPresent?: boolean; others?: string[] };
    expect(present).toMatchObject({ ok: true, targetPresent: true, others: [OTHER_ID_PATH] });
  });

  it('decodes the JSON-string result envelope returned by real WebView2 callbacks', async () => {
    const responses = [
      { ok: true, targetPresent: true, others: [OTHER_ID_PATH] },
      { ok: true }, { ok: true }, { ok: true },
      { ok: true }, { ok: true },
      { ok: true, targetPresent: true, others: [OTHER_ID_PATH] },
      { ok: true }, { ok: true }, { ok: true },
      { ok: true }, { ok: true }, { ok: true },
    ];
    const evalInPage = vi.fn(async (_script: string) => JSON.stringify(JSON.stringify(responses.shift() ?? { ok: false })));
    const cleaner = createChatGptCleaner({ evalInPage, navigate: vi.fn(async () => undefined), sleep: vi.fn(async () => undefined) });
    expect((await cleaner.deleteConversation(CONVERSATION_URL)).ok).toBe(true);
    expect(await cleaner.confirmGone(CONVERSATION_URL)).toBe(true);
    expect((await cleaner.archiveConversation(CONVERSATION_URL)).ok).toBe(true);
    expect(await cleaner.confirmArchived(CONVERSATION_URL)).toBe(true);
    expect(responses).toHaveLength(0);
  });

  it('navigates to the normalized URL and runs guarded deletion stages', async () => {
    const responses = [
      JSON.stringify({ ok: true, note: 'Snapshot taken', targetPresent: true, others: [OTHER_ID_PATH] }),
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
    expect(evalInPage).toHaveBeenCalledTimes(4);
    // every acting script (not the read-only snapshot) carries the pathname guard
    expect(evalInPage.mock.calls.slice(1).every(([script]) => script.includes('window.location.pathname !== expectedPath'))).toBe(true);
  });

  it('does not act at all when the sidebar snapshot cannot be taken', async () => {
    const evalInPage = vi.fn(async (_script: string) => JSON.stringify({ ok: false, note: 'History list is still loading' }));
    const cleaner = createChatGptCleaner({ evalInPage, navigate: vi.fn(async () => undefined), sleep: vi.fn(async () => undefined) });
    const result = await cleaner.deleteConversation(CONVERSATION_URL);
    expect(result.ok).toBe(false);
    expect(evalInPage).toHaveBeenCalledTimes(1);
  });

  it('never confirms archive readback without a snapshot from before the action', () => {
    document.body.innerHTML = '<aside data-testid="history"><a href="' + OTHER_ID_PATH + '">x</a></aside>';
    expect(JSON.parse(runPageScript(buildConfirmArchivedScript(CONVERSATION_ID))).ok).toBe(false);
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
