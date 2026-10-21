import { useSyncExternalStore } from 'react';
import type { V2Mode, V2ModePreference } from './tokens';

/**
 * The v1 app marks its dark themes (dark, ai-sister) with `html.dark`. A v2 scope in `auto` mode
 * follows that class, so v2 surfaces embedded in the existing app switch with the app's theme.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function documentIsDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

export function useDocumentDarkClass(): boolean {
  return useSyncExternalStore(subscribe, documentIsDark, () => false);
}

export function resolveV2Mode(preference: V2ModePreference, documentDark: boolean): V2Mode {
  if (preference === 'auto') return documentDark ? 'dark' : 'light';
  return preference;
}
