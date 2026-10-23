import type { AIProvider } from '../../../../shared/types';
import type { CleanerStep, ConversationCleaner } from '../cleanup';

export interface ProviderCleanerDependencies {
  evalInPage(script: string): Promise<string>;
  navigate(url: string): Promise<void>;
  reload?(): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface ProviderCleanupSelectors {
  historyRoot: string;
  historyLink: string;
  loading: string;
  row: string;
  rowTitle: string;
  menuTrigger: string;
  menu: string;
  deleteAction: string;
  archiveAction: string;
  dialog: string;
  dialogTitle: string;
  confirmDelete: string;
  confirmArchive: string;
  notFoundHeading: string;
  notFoundText: string;
}

export interface ProviderCleanerConfig {
  provider: Extract<AIProvider, 'claude' | 'gemini' | 'grok'>;
  origin: string;
  conversationPath: RegExp;
  selectors: ProviderCleanupSelectors;
  /** Enable only after a read-only inspection has confirmed the exact target-bound DOM flow. */
  verified: { delete: boolean; archive: boolean };
}

export interface ProviderConversationUrl {
  href: string;
  path: string;
}

export function normalizeProviderConversationUrl(
  config: ProviderCleanerConfig,
  url: string,
): ProviderConversationUrl | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== config.origin || parsed.username || parsed.password || (parsed.port && !new URL(config.origin).port)) return undefined;
    if (!config.conversationPath.test(parsed.pathname)) return undefined;
    parsed.search = '';
    parsed.hash = '';
    return { href: parsed.href, path: parsed.pathname };
  } catch {
    return undefined;
  }
}

type PageAction = 'snapshot' | 'menu' | 'delete' | 'archive' | 'confirm-delete' | 'confirm-archive' | 'check-delete' | 'check-archive';

export function buildProviderCleanerScript(
  config: ProviderCleanerConfig,
  path: string,
  action: PageAction,
  peers: readonly string[] = [],
): string {
  return [
    '(() => {',
    '  const origin = ' + JSON.stringify(config.origin) + ';',
    '  const path = ' + JSON.stringify(path) + ';',
    '  const action = ' + JSON.stringify(action) + ';',
    '  const peers = ' + JSON.stringify(peers) + ';',
    '  const S = ' + JSON.stringify(config.selectors) + ';',
    '  const pathPattern = new RegExp(' + JSON.stringify(config.conversationPath.source) + ', ' + JSON.stringify(config.conversationPath.flags) + ');',
    '  const fail = (note) => JSON.stringify({ ok: false, note });',
    '  if (location.origin !== origin || location.pathname !== path || !pathPattern.test(path)) return fail("Conversation origin or path mismatch");',
    '  const one = (root, css) => { if (!root || !css) return null; const matches = root.querySelectorAll(css); return matches.length === 1 ? matches[0] : null; };',
    '  const text = (node) => (node && (node.innerText || node.textContent || node.getAttribute("aria-label") || "" ) || "").replace(/\\s+/g, " ").trim();',
    '  const hrefPath = (node) => {',
    '    try { const url = new URL(node.getAttribute("href") || "", location.origin); return url.origin === origin && pathPattern.test(url.pathname) ? url.pathname : null; } catch { return null; }',
    '  };',
    '  const history = () => {',
    '    const root = one(document, S.historyRoot);',
    '    if (!root || !S.historyLink || !S.loading || root.matches(S.loading) || root.querySelector(S.loading)) return null;',
    '    const links = Array.from(root.querySelectorAll(S.historyLink));',
    '    const paths = links.map(hrefPath).filter(Boolean);',
    '    return { root, links, paths };',
    '  };',
    '  const target = () => {',
    '    const list = history();',
    '    if (!list) return null;',
    '    const links = list.links.filter((node) => hrefPath(node) === path);',
    '    if (links.length !== 1 || !S.row || !S.rowTitle) return null;',
    '    const row = links[0].closest(S.row);',
    '    if (!row || !list.root.contains(row)) return null;',
    '    const rowLinks = Array.from(row.querySelectorAll(S.historyLink)).map(hrefPath).filter(Boolean);',
    '    if (rowLinks.length !== 1 || rowLinks[0] !== path) return null;',
    '    const title = text(one(row, S.rowTitle));',
    '    if (!title || /^(?:chat|conversation|new chat|new conversation|聊天|对话|新对话)$/i.test(title)) return null;',
    '    return { row, title, list };',
    '  };',
    '  const triggerFor = (item) => one(item.row, S.menuTrigger);',
    '  const ownedMenu = (trigger) => {',
    '    if (!trigger || trigger.getAttribute("aria-expanded") !== "true") return null;',
    '    const menu = one(document, S.menu);',
    '    if (!menu) return null;',
    '    const controls = trigger.getAttribute("aria-controls");',
    '    return ((controls && menu.id === controls) || (trigger.id && menu.getAttribute("aria-labelledby") === trigger.id)) ? menu : null;',
    '  };',
    '  const watchKey = "__aiOneProviderCleanupWatch";',
    '  const clearWatch = () => {',
    '    const current = window[watchKey];',
    '    if (current && current.observer) current.observer.disconnect();',
    '    delete window[watchKey];',
    '  };',
    '  if (action === "snapshot") {',
    '    const item = target();',
    '    if (!item) return fail("Target conversation is not positively present in a loaded, unambiguous history row");',
    '    return JSON.stringify({ ok: true, targetPresent: true, title: item.title, others: Array.from(new Set(item.list.paths.filter((value) => value !== path))) });',
    '  }',
    '  if (action === "menu") {',
    '    const item = target();',
    '    if (!item) return fail("Target row or title could not be identified");',
    '    const trigger = triggerFor(item);',
    '    if (!trigger || trigger.disabled) return fail("Target-specific menu trigger missing");',
    '    const Constructor = window.PointerEvent || window.MouseEvent;',
    '    const event = new Constructor("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" });',
    '    if (!("pointerType" in event)) Object.defineProperty(event, "pointerType", { value: "mouse" });',
    '    trigger.dispatchEvent(event);',
    '    return JSON.stringify({ ok: true, note: "Target menu activation requested" });',
    '  }',
    '  if (action === "delete" || action === "archive") {',
    '    const item = target();',
    '    if (!item) return fail("Target row or title could not be identified");',
    '    const trigger = triggerFor(item);',
    '    const menu = ownedMenu(trigger);',
    '    if (!menu) return fail("Open menu is not bound to the target trigger");',
    '    const button = one(menu, action === "delete" ? S.deleteAction : S.archiveAction);',
    '    if (!button || button.disabled) return fail("Unique target action missing");',
    '    if (!S.dialog || document.querySelectorAll(S.dialog).length !== 0 || window[watchKey]) return fail("A dialog or earlier cleanup is already active");',
    '    const watch = { origin, path, action, title: item.title, at: Date.now(), dialog: null, invalid: false, observer: null };',
    '    watch.observer = new MutationObserver(() => {',
    '      const dialogs = Array.from(document.querySelectorAll(S.dialog));',
    '      if (dialogs.length > 1) watch.invalid = true;',
    '      if (dialogs.length === 1) { if (watch.dialog && watch.dialog !== dialogs[0]) watch.invalid = true; else watch.dialog = dialogs[0]; }',
    '    });',
    '    watch.observer.observe(document.documentElement, { childList: true, subtree: true });',
    '    window[watchKey] = watch;',
    '    button.click();',
    '    return JSON.stringify({ ok: true, note: "Target action selected" });',
    '  }',
    '  if (action === "confirm-delete" || action === "confirm-archive") {',
    '    const kind = action === "confirm-delete" ? "delete" : "archive";',
    '    const watch = window[watchKey];',
    '    const reject = (note) => { clearWatch(); return fail(note); };',
    '    if (!watch || watch.origin !== origin || watch.path !== path || watch.action !== kind || !watch.title || Date.now() - watch.at > 15000 || watch.invalid) return reject("No fresh target-bound confirmation");',
    '    if (S.menu && document.querySelectorAll(S.menu).length !== 0) return reject("Options menu still open");',
    '    const dialogs = Array.from(document.querySelectorAll(S.dialog));',
    '    if (dialogs.length !== 1 || watch.dialog !== dialogs[0] || watch.invalid) return reject("Expected exactly one newly observed dialog");',
    '    if (text(one(dialogs[0], S.dialogTitle)).toLowerCase() !== watch.title.toLowerCase()) return reject("Dialog title is not an exact match for the target conversation");',
    '    const button = one(dialogs[0], kind === "delete" ? S.confirmDelete : S.confirmArchive);',
    '    if (!button || button.disabled) return reject("Unique target confirmation button missing");',
    '    clearWatch();',
    '    button.click();',
    '    return JSON.stringify({ ok: true, note: "Target-bound confirmation clicked" });',
    '  }',
    '  if (action === "check-delete" || action === "check-archive") {',
    '    const list = history();',
    '    if (!list) return fail("History list missing or still loading");',
    '    if (list.paths.includes(path)) return fail("Target still listed");',
    '    const peersPresent = peers.length > 0 && peers.every((peer) => pathPattern.test(peer) && list.paths.includes(peer));',
    '    const heading = one(document, S.notFoundHeading);',
    '    const targetNotFound = action === "check-delete" && !!S.notFoundText && text(heading).toLowerCase() === S.notFoundText.toLowerCase();',
    '    const ok = peersPresent || targetNotFound;',
    '    return JSON.stringify({ ok, note: ok ? "Target absent with positive evidence" : "Absence lacks target-specific or preserved-peer evidence" });',
    '  }',
    '  return fail("Unsupported action");',
    '})()',
  ].join('\n');
}

function parsePageResult(raw: string): unknown {
  const value: unknown = JSON.parse(raw);
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function parseStep(raw: string): CleanerStep {
  try {
    const value = parsePageResult(raw);
    if (!value || typeof value !== 'object' || !('ok' in value) || typeof value.ok !== 'boolean') {
      return { ok: false, note: 'Invalid page response' };
    }
    return {
      ok: value.ok,
      ...('note' in value && typeof value.note === 'string' ? { note: value.note } : {}),
    };
  } catch {
    return { ok: false, note: 'Invalid page JSON' };
  }
}

function parseSnapshot(raw: string, path: string, pattern: RegExp): string[] | undefined {
  try {
    const value = parsePageResult(raw);
    if (!value || typeof value !== 'object') return undefined;
    const result = value as { ok?: unknown; targetPresent?: unknown; title?: unknown; others?: unknown };
    if (result.ok !== true || result.targetPresent !== true || typeof result.title !== 'string' || !result.title.trim() || !Array.isArray(result.others)) return undefined;
    if (!result.others.every((peer) => typeof peer === 'string' && pattern.test(peer) && peer !== path)) return undefined;
    return result.others as string[];
  } catch {
    return undefined;
  }
}

export function createProviderCleaner(
  config: ProviderCleanerConfig,
  dependencies: ProviderCleanerDependencies,
): ConversationCleaner {
  const requiredSelectors = [
    config.selectors.historyRoot, config.selectors.historyLink, config.selectors.loading,
    config.selectors.row, config.selectors.rowTitle, config.selectors.menuTrigger,
    config.selectors.menu, config.selectors.dialog, config.selectors.dialogTitle,
  ];
  const complete = requiredSelectors.every(Boolean);
  const supports = {
    delete: config.verified.delete && complete && Boolean(config.selectors.deleteAction && config.selectors.confirmDelete),
    archive: config.verified.archive && complete && Boolean(config.selectors.archiveAction && config.selectors.confirmArchive),
  };
  const snapshots = new Map<string, string[]>();
  const evaluate = async (path: string, action: PageAction, peers: readonly string[] = []): Promise<CleanerStep> =>
    parseStep(await dependencies.evalInPage(buildProviderCleanerScript(config, path, action, peers)));
  const reload = async (): Promise<void> => {
    if (!dependencies.reload) throw new Error('Native reload is unavailable');
    await dependencies.reload();
  };
  const snapshot = async (path: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const value = parseSnapshot(await dependencies.evalInPage(buildProviderCleanerScript(config, path, 'snapshot')), path, config.conversationPath);
        if (value) {
          snapshots.set(path, value);
          return true;
        }
      } catch { /* A newly navigated page can briefly refuse evaluation. */ }
      if (attempt === 0) { try { await reload(); } catch { return false; } }
      if (attempt < 9) await dependencies.sleep(1_000);
    }
    return false;
  };
  const act = async (url: string, kind: 'delete' | 'archive'): Promise<CleanerStep> => {
    const allowed = kind === 'delete' ? supports.delete : supports.archive;
    if (!allowed) return { ok: false, note: 'Real-site selectors and action capability have not been verified; manual cleanup required' };
    const target = normalizeProviderConversationUrl(config, url);
    if (!target) return { ok: false, note: 'Unsupported conversation URL' };
    snapshots.delete(target.path);
    await dependencies.navigate(target.href);
    await dependencies.sleep(300);
    if (!(await snapshot(target.path))) return { ok: false, note: 'Target history row not positively loaded' };
    const open = await evaluate(target.path, 'menu');
    if (!open.ok) return open;
    await dependencies.sleep(150);
    const selection = await evaluate(target.path, kind);
    if (!selection.ok) return selection;
    await dependencies.sleep(150);
    return evaluate(target.path, kind === 'delete' ? 'confirm-delete' : 'confirm-archive');
  };
  const confirm = async (url: string, kind: 'delete' | 'archive'): Promise<boolean> => {
    const target = normalizeProviderConversationUrl(config, url);
    if (!target || !(kind === 'delete' ? supports.delete : supports.archive)) return false;
    const peers = snapshots.get(target.path);
    if (!peers) return false;
    await dependencies.navigate(target.href);
    await dependencies.sleep(400);
    if (kind === 'archive') {
      try { await reload(); } catch { return false; }
      await dependencies.sleep(500);
    }
    let consecutive = 0;
    let refreshed = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        consecutive = (await evaluate(target.path, kind === 'delete' ? 'check-delete' : 'check-archive', peers)).ok ? consecutive + 1 : 0;
      } catch { consecutive = 0; }
      if (consecutive === 2) return true;
      if (!consecutive && !refreshed) {
        refreshed = true;
        try { await reload(); } catch { return false; }
      }
      if (attempt < 9) await dependencies.sleep(consecutive ? 1_500 : 1_000);
    }
    return false;
  };
  return {
    provider: config.provider,
    supports,
    matchesConversationUrl: (url) => normalizeProviderConversationUrl(config, url) !== undefined,
    deleteConversation: (url) => act(url, 'delete'),
    archiveConversation: (url) => act(url, 'archive'),
    confirmGone: (url) => confirm(url, 'delete'),
    confirmArchived: (url) => confirm(url, 'archive'),
  };
}