// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatLedRun } from '../workflow/chatLed/types';
import { executeCleanup, planCleanup } from '../workflow/chatLed/cleanup';
import {
  createProviderCleaner,
  buildProviderCleanerScript,
  type ProviderCleanerConfig,
  type ProviderCleanupSelectors,
} from '../workflow/chatLed/drivers/providerCleaner';
import { CLAUDE_CLEANER_CONFIG, createClaudeCleaner, normalizeClaudeConversationUrl } from '../workflow/chatLed/drivers/claude';
import { GEMINI_CLEANER_CONFIG, createGeminiCleaner, normalizeGeminiConversationUrl } from '../workflow/chatLed/drivers/gemini';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PEER_UUID = '123e4567-e89b-42d3-a456-426614174999';
const cases = [
  {
    name: 'Claude',
    config: CLAUDE_CLEANER_CONFIG,
    path: '/chat/' + UUID,
    peer: '/chat/' + PEER_UUID,
    normalize: normalizeClaudeConversationUrl,
    factory: createClaudeCleaner,
  },
  {
    name: 'Gemini',
    config: GEMINI_CLEANER_CONFIG,
    path: '/app/abcdef123456',
    peer: '/app/deadbeef1234',
    normalize: normalizeGeminiConversationUrl,
    factory: createGeminiCleaner,
  },
] as const;

const selectors: ProviderCleanupSelectors = {
  historyRoot: 'aside[data-history]',
  historyLink: 'a[href]',
  loading: '[aria-busy="true"]',
  row: '.history-row',
  rowTitle: '.title',
  menuTrigger: '.menu-trigger',
  menu: '[role="menu"]',
  deleteAction: '[data-action="delete"]',
  archiveAction: '[data-action="archive"]',
  dialog: '[role="dialog"]',
  dialogTitle: '[data-target-title]',
  confirmDelete: '[data-confirm="delete"]',
  confirmArchive: '[data-confirm="archive"]',
  listReady: '[data-list-ready="true"]',
  notFoundHeading: 'main h1',
  notFoundText: 'Conversation not found',
};

function fixture(site: (typeof cases)[number]): ProviderCleanerConfig {
  return {
    ...site.config,
    origin: window.location.origin,
    selectors,
    verified: { delete: true, archive: true },
  };
}

function run(script: string): { ok: boolean; note?: string; targetPresent?: boolean; others?: string[] } {
  const execute = new Function('window', 'document', 'location', 'MutationObserver', 'return ' + script) as (
    win: Window, doc: Document, location: Location, observer: typeof MutationObserver,
  ) => string;
  return JSON.parse(execute(window, document, window.location, MutationObserver)) as {
    ok: boolean; note?: string; targetPresent?: boolean; others?: string[];
  };
}

function setup(site: (typeof cases)[number], options: { loading?: boolean; extraTarget?: boolean; other?: boolean } = {}) {
  window.history.replaceState({}, '', site.path);
  document.body.innerHTML = [
    '<aside data-history>',
    '<span data-list-ready="true"></span>',
    '<div class="history-row"><a href="' + site.path + '"><span class="title">Mine</span></a>',
    '<button class="menu-trigger" id="my-trigger" aria-expanded="true" aria-controls="my-menu">Options</button></div>',
    options.extraTarget ? '<div class="history-row"><a href="' + site.path + '"><span class="title">Duplicate</span></a></div>' : '',
    options.other === false ? '' : '<div class="history-row"><a href="' + site.peer + '"><span class="title">Other</span></a><button class="menu-trigger" id="other-trigger">Other options</button></div>',
    options.loading ? '<div aria-busy="true">Loading</div>' : '',
    '</aside>',
  ].join('');
}

function arm(site: (typeof cases)[number], action: 'delete' | 'archive', title = 'Mine') {
  const dialog = document.querySelector('[role="dialog"]');
  const globals = window as unknown as Record<string, unknown>;
  globals.__aiOneProviderCleanupWatch = {
    origin: window.location.origin,
    path: site.path,
    action,
    title,
    at: Date.now(),
    dialog,
    invalid: false,
    observer: { disconnect: vi.fn() },
  };
}

beforeEach(() => {
  const globals = window as unknown as Record<string, unknown>;
  const previous = globals.__aiOneProviderCleanupWatch as { observer?: { disconnect(): void } } | undefined;
  previous?.observer?.disconnect();
  delete globals.__aiOneProviderCleanupWatch;
  const previousMenu = globals.__aiOneProviderMenuWatch as { observer?: { disconnect(): void } } | undefined;
  previousMenu?.observer?.disconnect();
  delete globals.__aiOneProviderMenuWatch;
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe.each(cases)('$name cleaner URL and observed capabilities', (site) => {
  it('matches only the explicit provider conversation path and origin', () => {
    const url = site.config.origin + site.path;
    expect(site.normalize(url)?.path).toBe(site.path);
    expect(site.normalize(url + '?from=list#top')?.href).toBe(url);
    expect(site.normalize('https://example.test' + site.path)).toBeUndefined();
    expect(site.normalize(url + '/extra')).toBeUndefined();
    expect(site.normalize(url + '/')).toBeUndefined();
    expect(site.normalize(site.config.origin + '/')).toBeUndefined();
    expect(site.normalize(url.replace('https://', 'http://'))).toBeUndefined();
    expect(site.normalize(url.replace('https://', 'https://user:pass@'))).toBeUndefined();
    expect(site.normalize(site.config.origin + '/app')).toBeUndefined();
  });

  it('exposes no verified real-site capability and plans manual without page I/O', async () => {
    const evalInPage = vi.fn(async (_script: string) => JSON.stringify({ ok: true }));
    const navigate = vi.fn(async (_url: string) => undefined);
    const reload = vi.fn(async () => undefined);
    const cleaner = site.factory({
      evalInPage, navigate, reload, sleep: vi.fn(async (_ms: number) => undefined),
    });
    const url = site.config.origin + site.path;
    expect(cleaner.provider).toBe(site.config.provider);
    expect(cleaner.supports).toEqual({ delete: false, archive: false });
    expect(site.config.verified).toEqual({ delete: false, archive: false });
    expect(site.config.selectors.dialog).toBe('');
    expect(site.config.selectors.confirmDelete).toBe('');
    expect((await cleaner.deleteConversation(url)).ok).toBe(false);
    expect((await cleaner.archiveConversation(url)).ok).toBe(false);
    expect((await cleaner.deleteConversation(site.config.origin + '/new')).ok).toBe(false);
    expect(await cleaner.confirmGone(url)).toBe(false);
    expect(await cleaner.confirmArchived(url)).toBe(false);

    const recordedRun: ChatLedRun = {
      id: 'manual-provider-cleanup', goal: 'Manual cleanup', coordinator: 'chatgpt',
      available: ['claude', 'gemini'], roundLimit: 2, round: 1, phase: 'finished',
      forwards: [], conversations: [{
        provider: site.config.provider, url, title: 'Mine', createdByAiOne: true,
        registrationStatus: 'confirmed', registeredAt: 100,
      }], sessionInitializations: [], coordinatorReplies: [], createdAt: 100, updatedAt: 200,
    };
    const plan = planCleanup(recordedRun, [cleaner]);
    expect(plan).toMatchObject([{ action: 'manual', irreversible: false }]);
    expect((await executeCleanup(plan, [cleaner]))[0].outcome).toBe('manual');
    expect(evalInPage).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    realPage(site);
    const pageConfig = { ...site.config, origin: window.location.origin };
    for (const action of ['delete', 'archive', 'confirm-delete', 'confirm-archive'] as const) {
      expect(run(buildProviderCleanerScript(pageConfig, site.path, action)).ok).toBe(false);
    }
  });
});

describe.each(cases)('$name cleaner guarded page scripts (synthetic selectors only)', (site) => {
  it('never acts when the document is a different conversation or origin', () => {
    setup(site);
    document.body.insertAdjacentHTML('beforeend', '<div role="menu" id="my-menu"><button data-action="delete">Delete</button></div>');
    const click = vi.fn();
    document.querySelector('[data-action="delete"]')?.addEventListener('click', click);
    window.history.replaceState({}, '', '/wrong');
    const result = run(buildProviderCleanerScript(fixture(site), site.path, 'delete'));
    expect(result.ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('requires a single target row and a fully loaded history list; never uses another row', () => {
    setup(site, { loading: true });
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'snapshot')).ok).toBe(false);
    setup(site, { extraTarget: true });
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'snapshot')).ok).toBe(false);
    setup(site);
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'snapshot'))).toMatchObject({
      ok: true, targetPresent: true, others: [site.peer],
    });
    document.querySelector('.history-row')?.remove();
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'menu')).ok).toBe(false);
  });

  it('refuses a menu without an exact aria-controls or aria-labelledby ownership link', () => {
    setup(site);
    document.body.insertAdjacentHTML('beforeend', '<div role="menu" id="unrelated"><button data-action="delete">Delete</button></div>');
    const click = vi.fn();
    document.querySelector('[data-action="delete"]')?.addEventListener('click', click);
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'delete')).ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('refuses an unrelated or multiple confirmation dialog, even with a matching action button', () => {
    setup(site);
    document.body.insertAdjacentHTML('beforeend',
      '<div role="dialog">Delete <span data-target-title>Someone Else</span>?<button data-confirm="delete">Delete</button></div>');
    arm(site, 'delete');
    const click = vi.fn();
    document.querySelector('[data-confirm="delete"]')?.addEventListener('click', click);
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'confirm-delete')).ok).toBe(false);
    expect(click).not.toHaveBeenCalled();

    document.body.innerHTML = '<div role="dialog">Delete <span data-target-title>Mine</span>?<button data-confirm="delete">Delete</button></div><div role="dialog">Delete <span data-target-title>Mine</span>?<button data-confirm="delete">Delete</button></div>';
    arm(site, 'delete');
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'confirm-delete')).ok).toBe(false);
  });

  it('refuses an old, foreign, wrong-action or unobserved dialog', () => {
    setup(site);
    document.body.insertAdjacentHTML('beforeend',
      '<div role="dialog">Delete <span data-target-title>Mine</span>?<button data-confirm="delete">Delete</button></div>');
    const globals = window as unknown as Record<string, unknown>;
    arm(site, 'delete');
    const current = globals.__aiOneProviderCleanupWatch as { at: number; path: string; action: string; dialog: Element | null };
    current.at = Date.now() - 20_000;
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'confirm-delete')).ok).toBe(false);
    arm(site, 'archive');
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'confirm-delete')).ok).toBe(false);
    arm(site, 'delete');
    (globals.__aiOneProviderCleanupWatch as { dialog: Element | null }).dialog = null;
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'confirm-delete')).ok).toBe(false);
  });

  it('clicks only one target-bound confirmation in the synthetic fixture', () => {
    setup(site);
    document.body.insertAdjacentHTML('beforeend',
      '<div role="dialog">Delete <span data-target-title>Mine</span>?<button data-confirm="archive">Archive</button><button data-confirm="delete">Delete</button></div>');
    arm(site, 'delete');
    const click = vi.fn();
    document.querySelector('[data-confirm="delete"]')?.addEventListener('click', click);
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'confirm-delete')).ok).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('rejects ambiguous absence, generic 404, missing peers and still-listed target', () => {
    setup(site);
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'check-delete', [site.peer])).ok).toBe(false);
    document.querySelector('.history-row')?.remove();
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'check-archive', [site.peer])).ok).toBe(true);
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'check-archive', ['/missing'])).ok).toBe(false);
    document.querySelector('.history-row')?.remove();
    document.body.insertAdjacentHTML('beforeend', '<main><h1>404</h1></main>');
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'check-delete'))).toMatchObject({ ok: false });
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'check-delete', [site.peer])).ok).toBe(false);
    document.body.innerHTML = '<main><h1>Conversation not found</h1></main>';
    expect(run(buildProviderCleanerScript(fixture(site), site.path, 'check-delete')).ok).toBe(false);
  });

  it('requires two consecutive independent positive readbacks after the pre-action snapshot', async () => {
    const config = fixture(site);
    const checks = [true, false, true, true];
    const evalInPage = vi.fn(async (script: string) => {
      if (script.includes('const action = "snapshot"')) {
        return JSON.stringify(JSON.stringify({ ok: true, targetPresent: true, title: 'Mine', others: [site.peer] }));
      }
      if (script.includes('const action = "check-delete"')) return JSON.stringify({ ok: checks.shift() ?? false });
      return JSON.stringify({ ok: true });
    });
    const cleaner = createProviderCleaner(config, {
      evalInPage,
      navigate: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      sleep: vi.fn(async () => undefined),
    });
    expect((await cleaner.deleteConversation(window.location.origin + site.path)).ok).toBe(true);
    expect(await cleaner.confirmGone(window.location.origin + site.path)).toBe(true);
    expect(checks).toHaveLength(0);
    expect(evalInPage.mock.calls.filter(([script]) => script.includes('const action = "check-delete"'))).toHaveLength(4);
  });

  it('does not act when the initial target snapshot never succeeds', async () => {
    const config = fixture(site);
    const evalInPage = vi.fn(async (_script: string) => JSON.stringify({ ok: false }));
    const navigate = vi.fn(async () => undefined);
    const cleaner = createProviderCleaner(config, {
      evalInPage, navigate, reload: vi.fn(async () => undefined), sleep: vi.fn(async () => undefined),
    });
    expect((await cleaner.deleteConversation(window.location.origin + site.path)).ok).toBe(false);
    expect(evalInPage.mock.calls.every(([script]) => script.includes('const action = "snapshot"'))).toBe(true);
  });
});

/** Read-only observed row structure; Gemini ownership and all dialog/readback markers are synthetic guards. */
function realPage(site: (typeof cases)[number], extraTarget = false) {
  window.history.replaceState({}, '', site.path);
  const claude = site.name === 'Claude';
  const row = (path: string, title: string) => {
    const kind = path === site.path ? 'target' : 'peer';
    const base = claude ? 'claude' : 'gemini';
    const trigger = base + '-trigger-' + kind;
    const menu = base + '-menu-' + kind;
    return claude
      ? `<div data-row><a data-row-main-button href="${path}"><span>${title}</span></a><button data-row-action aria-haspopup="menu" id="${trigger}" aria-controls="${menu}" aria-label="${title} 的更多选项"></button></div>`
      : `<gem-nav-list-item data-test-id="conversation"><a href="${path}" aria-label="${title}"></a><gem-icon-button data-test-id="actions-menu-button" aria-haspopup="menu"><button id="${trigger}" aria-controls="${menu}" aria-label="“${title}”的更多选项"></button></gem-icon-button></gem-nav-list-item>`;
  };
  // Claude's ARIA ownership was observed; Gemini's link is synthetic and needs live calibration.
  const root = claude ? 'aside' : 'bard-sidenav';
  document.body.innerHTML = '<' + root + '>' + row(site.path, 'Mine') + row(site.peer, 'Other')
    + (extraTarget ? row(site.path, 'Duplicate') : '') + '</' + root + '>';
}

function realConfig(site: (typeof cases)[number]): ProviderCleanerConfig {
  // Deliberate test-only capabilities and dedicated fake confirmation selectors.
  return {
    ...site.config,
    origin: window.location.origin,
    verified: { delete: true, archive: true },
    selectors: {
      ...site.config.selectors,
      dialog: '[data-test-cleanup-dialog]',
      dialogTitle: '[data-test-target-title]',
      confirmDelete: '[data-confirm="target"]',
      confirmArchive: '[data-confirm="target"]',
      listReady: '[data-test-list-ready]',
    },
  };
}

function realMenu(site: (typeof cases)[number], foreign = false) {
  const base = site.name === 'Claude' ? 'claude' : 'gemini';
  const kind = foreign ? 'peer' : 'target';
  const ownership = `id="${base}-menu-${kind}" aria-labelledby="${base}-trigger-${kind}"`;
  return site.name === 'Claude'
    ? `<div role="menu" ${ownership}><button role="menuitem" data-testid="rename-chat-trigger">重命名R</button><button role="menuitem" data-testid="archive-chat-trigger">归档A</button><button role="menuitem" data-testid="delete-chat-trigger">删除D</button></div>`
    : `<div class="mat-mdc-menu-panel" role="menu" ${ownership}><button role="menuitem" data-test-id="share-button">分享</button><button role="menuitem" data-test-id="delete-button">删除</button></div>`;
}

describe.each(cases)('$name observed rows with synthetic safety guards', (site) => {
  it('scopes the target row, rejects duplicates/loading and only opens its own menu with a complete pointer sequence', async () => {
    realPage(site, true);
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'snapshot')).ok).toBe(false);
    realPage(site);
    document.querySelector('aside, bard-sidenav')?.insertAdjacentHTML('beforeend', '<div aria-busy="true">Loading</div>');
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'snapshot')).ok).toBe(false);
    document.querySelector('[aria-busy="true"]')?.remove();
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'snapshot'))).toMatchObject({
      ok: true, targetPresent: true, others: [site.peer],
    });

    const target = document.querySelector(site.config.selectors.menuTrigger);
    const events: string[] = [];
    for (const event of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target?.addEventListener(event, () => {
        events.push(event);
        if (event === 'pointerdown') document.body.insertAdjacentHTML('beforeend', realMenu(site));
      });
    }
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'menu')).ok).toBe(true);
    await Promise.resolve();
    expect(events).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    const other = document.querySelectorAll(site.config.selectors.menuTrigger)[1];
    expect(other).not.toBe(target);
    const otherClick = vi.fn();
    other?.addEventListener('click', otherClick);
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'menu')).ok).toBe(false);
    expect(otherClick).not.toHaveBeenCalled();
  });

  it('uses the action testid, then confirms only a newly appearing dialog matching title and action', async () => {
    realPage(site);
    const target = document.querySelector(site.config.selectors.menuTrigger);
    target?.addEventListener('pointerdown', () => document.body.insertAdjacentHTML('beforeend', realMenu(site)));
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'menu')).ok).toBe(true);
    await Promise.resolve();
    const button = document.querySelector(site.config.selectors.deleteAction);
    const actionClick = vi.fn();
    button?.addEventListener('click', () => {
      actionClick();
      document.querySelector(site.config.selectors.menu)?.remove();
      document.body.insertAdjacentHTML('beforeend', site.name === 'Claude'
        ? '<div role="dialog" data-test-cleanup-dialog aria-modal="true"><h2 data-test-target-title>Mine</h2><p>删除对话？</p><button>取消</button><button data-confirm="target">删除</button></div>'
        : '<mat-dialog-container role="dialog" data-test-cleanup-dialog><h2 data-test-target-title>Mine</h2><p>删除对话？</p><button>取消</button><button data-confirm="target">删除</button></mat-dialog-container>');
    });
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'delete')).ok).toBe(true);
    expect(actionClick).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    const confirmClick = vi.fn();
    document.querySelector('[data-confirm="target"]')?.addEventListener('click', confirmClick);
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'confirm-delete')).ok).toBe(true);
    expect(confirmClick).toHaveBeenCalledTimes(1);
  });

  it('refuses a foreign, ambiguous or unobserved confirmation (without any confirmation click)', async () => {
    realPage(site);
    const target = document.querySelector(site.config.selectors.menuTrigger);
    target?.addEventListener('pointerdown', () => document.body.insertAdjacentHTML('beforeend', realMenu(site)));
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'menu')).ok).toBe(true);
    await Promise.resolve();
    document.querySelector(site.config.selectors.deleteAction)?.addEventListener('click', () => {
      document.querySelector(site.config.selectors.menu)?.remove();
      document.body.insertAdjacentHTML('beforeend',
        '<div role="dialog" data-test-cleanup-dialog><h2 data-test-target-title>Somebody Else</h2><button data-confirm="target">删除</button></div>');
    });
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'delete')).ok).toBe(true);
    await Promise.resolve();
    const click = vi.fn();
    document.querySelector('[data-confirm="target"]')?.addEventListener('click', click);
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'confirm-delete')).ok).toBe(false);
    expect(click).not.toHaveBeenCalled();

    realPage(site);
    document.body.insertAdjacentHTML('beforeend',
      '<div role="dialog" data-test-cleanup-dialog><h2 data-test-target-title>Mine</h2><button data-confirm="target">删除</button></div>');
    arm(site, 'delete');
    const globals = window as unknown as Record<string, unknown>;
    (globals.__aiOneProviderCleanupWatch as { dialog: Element | null }).dialog = null;
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'confirm-delete')).ok).toBe(false);
    realPage(site);
    document.body.insertAdjacentHTML('beforeend',
      '<div role="dialog" data-test-cleanup-dialog><h2 data-test-target-title>Mine</h2><button>删除</button></div><div role="dialog" data-test-cleanup-dialog><h2 data-test-target-title>Mine</h2><button>删除</button></div>');
    arm(site, 'delete');
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'confirm-delete')).ok).toBe(false);
  });

  it('does not treat a partially hydrated peer-only list as deleted or archived', () => {
    realPage(site);
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'check-delete', [site.peer])).ok).toBe(false);
    document.querySelector(site.config.selectors.row)?.remove();
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'check-delete', [site.peer])).ok).toBe(false);
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'check-archive', [site.peer])).ok).toBe(false);
    document.querySelector('aside, bard-sidenav')?.insertAdjacentHTML('afterbegin', '<span data-test-list-ready></span>');
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'check-delete', [site.peer])).ok).toBe(true);
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'check-archive', [site.peer])).ok).toBe(true);
    document.querySelector('aside, bard-sidenav')?.insertAdjacentHTML('afterbegin', '<span data-test-list-ready></span>');
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'check-delete', [site.peer])).ok).toBe(false);
    document.querySelectorAll('[data-test-list-ready]').forEach((node) => node.remove());
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'check-delete', [site.peer])).ok).toBe(false);
  });

  it.each(['foreign', 'absent', 'contradictory'] as const)(
    'never clicks a same-title menu with %s target ownership', async (variant) => {
      realPage(site);
      const peerLink = Array.from(document.querySelectorAll(site.config.selectors.historyLink))
        .find((node) => node.getAttribute('href') === site.peer);
      if (site.name === 'Claude') {
        const title = peerLink?.querySelector('span');
        if (title) title.textContent = 'Mine';
      } else {
        peerLink?.setAttribute('aria-label', 'Mine');
      }
      document.querySelectorAll(site.config.selectors.menuTrigger)[1]?.setAttribute(
        'aria-label', site.name === 'Claude' ? 'Mine 的更多选项' : '“Mine”的更多选项',
      );
      const trigger = document.querySelector(site.config.selectors.menuTrigger);
      trigger?.addEventListener('pointerdown', () => {
        document.body.insertAdjacentHTML('beforeend', realMenu(site, variant === 'foreign'));
        const menu = document.querySelector(site.config.selectors.menu);
        if (variant === 'absent') {
          menu?.removeAttribute('id');
          menu?.removeAttribute('aria-labelledby');
          trigger?.removeAttribute('aria-controls');
        } else if (variant === 'contradictory') {
          menu?.setAttribute('aria-labelledby', site.name === 'Claude' ? 'claude-trigger-peer' : 'gemini-trigger-peer');
        }
      });
      expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'menu')).ok).toBe(true);
      await Promise.resolve();
      const click = vi.fn();
      document.querySelector(site.config.selectors.deleteAction)?.addEventListener('click', click);
      expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'delete')).ok).toBe(false);
      expect(click).not.toHaveBeenCalled();
    },
  );

  it('never confirms an unrelated dialog that merely contains the title and Delete button', async () => {
    realPage(site);
    const trigger = document.querySelector(site.config.selectors.menuTrigger);
    trigger?.addEventListener('pointerdown', () => document.body.insertAdjacentHTML('beforeend', realMenu(site)));
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'menu')).ok).toBe(true);
    await Promise.resolve();
    document.querySelector(site.config.selectors.deleteAction)?.addEventListener('click', () => {
      document.querySelector(site.config.selectors.menu)?.remove();
      document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><span>Mine</span><button>Delete</button></div>');
    });
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'delete')).ok).toBe(true);
    await Promise.resolve();
    const click = vi.fn();
    document.querySelector('[role="dialog"] button')?.addEventListener('click', click);
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'confirm-delete')).ok).toBe(false);
    expect(click).not.toHaveBeenCalled();

    const synthetic = realConfig(site);
    const emptySelectors: ProviderCleanerConfig = {
      ...synthetic, selectors: { ...synthetic.selectors, dialog: '', dialogTitle: '', confirmDelete: '' },
    };
    expect(run(buildProviderCleanerScript(emptySelectors, site.path, 'confirm-delete')).ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('does not act on a pre-existing unrelated menu or target row without a menu button', () => {
    realPage(site);
    document.body.insertAdjacentHTML('beforeend', realMenu(site));
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'menu')).ok).toBe(false);
    realPage(site);
    document.querySelector(site.config.selectors.menuTrigger)?.remove();
    expect(run(buildProviderCleanerScript(realConfig(site), site.path, 'menu')).ok).toBe(false);
  });
});
