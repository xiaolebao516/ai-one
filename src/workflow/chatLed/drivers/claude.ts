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

export const CLAUDE_CLEANER_CONFIG: ProviderCleanerConfig = {
  provider: 'claude',
  origin: 'https://claude.ai',
  // Conservative URL form from Spec #144; confirm the real site's path shape before enabling.
  conversationPath: /^\/chat\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  selectors: SELECTORS,
  verified: { delete: false, archive: false },
};

export function createClaudeCleaner(dependencies: ProviderCleanerDependencies): ConversationCleaner {
  return createProviderCleaner(CLAUDE_CLEANER_CONFIG, dependencies);
}

export function normalizeClaudeConversationUrl(url: string) {
  return normalizeProviderConversationUrl(CLAUDE_CLEANER_CONFIG, url);
}
