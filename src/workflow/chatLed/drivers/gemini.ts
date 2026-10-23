import type { ConversationCleaner } from '../cleanup';
import {
  createProviderCleaner,
  normalizeProviderConversationUrl,
  type ProviderCleanerConfig,
  type ProviderCleanerDependencies,
  type ProviderCleanupSelectors,
} from './providerCleaner';

// Confirmation dialog structure is unverified on the real site; unknown or ambiguous dialogs must fail closed.
export const SELECTORS: ProviderCleanupSelectors = {
  historyRoot: "aside",
  historyLink: "gem-nav-list-item[data-test-id=\"conversation\"] a[href^=\"/app/\"]",
  loading: "[aria-busy=\"true\"],[data-loading=\"true\"]",
  row: "gem-nav-list-item[data-test-id=\"conversation\"]",
  rowTitle: "a[href^=\"/app/\"][aria-label]",
  menuTrigger: "[data-test-id=\"actions-menu-button\"] button[aria-label]",
  menu: ".mat-mdc-menu-panel",
  deleteAction: "[role=\"menuitem\"][data-test-id=\"delete-button\"]",
  archiveAction: "",
  dialog: "[role=\"dialog\"],[role=\"alertdialog\"],mat-dialog-container",
  dialogTitle: "h1,h2,h3,[role=\"heading\"],p,span,strong,.mat-mdc-dialog-title",
  confirmDelete: "button,[role=\"button\"]",
  confirmArchive: "",
  notFoundHeading: "",
  notFoundText: "",
};

export const GEMINI_CLEANER_CONFIG: ProviderCleanerConfig = {
  provider: 'gemini',
  origin: 'https://gemini.google.com',
  conversationPath: /^\/app\/[0-9a-f]{8,32}$/i,
  selectors: SELECTORS,
  verified: { delete: true, archive: false },
};

export function createGeminiCleaner(dependencies: ProviderCleanerDependencies): ConversationCleaner {
  return createProviderCleaner(GEMINI_CLEANER_CONFIG, dependencies);
}

export function normalizeGeminiConversationUrl(url: string) {
  return normalizeProviderConversationUrl(GEMINI_CLEANER_CONFIG, url);
}
