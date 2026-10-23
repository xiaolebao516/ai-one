// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProviderCleaner,
  buildProviderCleanerScript,
  type ProviderCleanerConfig,
  type ProviderCleanupSelectors,
} from '../workflow/chatLed/drivers/providerCleaner';
import { CLAUDE_CLEANER_CONFIG, createClaudeCleaner, normalizeClaudeConversationUrl } from '../workflow/chatLed/drivers/claude';
import { GEMINI_CLEANER_CONFIG, createGeminiCleaner, normalizeGeminiConversationUrl } from '../workflow/chatLed/drivers/gemini';
import { GROK_CLEANER_CONFIG, createGrokCleaner, normalizeGrokConversationUrl } from '../workflow/chatLed/drivers/grok';

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
    peer: '/app/xyz123456789',
    normalize: normalizeGeminiConversationUrl,
    factory: createGeminiCleaner,
  },
  {
    name: 'Grok',
    config: GROK_CLEANER_CONFIG,
    path: '/chat/' + UUID,
    peer: '/chat/' + PEER_UUID,
    normalize: normalizeGrokConversationUrl,
    factory: createGrokCleaner,
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
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe.each(cases)('$name cleaner URL and unverified capability', (site) => {
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

  it('stays manual-only and never navigates or clicks before real DOM read-only calibration', async () => {
    const evalInPage = vi.fn(async (_script: string) => JSON.stringify({ ok: true }));
    const navigate = vi.fn(async () => undefined);
    const cleaner = site.factory({ evalInPage, navigate, sleep: vi.fn(async () => undefined) });
    expect(cleaner.provider).toBe(site.config.provider);
    expect(cleaner.supports).toEqual({ delete: false, archive: false });
    expect((await cleaner.deleteConversation(site.config.origin + site.path)).ok).toBe(false);
    expect((await cleaner.archiveConversation(site.config.origin + site.path)).ok).toBe(false);
    expect(await cleaner.confirmGone(site.config.origin + site.path)).toBe(false);
    expect(await cleaner.confirmArchived(site.config.origin + site.path)).toBe(false);
    expect(evalInPage).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
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
