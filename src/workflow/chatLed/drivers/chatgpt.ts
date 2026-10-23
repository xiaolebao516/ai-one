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
    '  const findCandidate = (selectors, labelPattern, testIdPattern) => {',
    '    const seen = new Set();',
    '    for (const selector of selectors) {',
    '      const elements = window.document.querySelectorAll(selector);',
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
    '  const element = findCandidate(SELECTORS.menuButtons, /more|option|对话选项|聊天选项|更多/i, /conversation-options-menu|conversation-menu-trigger/i);',
    '  if (!element || element.disabled === true) return JSON.stringify({ ok: false, note: "Options menu not found or disabled" });',
    '  element.click();',
    '  return JSON.stringify({ ok: true, note: "Options menu opened" });',
  ].join('\n'));
}

export function buildDeleteScript(path: string): string {
  return guardedScript(path, [
    '  const element = findCandidate(SELECTORS.actionCandidates, /delete|remove|删除/i, /delete/i);',
    '  if (!element || element.disabled === true) return JSON.stringify({ ok: false, note: "Delete action not found or disabled" });',
    '  element.click();',
    '  return JSON.stringify({ ok: true, note: "Delete action selected" });',
  ].join('\n'));
}

export function buildArchiveScript(path: string): string {
  return guardedScript(path, [
    '  const element = findCandidate(SELECTORS.actionCandidates, /archive|归档/i, /archive/i);',
    '  if (!element || element.disabled === true) return JSON.stringify({ ok: false, note: "Archive action not found or disabled" });',
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
    '  const element = findCandidate(SELECTORS.confirmationCandidates, ' + labelPattern + ', ' + testIdPattern + ');',
    '  if (!element && action === "archive") return JSON.stringify({ ok: true, note: "No archive confirmation dialog required" });',
    '  if (!element || element.disabled === true) return JSON.stringify({ ok: false, note: "Confirmation button not found or disabled" });',
    '  element.click();',
    '  return JSON.stringify({ ok: true, note: "Confirmation clicked" });',
  ].join('\n'));
}

export function buildReloadScript(): string {
  return '(() => { try { window.location.reload(); return JSON.stringify({ ok: true, note: "Reload requested" }); } catch (error) { return JSON.stringify({ ok: false, note: "Reload failed" }); } })()';
}

function buildSidebarCheckScript(id: string, requireGonePage: boolean): string {
  const pageCondition = requireGonePage
    ? [
        '  const currentPath = window.location.pathname;',
        '  const messageNodes = window.document.querySelectorAll(SELECTORS.notFoundMessages.join(","));',
        '  const pageText = Array.from(messageNodes).map((node) => node.textContent || "").join(" ");',
        '  const notFound = /conversation not found|chat not found|could not find|unable to find|找不到对话|找不到此对话|对话不存在|404/i.test(pageText);',
        '  const atHome = currentPath === "/";',
      ]
    : [];

  const confirmedExpression = requireGonePage
    ? '(atHome || notFound) && !stillListed'
    : '!stillListed';

  return [
    '(() => {',
    '  const SELECTORS = ' + JSON.stringify(SELECTORS) + ';',
    '  const targetId = ' + JSON.stringify(id.toLowerCase()) + ';',
    '  const sidebar = window.document.querySelector(SELECTORS.sidebarRoots.join(","));',
    '  if (!sidebar) return JSON.stringify({ ok: false, note: "History sidebar not found" });',
    '  const links = sidebar.querySelectorAll(SELECTORS.sidebarLinks.join(","));',
    '  const targetPath = "/c/" + targetId;',
    '  const stillListed = Array.from(links).some((link) => (link.getAttribute("href") || "").toLowerCase().includes(targetPath));',
    ...pageCondition,
    '  const confirmed = ' + confirmedExpression + ';',
    '  return JSON.stringify({ ok: confirmed, note: confirmed ? "Conversation is absent after reload or navigation" : "Conversation absence was not confirmed" });',
    '})()',
  ].join('\n');
}

export function buildConfirmGoneScript(id: string): string {
  return buildSidebarCheckScript(id, true);
}

export function buildConfirmArchivedScript(id: string): string {
  return buildSidebarCheckScript(id, false);
}

function parseCleanerStep(raw: string): CleanerStep {
  try {
    const parsed: unknown = JSON.parse(raw);
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

  return {
    provider: 'chatgpt' satisfies AIProvider,
    supports: { delete: true, archive: true },
    matchesConversationUrl: (url: string): boolean => normalizeConversationUrl(url) !== undefined,

    deleteConversation: async (url: string): Promise<CleanerStep> => {
      const normalized = normalizeConversationUrl(url);
      if (!normalized) return { ok: false, note: 'Unsupported conversation URL' };

      await dependencies.navigate(normalized.href);
      await dependencies.sleep(300);
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
      const step = await evaluateStep(buildConfirmGoneScript(normalized.id));
      return step.ok;
    },

    confirmArchived: async (url: string): Promise<boolean> => {
      const normalized = normalizeConversationUrl(url);
      if (!normalized) return false;

      await dependencies.navigate(normalized.href);
      await dependencies.sleep(250);
      const reload = await evaluateStep(buildReloadScript());
      if (!reload.ok) return false;

      await dependencies.sleep(500);
      const step = await evaluateStep(buildConfirmArchivedScript(normalized.id));
      return step.ok;
    },
  };
}
