import type { ConversationCleaner } from '../cleanup';
import {
  createProviderCleaner,
  normalizeProviderConversationUrl,
  type ProviderCleanerConfig,
  type ProviderCleanerDependencies,
  type ProviderCleanupSelectors,
} from './providerCleaner';

// Real confirmation dialogs and menu-click effects are unverified; fill dedicated selectors after live inspection.
export const SELECTORS: ProviderCleanupSelectors = {
  historyRoot: "aside:has(a[data-row-main-button][href^=\"/chat/\"])",
  historyLink: "a[data-row-main-button][href^=\"/chat/\"]",
  loading: "[aria-busy=\"true\"],[data-loading=\"true\"]",
  row: "div[data-row]",
  rowTitle: "a[data-row-main-button]",
  menuTrigger: "button[data-row-action][aria-haspopup=\"menu\"]",
  menu: "[role=\"menu\"]",
  deleteAction: "[role=\"menuitem\"][data-testid=\"delete-chat-trigger\"]",
  archiveAction: "[role=\"menuitem\"][data-testid=\"archive-chat-trigger\"]",
  dialog: "",
  dialogTitle: "",
  confirmDelete: "",
  confirmArchive: "",
  notFoundHeading: "",
  notFoundText: "",
};

export const CLAUDE_CLEANER_CONFIG: ProviderCleanerConfig = {
  provider: 'claude',
  origin: 'https://claude.ai',
  conversationPath: /^\/chat\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  selectors: SELECTORS,
  // Enable delete and archive separately only after verifying each site's real confirmation and readback.
  verified: { delete: false, archive: false },
};

export function createClaudeCleaner(dependencies: ProviderCleanerDependencies): ConversationCleaner {
  return createProviderCleaner(CLAUDE_CLEANER_CONFIG, dependencies);
}

export function normalizeClaudeConversationUrl(url: string) {
  return normalizeProviderConversationUrl(CLAUDE_CLEANER_CONFIG, url);
}
