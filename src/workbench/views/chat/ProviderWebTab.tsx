import { useLayoutEffect, useRef } from 'react';
import type { AIProvider } from '../../../../shared/types';
import { host } from '../../../host';
import { useNativeOverlayCount } from './nativeOverlay';
import { clipRectToVisibleArea, createWebviewBoundsSyncController, getVisibleWebviewRect } from './webviewBounds';

function makeRect(x: number, y: number, width: number, height: number): DOMRectReadOnly {
  const top = y;
  const left = x;
  const right = x + width;
  const bottom = y + height;
  return {
    x,
    y,
    width,
    height,
    top,
    left,
    right,
    bottom,
    toJSON: () => ({ x, y, width, height, top, left, right, bottom }),
  };
}

/** Keep in sync with App.tsx hiddenProviderLoadBounds(). */
export const HIDDEN_PROVIDER_LOAD_BOUNDS = Object.freeze(makeRect(-10000, -10000, 420, 320));
const EMPTY_RECT = makeRect(0, 0, 0, 0);

export interface ProviderWebTabHost {
  app: {
    isDesktop: () => boolean;
  };
  provider: {
    open: (provider: AIProvider, bounds: DOMRectReadOnly) => Promise<unknown>;
    show: (provider: AIProvider) => Promise<unknown> | unknown;
    hide: (provider: AIProvider) => Promise<unknown> | unknown;
    park: (provider: AIProvider, bounds: DOMRectReadOnly) => Promise<unknown> | unknown;
  };
  layout: {
    setBounds: (provider: AIProvider, bounds: DOMRectReadOnly) => Promise<unknown> | unknown;
  };
}

export interface NativeWindowFocusApi {
  onFocusChanged: (handler: (event: { payload: boolean }) => void) => Promise<() => void>;
  isFocused?: () => Promise<boolean>;
}

export interface ProviderWebTabControllerOptions {
  provider: AIProvider;
  host: ProviderWebTabHost;
  window: Window;
  document: Document;
  ResizeObserver?: typeof ResizeObserver;
  getCurrentWindow?: () => Promise<NativeWindowFocusApi> | NativeWindowFocusApi;
}

export interface ProviderWebTabController {
  start: (container: HTMLElement | null) => void;
  setState: (state: { active: boolean; overlayCount: number }) => void;
  dispose: () => void;
  whenIdle: () => Promise<void>;
}

const providerIntentVersions = new Map<AIProvider, number>();
const providerCommandQueues = new Map<AIProvider, Promise<boolean>>();

function nextProviderIntent(provider: AIProvider): number {
  const next = (providerIntentVersions.get(provider) ?? 0) + 1;
  providerIntentVersions.set(provider, next);
  return next;
}

function isCurrentProviderIntent(provider: AIProvider, version: number): boolean {
  return providerIntentVersions.get(provider) === version;
}

function enqueueProviderCommand(provider: AIProvider, command: () => Promise<unknown>): Promise<boolean> {
  const previous = providerCommandQueues.get(provider) ?? Promise.resolve(true);
  const pending = previous.catch(() => false).then(async () => {
    try {
      const result = await command();
      return result !== false;
    } catch {
      // Keep the queue alive, but report failure so bounds deduplication can retry.
      return false;
    }
  });
  providerCommandQueues.set(provider, pending);
  return pending;
}

async function defaultGetCurrentWindow(): Promise<NativeWindowFocusApi> {
  const tauriWindow = await import('@tauri-apps/api/window');
  return tauriWindow.getCurrentWindow() as unknown as NativeWindowFocusApi;
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for focused unit tests.
export function createProviderWebTabController(
  options: ProviderWebTabControllerOptions,
): ProviderWebTabController {
  const { provider, host: providerHost, window: browserWindow, document: browserDocument } = options;
  let started = false;
  let disposed = false;
  let desktop = false;
  let active = false;
  let overlayCount = 0;
  let windowFocused = true;
  let desiredVisible: boolean | null = null;
  let intentVersion = 0;
  let container: HTMLElement | null = null;
  let observer: ResizeObserver | null = null;
  let pollTimer: number | null = null;
  let parkRetryTimer: number | null = null;
  let parkQueuedVersion: number | null = null;
  let parkedVersion: number | null = null;
  let resolutionQuery: MediaQueryList | null = null;
  let focusUnlisten: (() => void) | null = null;
  let focusEventVersion = 0;
  let focusSetupPromise: Promise<void> = Promise.resolve();

  const readRect = (): DOMRectReadOnly => {
    if (!container) return EMPTY_RECT;
    try {
      return clipRectToVisibleArea(container.getBoundingClientRect(), container, browserWindow);
    } catch {
      return EMPTY_RECT;
    }
  };

  const boundsSync = createWebviewBoundsSyncController({
    getRect: readRect,
    window: browserWindow,
    setBounds: (rect) => {
      const version = intentVersion;
      return enqueueProviderCommand(provider, async () => {
        if (
          disposed ||
          !isCurrentProviderIntent(provider, version) ||
          desiredVisible !== true
        ) {
          return false;
        }
        const result = await providerHost.layout.setBounds(provider, rect);
        return result === false ? false : true;
      });
    },
  });

  const cancelParkRetry = () => {
    if (parkRetryTimer !== null) browserWindow.clearTimeout(parkRetryTimer);
    parkRetryTimer = null;
  };

  const queuePark = (version: number) => {
    if (parkQueuedVersion === version || parkedVersion === version) return;
    parkQueuedVersion = version;
    const stillWantsPark = () => isCurrentProviderIntent(provider, version) && desiredVisible !== true;
    void enqueueProviderCommand(provider, async () => {
      if (!stillWantsPark()) return false;
      try {
        await providerHost.provider.park(provider, HIDDEN_PROVIDER_LOAD_BOUNDS);
        return true;
      } catch {
        // If offscreen parking fails, hide immediately before retrying park.
      }
      if (!stillWantsPark()) return false;
      try {
        await providerHost.provider.hide(provider);
      } catch {
        // A later attempt must remain possible even when every fallback rejects.
      }
      if (!stillWantsPark()) return false;
      try {
        await providerHost.provider.park(provider, HIDDEN_PROVIDER_LOAD_BOUNDS);
      } catch {
        if (!stillWantsPark()) return false;
        await providerHost.provider.hide(provider);
      }
      return true;
    }).then((confirmed) => {
      if (parkQueuedVersion === version) parkQueuedVersion = null;
      if (!stillWantsPark()) return;
      if (confirmed) {
        parkedVersion = version;
        cancelParkRetry();
      } else if (parkRetryTimer === null) {
        // Also runs after tab deactivation/unmount: the final native hide still needs to succeed.
        // A newer controller's intent makes this retry inert, so it cannot hide a reopened tab.
        parkRetryTimer = browserWindow.setTimeout(() => {
          parkRetryTimer = null;
          if (stillWantsPark()) queuePark(version);
        }, 1000);
      }
    });
  };

  const queueOpen = (version: number, rect: DOMRectReadOnly) => {
    void enqueueProviderCommand(provider, async () => {
      if (
        disposed ||
        !isCurrentProviderIntent(provider, version) ||
        desiredVisible !== true
      ) {
        return;
      }

      await providerHost.provider.open(provider, rect);

      // provider_open may itself show an existing WebView. A newer park intent is queued behind
      // this operation, and this check prevents a stale open from issuing a later show command.
      if (
        disposed ||
        !isCurrentProviderIntent(provider, version) ||
        desiredVisible !== true
      ) {
        return;
      }

      await providerHost.provider.show(provider);
    });
  };

  const reconcile = () => {
    if (!started || !desktop || disposed) return;

    const rect = getVisibleWebviewRect(readRect());
    const shouldBeVisible =
      active &&
      overlayCount === 0 &&
      browserDocument.visibilityState !== 'hidden' &&
      windowFocused &&
      rect !== null;

    if (desiredVisible !== shouldBeVisible) {
      cancelParkRetry();
      desiredVisible = shouldBeVisible;
      intentVersion = nextProviderIntent(provider);
      boundsSync.reset();

      if (shouldBeVisible && rect) {
        queueOpen(intentVersion, rect);
      } else {
        queuePark(intentVersion);
      }
      return;
    }

    if (shouldBeVisible) boundsSync.schedule();
    else queuePark(intentVersion);
  };

  const handleLayoutChange = () => {
    reconcile();
  };

  const handleVisibilityChange = () => {
    reconcile();
  };

  const handleWindowBlur = () => {
    windowFocused = false;
    reconcile();
  };

  const handleWindowFocus = () => {
    windowFocused = true;
    reconcile();
  };

  const handleDprChange = () => {
    installResolutionWatcher();
    boundsSync.reset();
    handleLayoutChange();
  };

  function installResolutionWatcher() {
    if (resolutionQuery) {
      resolutionQuery.removeEventListener('change', handleDprChange);
      resolutionQuery = null;
    }

    try {
      const dpr = browserWindow.devicePixelRatio || 1;
      resolutionQuery = browserWindow.matchMedia('(resolution: ' + dpr + 'dppx)');
      resolutionQuery.addEventListener('change', handleDprChange);
    } catch {
      resolutionQuery = null;
    }
  }

  const setupWindowFocusWatcher = () => {
    const getCurrentWindow = options.getCurrentWindow ?? defaultGetCurrentWindow;
    focusSetupPromise = (async () => {
      let currentWindow: NativeWindowFocusApi;
      try {
        currentWindow = await getCurrentWindow();
      } catch {
        return;
      }

      if (disposed) return;
      const initialFocusEventVersion = focusEventVersion;
      let unlisten: () => void;
      try {
        unlisten = await currentWindow.onFocusChanged((event) => {
          focusEventVersion += 1;
          windowFocused = event.payload;
          reconcile();
        });
      } catch {
        return;
      }

      if (disposed) {
        unlisten();
        return;
      }
      focusUnlisten = unlisten;

      if (currentWindow.isFocused) {
        try {
          const focused = await currentWindow.isFocused();
          if (!disposed && focusEventVersion === initialFocusEventVersion) {
            windowFocused = focused;
            reconcile();
          }
        } catch {
          // Browser blur/focus and document visibility listeners remain as a fallback.
        }
      }
    })();
  };

  const syncPolling = () => {
    if (!started || !desktop || disposed) return;

    if (active && pollTimer === null) {
      pollTimer = browserWindow.setInterval(handleLayoutChange, 1000);
    } else if (!active && pollTimer !== null) {
      browserWindow.clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const start = (element: HTMLElement | null) => {
    if (started || disposed) return;
    started = true;

    try {
      desktop = providerHost.app.isDesktop();
    } catch {
      desktop = false;
    }
    if (!desktop) return;

    container = element;
    browserWindow.addEventListener('resize', handleLayoutChange);
    browserWindow.addEventListener('blur', handleWindowBlur);
    browserWindow.addEventListener('focus', handleWindowFocus);
    browserDocument.addEventListener('scroll', handleLayoutChange, true);
    browserDocument.addEventListener('visibilitychange', handleVisibilityChange);

    if (container && options.ResizeObserver) {
      try {
        observer = new options.ResizeObserver(handleLayoutChange);
        observer.observe(container);
      } catch {
        observer = null;
      }
    }

    installResolutionWatcher();
    setupWindowFocusWatcher();
    syncPolling();
    reconcile();
  };

  const setState = (state: { active: boolean; overlayCount: number }) => {
    if (disposed) return;
    active = state.active;
    overlayCount = Math.max(0, state.overlayCount);
    if (!started || !desktop) return;
    syncPolling();
    reconcile();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelParkRetry();

    if (pollTimer !== null) {
      browserWindow.clearInterval(pollTimer);
      pollTimer = null;
    }
    observer?.disconnect();
    observer = null;
    browserWindow.removeEventListener('resize', handleLayoutChange);
    browserWindow.removeEventListener('blur', handleWindowBlur);
    browserWindow.removeEventListener('focus', handleWindowFocus);
    browserDocument.removeEventListener('scroll', handleLayoutChange, true);
    browserDocument.removeEventListener('visibilitychange', handleVisibilityChange);
    if (resolutionQuery) {
      resolutionQuery.removeEventListener('change', handleDprChange);
      resolutionQuery = null;
    }
    focusUnlisten?.();
    focusUnlisten = null;
    boundsSync.dispose();

    if (desktop && started) {
      desiredVisible = false;
      intentVersion = nextProviderIntent(provider);
      queuePark(intentVersion);
    }
  };

  const whenIdle = async () => {
    await focusSetupPromise;
    await (providerCommandQueues.get(provider) ?? Promise.resolve());
    await Promise.resolve();
    await (providerCommandQueues.get(provider) ?? Promise.resolve());
  };

  return { start, setState, dispose, whenIdle };
}

export function ProviderWebTab({ provider, active }: { provider: AIProvider; active: boolean }) {
  const overlayCount = useNativeOverlayCount();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<ProviderWebTabController | null>(null);

  let desktop = false;
  try {
    desktop = host.app.isDesktop();
  } catch {
    desktop = false;
  }

  useLayoutEffect(() => {
    if (!desktop) return undefined;

    const controller = createProviderWebTabController({
      provider,
      host: host as ProviderWebTabHost,
      window,
      document,
      ResizeObserver: typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver,
      getCurrentWindow: defaultGetCurrentWindow,
    });
    controllerRef.current = controller;
    controller.start(containerRef.current);

    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [desktop, provider]);

  useLayoutEffect(() => {
    controllerRef.current?.setState({ active, overlayCount });
  }, [active, overlayCount]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-[320px] min-w-0 rounded-lg border border-v2-line text-sm text-v2-ink-3 flex items-center justify-center"
      aria-label={desktop ? '网页加载中' : '仅桌面版可用'}
      role="status"
      aria-live="polite"
    >
      {desktop ? '网页加载中…' : '仅桌面版可用'}
    </div>
  );
}
