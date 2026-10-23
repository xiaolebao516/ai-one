// UNVERIFIED: ChatGPT cleanup selectors and flows require real-account verification.
import type { AIProvider } from '../../../../shared/types';
import type { CleanerStep, ConversationCleaner } from '../cleanup';

export interface ChatGptCleanerDependencies {
  evalInPage(js: string): Promise<string>;
  navigate(url: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface NormalizedConversationUrl {
  href: string;
  path: string;
  id: string;
}

const CHATGPT_ORIGINS = new Set([
  'https://chatgpt.com',
  'https://chat.openai.com',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONVERSATION_PATH_PATTERN = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

// Keep provider-specific selectors in one replaceable location. Prefer stable test IDs,
// then accessible names in English or Chinese; real-account DOM changes may require updates.
export const SELECTORS = {
  menuButtons: [
    '[data-testid="conversation-options-menu"]',
    '[data-testid="conversation-menu-trigger"]',
    'button[aria-label="Conversation options"]',
    'button[aria-label="Chat options"]',
    'button[aria-label="More options"]',
    'button[aria-label="对话选项"]',
    'button[aria-label="聊天选项"]',
    'button[aria-label="更多选项"]',
    'button[aria-label="更多"]',
  ],
  actionCandidates: [
    '[data-testid="delete-chat-button"]',
    '[data-testid="delete-conversation"]',
    '[data-testid="archive-chat-button"]',
    '[data-testid="archive-conversation"]',
    '[role="menuitem"]',
    'button',
  ],
  confirmationCandidates: [
    '[data-testid="confirm-delete-button"]',
    '[data-testid="delete-confirmation-button"]',
    '[data-testid="confirm-archive-button"]',
    '[data-testid="confirm"]',
    '[role="dialog"] button',
    '[role="alertdialog"] button',
    '[data-testid*="modal"] button',
    '[data-testid*="dialog"] button',
  ],
  sidebarRoots: [
    '[data-testid="history"]',
    '[data-testid="history-list"]',
    'nav[aria-label*="Chat history"]',
    'nav[aria-label*="Chat History"]',
    'nav[aria-label*="聊天记录"]',
    'aside',
  ],
  sidebarLinks: [
    '[data-testid*="history-item"] a[href]',
    'a[href*="/c/"]',
  ],
  notFoundMessages: [
    '[role="alert"]',
    '[data-testid*="error"]',
    'main h1',
    '[role="heading"][aria-level="1"]',
  ],
} as const;

export function normalizeConversationUrl(url: string): NormalizedConversationUrl | undefined {
  try {
    const parsed = new URL(url);
    if (!CHATGPT_ORIGINS.has(parsed.origin)) return undefined;
    if (parsed.username || parsed.password) return undefined;

    const match = CONVERSATION_PATH_PATTERN.exec(parsed.pathname);
    if (!match || !UUID_PATTERN.test(match[1])) return undefined;

    const id = match[1].toLowerCase();
    parsed.pathname = '/c/' + id;
    return { href: parsed.href, path: parsed.pathname, id };
  } catch {
    return undefined;
  }
}

function guardedScript(path: string, body: string): string {
  return [
    '(() => {',
    '  const expectedPath = ' + JSON.stringify(path) + ';',
    '  if (window.location.pathname !== expectedPath) return JSON.stringify({ ok: false, note: "Conversation path mismatch" });',
    '  const SELECTORS = ' + JSON.stringify(SELECTORS) + ';',
    '  const accessibleName = (element) => {',
    '    const node = element;',
    '    return [node.getAttribute("aria-label"), node.getAttribute("title"), node.innerText, node.textContent].filter((value) => typeof value === "string" && value.length > 0).join(" ").replace(/\\s+/g, " ").trim();',
    '  };',
    '  const SIDEBAR = "nav, aside, [data-testid=\\"history\\"], [data-testid=\\"history-list\\"]";',
    '  const inSidebar = (element) => element.closest(SIDEBAR) !== null;',
    '  const hrefPath = (anchor) => { try { return new URL(anchor.getAttribute("href") || "", window.location.origin).pathname; } catch (error) { return ""; } };',
    '  const targetRow = () => {',
    '    const anchor = Array.from(window.document.querySelectorAll("a[href]")).find((node) => inSidebar(node) && hrefPath(node) === expectedPath);',
    '    let row = anchor ? (anchor.closest("li") || anchor.parentElement) : null;',
    '    while (row && inSidebar(row)) {',
    '      const paths = Array.from(row.querySelectorAll("a[href]")).map(hrefPath).filter((path) => /^\\/c\\//.test(path));',
    '      if (paths.some((path) => path !== expectedPath)) return null;',
    '      if (row.querySelector("button")) return row;',
    '      row = row.parentElement;',
    '    }',
    '    return null;',
    '  };',
    '  // The options trigger of the REGISTERED conversation: its sidebar row, or a header button outside the sidebar.',
    '  const findTrigger = () => {',
    '    const row = targetRow();',
    '    if (row) return findCandidate(["button"], /more|option|menu|chat actions|对话选项|聊天选项|聊天操作|更多|选项/i, /options|menu/i, row);',
    '    const buttons = Array.from(window.document.querySelectorAll("button")).filter((node) => !inSidebar(node));',
    '    return buttons.find((node) => /conversation-options-menu|conversation-menu-trigger/i.test(node.getAttribute("data-testid") || "") || /conversation options|chat options|对话选项|聊天选项/i.test(accessibleName(node))) || null;',
    '  };',
    '  // Fail closed: a menu counts only when the target trigger itself says it controls/labels it.',
    '  const ownedMenu = (trigger) => {',
    '    if (!trigger || trigger.getAttribute("aria-expanded") !== "true") return null;',
    '    const controls = trigger.getAttribute("aria-controls") || "";',
    '    const triggerId = trigger.id || "";',
    '    const owned = Array.from(window.document.querySelectorAll("[role=\\"menu\\"]")).filter((menu) => (controls && menu.id === controls) || (triggerId && menu.getAttribute("aria-labelledby") === triggerId));',
    '    return owned.length === 1 ? owned[0] : null;',
    '  };',
    '  const onlyRoot = (selector) => { const roots = window.document.querySelectorAll(selector); return roots.length === 1 ? roots[0] : null; };',
    '  const findCandidate = (selectors, labelPattern, testIdPattern, root) => {',
    '    const seen = new Set();',
    '    for (const selector of selectors) {',
    '      const elements = (root || window.document).querySelectorAll(selector);',
    '      for (const element of elements) {',
    '        if (seen.has(element)) continue;',
    '        seen.add(element);',
    '        const label = accessibleName(element);',
    '        const testId = element.getAttribute("data-testid") || "";',
    '        if (labelPattern.test(label) || (testIdPattern && testIdPattern.test(testId))) return element;',
    '      }',
    '    }',
    '    return null;',
    '  };',
    body,
    '})()',
  ].join('\n');
}

export function buildOpenMenuScript(path: string): string {
  return guardedScript(path, [
    '  const element = findTrigger();',
    '  if (!element || element.disabled === true) return JSON.stringify({ ok: false, note: "Options menu of the registered conversation not found or disabled" });',
    '  element.click();',
    '  return JSON.stringify({ ok: true, note: "Options menu opened" });',
  ].join('\n'));
}

export function buildDeleteScript(path: string): string {
  return guardedScript(path, [
    '  const menu = ownedMenu(findTrigger());',
    '  if (!menu) return JSON.stringify({ ok: false, note: "No open options menu that belongs to the registered conversation" });',
    '  const element = findCandidate(SELECTORS.actionCandidates, /delete|remove|删除/i, /delete/i, menu);',
    '  if (!element || element.disabled === true) return JSON.stringify({ ok: false, note: "Delete action not found or disabled" });',
    '  // A dialog that already exists cannot be the one this click produces, so it could never be trusted later.',
    '  if (window.document.querySelectorAll("[role=\\"dialog\\"], [role=\\"alertdialog\\"]").length > 0) return JSON.stringify({ ok: false, note: "A dialog is already open; refusing to continue" });',
    '  window.__aiOneArmed = JSON.stringify({ path: expectedPath, action: "delete", at: Date.now() });',
    '  element.click();',
    '  return JSON.stringify({ ok: true, note: "Delete action selected" });',
  ].join('\n'));
}

export function buildArchiveScript(path: string): string {
  return guardedScript(path, [
    '  const menu = ownedMenu(findTrigger());',
    '  if (!menu) return JSON.stringify({ ok: false, note: "No open options menu that belongs to the registered conversation" });',
    '  const element = findCandidate(SELECTORS.actionCandidates, /archive|归档/i, /archive/i, menu);',
    '  if (!element || element.disabled === true) return JSON.stringify({ ok: false, note: "Archive action not found or disabled" });',
    '  // A dialog that already exists cannot be the one this click produces, so it could never be trusted later.',
    '  if (window.document.querySelectorAll("[role=\\"dialog\\"], [role=\\"alertdialog\\"]").length > 0) return JSON.stringify({ ok: false, note: "A dialog is already open; refusing to continue" });',
    '  window.__aiOneArmed = JSON.stringify({ path: expectedPath, action: "archive", at: Date.now() });',
    '  element.click();',
    '  return JSON.stringify({ ok: true, note: "Archive action selected" });',
  ].join('\n'));
}

export function buildConfirmScript(path: string, action: 'delete' | 'archive'): string {
  const labelPattern = action === 'delete'
    ? '/delete|remove|删除/i'
    : '/archive|归档/i';
  const testIdPattern = action === 'delete' ? '/delete/i' : '/archive/i';

  return guardedScript(path, [
    '  const action = ' + JSON.stringify(action) + ';',
    '  // Only a dialog produced by OUR click on this conversation may be confirmed: the click armed a marker.',
    '  let armed = null;',
    '  try { armed = JSON.parse(window.__aiOneArmed || "null"); } catch (error) { armed = null; }',
    '  delete window.__aiOneArmed;',
    '  if (!armed || armed.path !== expectedPath || armed.action !== action || typeof armed.at !== "number" || Date.now() - armed.at > 15000) return JSON.stringify({ ok: false, note: "No fresh confirmation armed by this cleanup; refusing to confirm" });',
    '  // The target menu was consumed by our click: no menu may be open, and the target trigger is collapsed.',
    '  if (window.document.querySelectorAll("[role=\\"menu\\"]").length > 0) return JSON.stringify({ ok: false, note: "A menu is still open; refusing to confirm" });',
    '  const trigger = findTrigger();',
    '  if (trigger && trigger.getAttribute("aria-expanded") === "true") return JSON.stringify({ ok: false, note: "Options trigger still expanded; refusing to confirm" });',
    '  const dialogs = window.document.querySelectorAll("[role=\\"dialog\\"], [role=\\"alertdialog\\"]");',
    '  if (dialogs.length === 0 && action === "archive") return JSON.stringify({ ok: true, note: "No archive confirmation dialog required" });',
    '  if (dialogs.length !== 1) return JSON.stringify({ ok: false, note: "Expected exactly one confirmation dialog" });',
    '  const element = findCandidate(["button"], ' + labelPattern + ', ' + testIdPattern + ', dialogs[0]);',
    '  if (!element || element.disabled === true) return JSON.stringify({ ok: false, note: "Confirmation button not found or disabled" });',
    '  element.click();',
    '  return JSON.stringify({ ok: true, note: "Confirmation clicked" });',
  ].join('\n'));
}

export function buildReloadScript(): string {
  return '(() => { try { window.location.reload(); return JSON.stringify({ ok: true, note: "Reload requested" }); } catch (error) { return JSON.stringify({ ok: false, note: "Reload failed" }); } })()';
}

/** Sidebar state before the action: every other conversation currently listed (target excluded). */
export function buildSnapshotScript(id: string): string {
  return [
    '(() => {',
    '  const SELECTORS = ' + JSON.stringify(SELECTORS) + ';',
    '  // Most specific selector first; the first one that matches wins, and only if it matches exactly one element (several = ambiguous = fail closed) (a broad "aside" also contains the history nav).',
    '  const pickSidebar = () => { for (const selector of SELECTORS.sidebarRoots) { const found = window.document.querySelectorAll(selector); if (found.length > 1) return null; if (found.length === 1) return found[0]; } return null; };',
    '  const sidebar = pickSidebar();',
    '  if (!sidebar) return JSON.stringify({ ok: false, note: "History sidebar not found or ambiguous" });',
    '  if (sidebar.querySelector("[aria-busy=\\"true\\"], [data-testid*=\\"skeleton\\"], [class*=\\"skeleton\\"]")) return JSON.stringify({ ok: false, note: "History list is still loading" });',
    '  const targetPath = "/c/" + ' + JSON.stringify(id.toLowerCase()) + ';',
    '  const paths = Array.from(sidebar.querySelectorAll(SELECTORS.sidebarLinks.join(","))).map((link) => { try { return new URL(link.getAttribute("href") || "", window.location.origin).pathname.toLowerCase(); } catch (error) { return ""; } }).filter((path) => /^\\/c\\/[0-9a-f-]{36}$/.test(path) && path !== targetPath);',
    '  return JSON.stringify({ ok: true, note: "Snapshot taken", others: Array.from(new Set(paths)) });',
    '})()',
  ].join('\n');
}

function buildSidebarCheckScript(id: string, requireGonePage: boolean, others: readonly string[]): string {
  const pageCondition = requireGonePage
    ? [
        '  const currentPath = window.location.pathname;',
        '  const messageNodes = window.document.querySelectorAll(SELECTORS.notFoundMessages.join(","));',
        '  const pageText = Array.from(messageNodes).map((node) => node.textContent || "").join(" ");',
        '  const notFound = /conversation not found|chat not found|could not find|unable to find|找不到对话|找不到此对话|对话不存在|404/i.test(pageText);',
        '  const atHome = currentPath === "/";',
      ]
    : [];

  // Completeness evidence: every other conversation that was listed BEFORE the action must still be
  // listed now, so a partially loaded list can never make the target look gone. Without a non-empty
  // snapshot the only acceptable evidence is an explicit "not found" page (delete); archive then
  // cannot be confirmed and is left for manual cleanup.
  const confirmedExpression = requireGonePage
    ? '(notFound || (atHome && expected.length > 0 && othersPresent)) && !stillListed'
    : 'expected.length > 0 && othersPresent && !stillListed';

  return [
    '(() => {',
    '  const SELECTORS = ' + JSON.stringify(SELECTORS) + ';',
    '  const targetId = ' + JSON.stringify(id.toLowerCase()) + ';',
    '  const expected = ' + JSON.stringify(others) + ';',
    '  // Most specific selector first; the first one that matches wins, and only if it matches exactly one element (several = ambiguous = fail closed) (a broad "aside" also contains the history nav).',
    '  const pickSidebar = () => { for (const selector of SELECTORS.sidebarRoots) { const found = window.document.querySelectorAll(selector); if (found.length > 1) return null; if (found.length === 1) return found[0]; } return null; };',
    '  const sidebar = pickSidebar();',
    '  if (!sidebar) return JSON.stringify({ ok: false, note: "History sidebar not found or ambiguous; cannot confirm" });',
    '  if (sidebar.querySelector("[aria-busy=\\"true\\"], [data-testid*=\\"skeleton\\"], [class*=\\"skeleton\\"]")) return JSON.stringify({ ok: false, note: "History list is still loading; cannot confirm" });',
    '  const links = sidebar.querySelectorAll(SELECTORS.sidebarLinks.join(","));',
    '  const targetPath = "/c/" + targetId;',
    '  const listed = new Set(Array.from(links).map((link) => { try { return new URL(link.getAttribute("href") || "", window.location.origin).pathname.toLowerCase(); } catch (error) { return ""; } }));',
    '  const othersPresent = expected.every((path) => listed.has(path));',
    '  const stillListed = Array.from(links).some((link) => (link.getAttribute("href") || "").toLowerCase().includes(targetPath));',
    ...pageCondition,
    '  const confirmed = ' + confirmedExpression + ';',
    '  return JSON.stringify({ ok: confirmed, note: confirmed ? "Conversation is absent after reload or navigation" : "Conversation absence was not confirmed" });',
    '})()',
  ].join('\n');
}

export function buildConfirmGoneScript(id: string, others: readonly string[] = []): string {
  return buildSidebarCheckScript(id, true, others);
}

export function buildConfirmArchivedScript(id: string, others: readonly string[] = []): string {
  return buildSidebarCheckScript(id, false, others);
}

// WebView2 JSON-encodes the return value; scripts here already return JSON strings.
function parsePageResult(raw: string): unknown {
  const value: unknown = JSON.parse(raw);
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function parseSnapshot(raw: string): string[] | undefined {
  try {
    const parsed = parsePageResult(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as { ok?: unknown; others?: unknown };
    if (record.ok !== true || !Array.isArray(record.others)) return undefined;
    return record.others.filter((item): item is string => typeof item === 'string');
  } catch {
    return undefined;
  }
}

function parseCleanerStep(raw: string): CleanerStep {
  try {
    const parsed = parsePageResult(raw);
    if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed) || typeof parsed.ok !== 'boolean') {
      return { ok: false, note: 'Page script returned an invalid result' };
    }

    const note = 'note' in parsed && typeof parsed.note === 'string' ? parsed.note : undefined;
    return note === undefined ? { ok: parsed.ok } : { ok: parsed.ok, note };
  } catch {
    return { ok: false, note: 'Page script returned invalid JSON' };
  }
}

export function createChatGptCleaner(dependencies: ChatGptCleanerDependencies): ConversationCleaner {
  const evaluateStep = async (script: string): Promise<CleanerStep> => {
    return parseCleanerStep(await dependencies.evalInPage(script));
  };

  const openMenu = async (path: string): Promise<CleanerStep> => {
    const step = await evaluateStep(buildOpenMenuScript(path));
    if (!step.ok) return step;
    await dependencies.sleep(150);
    return step;
  };

  // Per conversation id: the other conversations listed before the action (readback evidence).
  const snapshots = new Map<string, string[]>();
  const takeSnapshot = async (id: string): Promise<boolean> => {
    const others = parseSnapshot(await dependencies.evalInPage(buildSnapshotScript(id)));
    if (!others) return false;
    snapshots.set(id, others);
    return true;
  };

  return {
    provider: 'chatgpt' satisfies AIProvider,
    supports: { delete: true, archive: true },
    matchesConversationUrl: (url: string): boolean => normalizeConversationUrl(url) !== undefined,

    deleteConversation: async (url: string): Promise<CleanerStep> => {
      const normalized = normalizeConversationUrl(url);
      if (!normalized) return { ok: false, note: 'Unsupported conversation URL' };

      await dependencies.navigate(normalized.href);
      await dependencies.sleep(300);
      // Without a readable, fully loaded sidebar there will be no way to confirm: do not act.
      if (!(await takeSnapshot(normalized.id))) return { ok: false, note: 'History sidebar not loaded; refusing to act without a way to confirm' };
      const menu = await openMenu(normalized.path);
      if (!menu.ok) return menu;

      await dependencies.sleep(120);
      const deletion = await evaluateStep(buildDeleteScript(normalized.path));
      if (!deletion.ok) return deletion;

      await dependencies.sleep(120);
      return evaluateStep(buildConfirmScript(normalized.path, 'delete'));
    },

    archiveConversation: async (url: string): Promise<CleanerStep> => {
      const normalized = normalizeConversationUrl(url);
      if (!normalized) return { ok: false, note: 'Unsupported conversation URL' };

      await dependencies.navigate(normalized.href);
      await dependencies.sleep(300);
      // Without a readable, fully loaded sidebar there will be no way to confirm: do not act.
      if (!(await takeSnapshot(normalized.id))) return { ok: false, note: 'History sidebar not loaded; refusing to act without a way to confirm' };
      const menu = await openMenu(normalized.path);
      if (!menu.ok) return menu;

      await dependencies.sleep(120);
      const archive = await evaluateStep(buildArchiveScript(normalized.path));
      if (!archive.ok) return archive;

      await dependencies.sleep(120);
      return evaluateStep(buildConfirmScript(normalized.path, 'archive'));
    },

    confirmGone: async (url: string): Promise<boolean> => {
      const normalized = normalizeConversationUrl(url);
      if (!normalized) return false;

      await dependencies.navigate(normalized.href);
      await dependencies.sleep(400);
      const others = snapshots.get(normalized.id) ?? [];
      const first = await evaluateStep(buildConfirmGoneScript(normalized.id, others));
      if (!first.ok) return false;
      // The evidence must hold twice, a moment apart, so a half-loaded page cannot pass.
      await dependencies.sleep(1_500);
      const second = await evaluateStep(buildConfirmGoneScript(normalized.id, others));
      return second.ok;
    },

    confirmArchived: async (url: string): Promise<boolean> => {
      const normalized = normalizeConversationUrl(url);
      if (!normalized) return false;

      await dependencies.navigate(normalized.href);
      await dependencies.sleep(250);
      const reload = await evaluateStep(buildReloadScript());
      if (!reload.ok) return false;

      await dependencies.sleep(500);
      const others = snapshots.get(normalized.id) ?? [];
      const first = await evaluateStep(buildConfirmArchivedScript(normalized.id, others));
      if (!first.ok) return false;
      await dependencies.sleep(1_500);
      const second = await evaluateStep(buildConfirmArchivedScript(normalized.id, others));
      return second.ok;
    },
  };
}
