// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { clipRectToVisibleArea, createWebviewBoundsSyncController, getVisibleWebviewRect } from './webviewBounds';

function rect(x: number, y: number, width: number, height: number): DOMRectReadOnly {
  const top = y;
  const left = x;
  const right = x + width;
  const bottom = y + height;
  return { x, y, width, height, top, left, right, bottom, toJSON: () => ({ x, y, width, height }) };
}

function rafWindow() {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const browserWindow = {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      nextId += 1;
      callbacks.set(nextId, callback);
      return nextId;
    },
    cancelAnimationFrame: (id: number) => {
      callbacks.delete(id);
    },
  } as Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>;

  return {
    browserWindow,
    flush: () => {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) callback(0);
    },
    pending: () => callbacks.size,
  };
}

describe('webview bounds', () => {
  it('rejects zero, negative, and non-finite dimensions or coordinates', () => {
    expect(getVisibleWebviewRect(rect(0, 0, 0, 20))).toBeNull();
    expect(getVisibleWebviewRect(rect(0, 0, 20, -1))).toBeNull();
    expect(getVisibleWebviewRect(rect(0, 0, Number.NaN, 20))).toBeNull();
    expect(getVisibleWebviewRect(rect(Number.NaN, 0, 20, 20))).toBeNull();
    expect(getVisibleWebviewRect(rect(0, 0, 20, 20))).not.toBeNull();
  });

  it('coalesces events into one animation frame and deduplicates identical rectangles', () => {
    const raf = rafWindow();
    let current = rect(10, 20, 300, 240);
    const setBounds = vi.fn();
    const controller = createWebviewBoundsSyncController({
      getRect: () => current,
      setBounds,
      window: raf.browserWindow,
    });

    controller.schedule();
    controller.schedule();
    controller.schedule();
    expect(raf.pending()).toBe(1);
    raf.flush();
    expect(setBounds).toHaveBeenCalledTimes(1);
    expect(setBounds).toHaveBeenCalledWith(current);

    controller.schedule();
    raf.flush();
    expect(setBounds).toHaveBeenCalledTimes(1);

    current = rect(11, 20, 300, 240);
    controller.schedule();
    raf.flush();
    expect(setBounds).toHaveBeenCalledTimes(2);
    expect(setBounds).toHaveBeenLastCalledWith(current);

    controller.dispose();
  });

  it('resets deduplication after an invalid rectangle and cancels a pending frame on reset', () => {
    const raf = rafWindow();
    let current = rect(10, 20, 300, 240);
    const setBounds = vi.fn();
    const controller = createWebviewBoundsSyncController({
      getRect: () => current,
      setBounds,
      window: raf.browserWindow,
    });

    controller.schedule();
    raf.flush();
    current = rect(10, 20, 0, 240);
    controller.schedule();
    raf.flush();
    current = rect(10, 20, 300, 240);
    controller.schedule();
    raf.flush();
    expect(setBounds).toHaveBeenCalledTimes(2);

    controller.schedule();
    expect(raf.pending()).toBe(1);
    controller.reset();
    expect(raf.pending()).toBe(0);
    controller.dispose();
  });
});

describe('clipRectToVisibleArea', () => {
  const box = (left: number, top: number, right: number, bottom: number) =>
    ({ x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top, toJSON: () => ({}) }) as DOMRectReadOnly;

  function scrollerWith(scrollBox: DOMRectReadOnly, bar?: DOMRectReadOnly) {
    const scroller = document.createElement('main');
    scroller.style.overflowY = 'auto';
    scroller.getBoundingClientRect = () => scrollBox;
    if (bar) {
      const sticky = document.createElement('div');
      sticky.setAttribute('data-native-occluder', '');
      sticky.getBoundingClientRect = () => bar;
      scroller.append(sticky);
    }
    const element = document.createElement('div');
    scroller.append(element);
    document.body.append(scroller);
    return { scroller, element };
  }

  it('cuts the rectangle to the scrolling ancestor', () => {
    const { scroller, element } = scrollerWith(box(0, 100, 800, 600));
    const clipped = clipRectToVisibleArea(box(50, 40, 500, 400), element, window);
    expect([clipped.x, clipped.y, clipped.width, clipped.height]).toEqual([50, 100, 450, 300]);
    scroller.remove();
  });

  it('also stays below a sticky bar and becomes empty when fully scrolled away', () => {
    const { scroller, element } = scrollerWith(box(0, 50, 800, 600), box(0, 50, 800, 120));
    const below = clipRectToVisibleArea(box(50, 80, 500, 400), element, window);
    expect(below.y).toBe(120);
    const gone = clipRectToVisibleArea(box(50, 0, 500, 40), element, window);
    expect(gone.width * gone.height).toBe(0);
    scroller.remove();
  });

  it('leaves the rectangle alone without computed styles (non-DOM windows)', () => {
    const rect = box(1, 2, 3, 4);
    expect(clipRectToVisibleArea(rect, document.createElement('div'), {} as unknown as Window)).toBe(rect);
  });
});
