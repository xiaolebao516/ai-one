export type WebviewBoundsWindow = Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>;

export interface WebviewBoundsSyncOptions {
  getRect: () => DOMRectReadOnly;
  setBounds: (rect: DOMRectReadOnly) => void | Promise<unknown>;
  window: WebviewBoundsWindow;
}

/** Return a CSS-pixel rectangle only when it can be painted safely. */
export function getVisibleWebviewRect(rect: DOMRectReadOnly | null | undefined): DOMRectReadOnly | null {
  if (!rect) return null;

  const { x, y, width, height } = rect;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return rect;
}

/**
 * Coalesce layout events to one animation frame and avoid sending identical CSS-pixel bounds.
 * Host-side devicePixelRatio conversion remains the host's responsibility.
 */
export function createWebviewBoundsSyncController(options: WebviewBoundsSyncOptions) {
  let frameId: number | null = null;
  let lastBoundsKey: string | null = null;
  let disposed = false;

  const flush = () => {
    frameId = null;
    if (disposed) return;

    let rect: DOMRectReadOnly | null;
    try {
      rect = getVisibleWebviewRect(options.getRect());
    } catch {
      rect = null;
    }

    if (!rect) {
      lastBoundsKey = null;
      return;
    }

    const key = JSON.stringify([rect.x, rect.y, rect.width, rect.height]);
    if (key === lastBoundsKey) return;
    lastBoundsKey = key;

    try {
      void Promise.resolve(options.setBounds(rect)).catch(() => undefined);
    } catch {
      // A transient host failure must not create a retry loop.
    }
  };

  const schedule = () => {
    if (disposed || frameId !== null) return;

    try {
      frameId = options.window.requestAnimationFrame(flush);
    } catch {
      flush();
    }
  };

  const reset = () => {
    if (frameId !== null) {
      try {
        options.window.cancelAnimationFrame(frameId);
      } catch {
        // Reset is also used during teardown; cancellation failure is harmless.
      }
    }
    frameId = null;
    lastBoundsKey = null;
  };

  const dispose = () => {
    disposed = true;
    reset();
  };

  return { schedule, flush, reset, dispose };
}
