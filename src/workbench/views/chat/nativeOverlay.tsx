import { createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore, type PropsWithChildren } from 'react';

interface OverlayStore {
  getSnapshot: () => number;
  subscribe: (listener: () => void) => () => void;
  register: () => () => void;
}

function createOverlayStore(): OverlayStore {
  let count = 0;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => count,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    register: () => {
      count += 1;
      notify();

      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        count = Math.max(0, count - 1);
        notify();
      };
    },
  };
}

const fallbackStore = createOverlayStore();
const NativeOverlayContext = createContext<OverlayStore>(fallbackStore);

export function NativeOverlayProvider({ children }: PropsWithChildren) {
  const store = useMemo(createOverlayStore, []);
  return <NativeOverlayContext.Provider value={store}>{children}</NativeOverlayContext.Provider>;
}

/**
 * Register a DOM overlay while it is open so native provider WebViews can be parked off-screen.
 * Registration is effect-owned: toggling open off or unmounting always releases the count.
 */
export function useNativeOverlayGuard(open: boolean): void {
  const store = useContext(NativeOverlayContext);

  useLayoutEffect(() => {
    if (!open) return undefined;
    return store.register();
  }, [open, store]);
}

export function useNativeOverlayCount(): number {
  const store = useContext(NativeOverlayContext);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Render while a DOM overlay is open; native WebViews stay parked for as long as it is mounted. */
export function NativeOverlayGuard() {
  useNativeOverlayGuard(true);
  return null;
}
