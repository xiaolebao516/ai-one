import type { ProviderInstance } from '../../../shared/types';
import { host } from '../../host';

/**
 * Provider pages a live chat-led run is using (#196). The run keeps going while the user is on
 * another tab, but leaving the chat tab hides the page the chat had centred. A hidden page stops
 * reporting its status, so for these pages the chat's overlay guard parks them offscreen instead.
 */
const runPages = new Set<ProviderInstance>();

export function setRunPages(providers: Iterable<ProviderInstance>): void {
  runPages.clear();
  for (const provider of providers) runPages.add(provider);
}

/** Same offscreen parking rectangle the classic UI uses for background provider pages. */
export function parkedBounds(): DOMRectReadOnly {
  return {
    x: -10_000,
    y: -10_000,
    width: 420,
    height: 320,
    top: -10_000,
    left: -10_000,
    right: -9_580,
    bottom: -9_680,
    toJSON: () => ({}),
  };
}

/** The overlay guard's hide: pages in use by a run go offscreen but stay live. */
export function hideUnlessRunPage(provider: ProviderInstance): Promise<void> {
  return runPages.has(provider) ? host.provider.park(provider, parkedBounds()) : host.provider.hide(provider);
}
