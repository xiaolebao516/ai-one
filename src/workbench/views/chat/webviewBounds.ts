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

function intersectRects(a: DOMRectReadOnly, b: { left: number; top: number; right: number; bottom: number }): DOMRectReadOnly {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRectReadOnly;
}

const CLIPPING_OVERFLOW = /(auto|scroll|hidden|clip)/;

/**
 * A native WebView cannot be clipped by CSS: it paints over whatever is above the container. So the
 * rectangle sent to the host is the container's rectangle cut down to what its scrolling ancestors
 * show, minus the bottom edge of any `[data-native-occluder]` element (a sticky bar inside the
 * scroller). Fully clipped means an empty rectangle, which callers treat as "not visible".
 */
export function clipRectToVisibleArea(
  rect: DOMRectReadOnly,
  element: Element,
  view: Pick<Window, 'getComputedStyle'>,
): DOMRectReadOnly {
  if (typeof view.getComputedStyle !== 'function') return rect;
  let clipped = rect;
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (!CLIPPING_OVERFLOW.test(style.overflowY) && !CLIPPING_OVERFLOW.test(style.overflowX)) continue;
    const box = node.getBoundingClientRect();
    clipped = intersectRects(clipped, box);
    for (const occluder of node.querySelectorAll('[data-native-occluder]')) {
      const bar = occluder.getBoundingClientRect();
      if (bar.width <= 0 || bar.height <= 0) continue;
      if (bar.bottom > clipped.top && bar.top <= clipped.top) {
        clipped = intersectRects(clipped, { left: clipped.left, top: bar.bottom, right: clipped.right, bottom: clipped.bottom });
      }
    }
  }
  return clipped;
}
