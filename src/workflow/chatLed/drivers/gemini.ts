import type { ConversationCleaner } from '../cleanup';
import {
  createProviderCleaner,
  normalizeProviderConversationUrl,
  type ProviderCleanerConfig,
  type ProviderCleanerDependencies,
  type ProviderCleanupSelectors,
} from './providerCleaner';

// 待协调者用真实页面只读探查校准。未取证前不填写臆测选择器，也不允许自动删除/归档。
export const SELECTORS: ProviderCleanupSelectors = {
  historyRoot: '',
  historyLink: '',
  loading: '',
  row: '',
  rowTitle: '',
  menuTrigger: '',
  menu: '',
  deleteAction: '',
  archiveAction: '',
  dialog: '',
  dialogTitle: '',
  confirmDelete: '',
  confirmArchive: '',
  notFoundHeading: '',
  notFoundText: '',
};

export const GEMINI_CLEANER_CONFIG: ProviderCleanerConfig = {
  provider: 'gemini',
  origin: 'https://gemini.google.com',
  // Conservative URL form from Spec #144; confirm the real site's path shape before enabling.
  conversationPath: /^\/app\/[A-Za-z0-9_-]{8,128}$/,
  selectors: SELECTORS,
  verified: { delete: false, archive: false },
};

export function createGeminiCleaner(dependencies: ProviderCleanerDependencies): ConversationCleaner {
  return createProviderCleaner(GEMINI_CLEANER_CONFIG, dependencies);
}

export function normalizeGeminiConversationUrl(url: string) {
  return normalizeProviderConversationUrl(GEMINI_CLEANER_CONFIG, url);
}
