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
  historyRoot: "bard-sidenav",
  historyLink: "gem-nav-list-item[data-test-id=\"conversation\"] a[href^=\"/app/\"]",
  loading: "[aria-busy=\"true\"],[data-loading=\"true\"]",
  row: "gem-nav-list-item[data-test-id=\"conversation\"]",
  rowTitle: "a[href^=\"/app/\"][aria-label]",
  menuTrigger: "[data-test-id=\"actions-menu-button\"] button[aria-label]",
  menu: ".mat-mdc-menu-panel",
  deleteAction: "[role=\"menuitem\"][data-test-id=\"delete-button\"]",
  archiveAction: "",
  dialog: "",
  dialogTitle: "",
  confirmDelete: "",
  confirmArchive: "",
  notFoundHeading: "",
  notFoundText: "",
};

export const GEMINI_CLEANER_CONFIG: ProviderCleanerConfig = {
  provider: 'gemini',
  origin: 'https://gemini.google.com',
  conversationPath: /^\/app\/[0-9a-f]{8,32}$/i,
  selectors: SELECTORS,
  // Enable delete and archive separately only after verifying each site's real confirmation and readback.
  verified: { delete: false, archive: false },
};

export function createGeminiCleaner(dependencies: ProviderCleanerDependencies): ConversationCleaner {
  return createProviderCleaner(GEMINI_CLEANER_CONFIG, dependencies);
}

export function normalizeGeminiConversationUrl(url: string) {
  return normalizeProviderConversationUrl(GEMINI_CLEANER_CONFIG, url);
}
