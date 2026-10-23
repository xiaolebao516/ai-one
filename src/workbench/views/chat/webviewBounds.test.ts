// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createWebviewBoundsSyncController, getVisibleWebviewRect } from './webviewBounds';

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
