// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '../../../../shared/types';
import { NativeOverlayProvider } from './nativeOverlay';
import {
  createProviderWebTabController,
  HIDDEN_PROVIDER_LOAD_BOUNDS,
  ProviderWebTab,
  type NativeWindowFocusApi,
  type ProviderWebTabHost,
} from './ProviderWebTab';

const componentHost = vi.hoisted(() => ({
  app: { isDesktop: vi.fn(() => false) },
  provider: {
    open: vi.fn(async () => ({})),
    show: vi.fn(async () => undefined),
    park: vi.fn(async () => undefined),
  },
  layout: { setBounds: vi.fn(async () => undefined) },
}));

vi.mock('../../../host', () => ({ host: componentHost }));

const roots: { root: Root; container: HTMLElement }[] = [];
let originalVisibilityDescriptor: PropertyDescriptor | undefined;
let visibility = 'visible';

function rect(x: number, y: number, width: number, height: number): DOMRectReadOnly {
  const top = y;
  const left = x;
  const right = x + width;
  const bottom = y + height;
  return { x, y, width, height, top, left, right, bottom, toJSON: () => ({ x, y, width, height }) };
}

function fakeBrowserWindow() {
  let nextFrameId = 0;
  let devicePixelRatio = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const mediaListeners = new Set<EventListener>();
  const media = {
    addEventListener: (_type: string, listener: EventListener) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: EventListener) => mediaListeners.delete(listener),
  } as unknown as MediaQueryList;

  const browserWindow = {
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      nextFrameId += 1;
      frames.set(nextFrameId, callback);
      return nextFrameId;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    matchMedia: vi.fn(() => media),
    get devicePixelRatio() {
      return devicePixelRatio;
    },
  } as unknown as Window;

  return {
    browserWindow,
    changeDpr: (next: number) => {
      devicePixelRatio = next;
      for (const listener of [...mediaListeners]) listener(new Event('change'));
    },
    flushFrames: () => {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(0);
    },
  };
}

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(_target: Element): void {
    this.callback([], this);
  }

  unobserve(_target: Element): void {}

  disconnect(): void {}
}

let focusHandler: ((event: { payload: boolean }) => void) | null = null;

function createFocusApi(): NativeWindowFocusApi {
  return {
    onFocusChanged: async (handler) => {
      focusHandler = handler;
      return () => {
        focusHandler = null;
      };
    },
    isFocused: async () => true,
  };
}

function makeHost(desktop = true) {
  const calls: string[] = [];
  const host: ProviderWebTabHost = {
    app: { isDesktop: () => desktop },
    provider: {
      open: vi.fn(async () => {
        calls.push('open');
        return {};
      }),
      show: vi.fn(async () => {
        calls.push('show');
      }),
      park: vi.fn(async (_provider: AIProvider, bounds: DOMRectReadOnly) => {
        calls.push('park');
        expect(bounds).toMatchObject({ x: -10000, y: -10000, width: 420, height: 320 });
      }),
    },
    layout: {
      setBounds: vi.fn(async () => {
        calls.push('bounds');
      }),
    },
  };
  return { host, calls };
}

async function settleMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  focusHandler = null;
  vi.resetAllMocks();
  componentHost.app.isDesktop.mockReturnValue(false);
  componentHost.provider.open.mockResolvedValue({});
  componentHost.provider.show.mockResolvedValue(undefined);
  componentHost.provider.park.mockResolvedValue(undefined);
  componentHost.layout.setBounds.mockResolvedValue(undefined);
});

afterEach(async () => {
  for (const entry of roots.splice(0)) {
    await act(async () => entry.root.unmount());
  }
  document.body.innerHTML = '';
  if (originalVisibilityDescriptor) {
    Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor);
  } else {
    Reflect.deleteProperty(document, 'visibilityState');
  }
});

async function mountNonDesktopTab() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  await act(async () => {
    root.render(
      <NativeOverlayProvider>
        <ProviderWebTab provider="chatgpt" active />
      </NativeOverlayProvider>,
    );
  });
  return container;
}

describe('ProviderWebTab', () => {
  it('shows the desktop-only message without issuing native provider commands', async () => {
    componentHost.app.isDesktop.mockReturnValue(false);
    const container = await mountNonDesktopTab();

    expect(container.textContent).toContain('仅桌面版可用');
    expect(componentHost.provider.open).not.toHaveBeenCalled();
    expect(componentHost.provider.show).not.toHaveBeenCalled();
    expect(componentHost.provider.park).not.toHaveBeenCalled();
    expect(componentHost.layout.setBounds).not.toHaveBeenCalled();
  });

  it('opens only while active and unoccluded, and parks on overlays, hidden documents, or lost focus', async () => {
    const { host, calls } = makeHost();
    const fakeWindow = fakeBrowserWindow();
    const currentRect = rect(12, 34, 480, 360);
    const element = document.createElement('div');
    element.getBoundingClientRect = () => currentRect;
    const controller = createProviderWebTabController({
      provider: 'chatgpt',
      host,
      window: fakeWindow.browserWindow,
      document,
      ResizeObserver: TestResizeObserver,
      getCurrentWindow: async () => createFocusApi(),
    });

    controller.setState({ active: true, overlayCount: 0 });
    controller.start(element);
    await controller.whenIdle();
    expect(calls.slice(0, 2)).toEqual(['open', 'show']);

    controller.setState({ active: true, overlayCount: 1 });
    await controller.whenIdle();
    expect(calls[calls.length - 1]).toBe('park');

    controller.setState({ active: true, overlayCount: 0 });
    await controller.whenIdle();
    expect(calls.slice(-2)).toEqual(['open', 'show']);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await controller.whenIdle();
    expect(calls[calls.length - 1]).toBe('park');

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await controller.whenIdle();
    expect(calls.slice(-2)).toEqual(['open', 'show']);

    focusHandler?.({ payload: false });
    await controller.whenIdle();
    expect(calls[calls.length - 1]).toBe('park');

    focusHandler?.({ payload: true });
    await controller.whenIdle();
    expect(calls.slice(-2)).toEqual(['open', 'show']);

    controller.setState({ active: false, overlayCount: 0 });
    await controller.whenIdle();
    expect(calls[calls.length - 1]).toBe('park');

    controller.dispose();
    await controller.whenIdle();
    expect(calls[calls.length - 1]).toBe('park');
    expect(host.provider.park).toHaveBeenCalledWith('chatgpt', HIDDEN_PROVIDER_LOAD_BOUNDS);
  });

  it('lets the newest park intent win when an earlier open resolves late', async () => {
    const { host, calls } = makeHost();
    const opener: { resolve: (() => void) | null } = { resolve: null };
    host.provider.open = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          calls.push('open-start');
          opener.resolve = () => {
            calls.push('open-resolved');
            resolve({});
          };
        }),
    );
    const fakeWindow = fakeBrowserWindow();
    const element = document.createElement('div');
    element.getBoundingClientRect = () => rect(0, 0, 320, 240);
    const controller = createProviderWebTabController({
      provider: 'claude',
      host,
      window: fakeWindow.browserWindow,
      document,
      getCurrentWindow: async () => createFocusApi(),
    });

    controller.setState({ active: true, overlayCount: 0 });
    controller.start(element);
    await settleMicrotasks();
    expect(vi.mocked(host.provider.open)).toHaveBeenCalledTimes(1);

    controller.setState({ active: false, overlayCount: 0 });
    opener.resolve?.();
    await controller.whenIdle();

    expect(calls).toContain('open-start');
    expect(calls).toContain('open-resolved');
    expect(host.provider.show).not.toHaveBeenCalled();
    expect(calls[calls.length - 1]).toBe('park');

    controller.dispose();
    await controller.whenIdle();
  });

  it('does not call native commands when the injected host is not desktop', async () => {
    const { host } = makeHost(false);
    const fakeWindow = fakeBrowserWindow();
    const element = document.createElement('div');
    element.getBoundingClientRect = () => rect(0, 0, 320, 240);
    const controller = createProviderWebTabController({
      provider: 'gemini',
      host,
      window: fakeWindow.browserWindow,
      document,
    });

    controller.start(element);
    controller.setState({ active: true, overlayCount: 0 });
    await controller.whenIdle();
    controller.dispose();
    await controller.whenIdle();

    expect(host.provider.open).not.toHaveBeenCalled();
    expect(host.provider.show).not.toHaveBeenCalled();
    expect(host.provider.park).not.toHaveBeenCalled();
    expect(host.layout.setBounds).not.toHaveBeenCalled();
  });

  it('updates bounds after scroll and DPR changes while deduplicating repeated rectangles', async () => {
    const { host } = makeHost();
    const fakeWindow = fakeBrowserWindow();
    let currentRect = rect(5, 6, 300, 240);
    const element = document.createElement('div');
    element.getBoundingClientRect = () => currentRect;
    const controller = createProviderWebTabController({
      provider: 'gemini',
      host,
      window: fakeWindow.browserWindow,
      document,
      getCurrentWindow: async () => createFocusApi(),
    });

    controller.setState({ active: true, overlayCount: 0 });
    controller.start(element);
    await controller.whenIdle();

    fakeWindow.flushFrames();
    await controller.whenIdle();
    const initialCalls = vi.mocked(host.layout.setBounds).mock.calls.length;

    currentRect = rect(15, 16, 300, 240);
    document.dispatchEvent(new Event('scroll'));
    fakeWindow.flushFrames();
    await controller.whenIdle();
    expect(host.layout.setBounds).toHaveBeenCalledTimes(initialCalls + 1);
    expect(host.layout.setBounds).toHaveBeenLastCalledWith('gemini', currentRect);

    document.dispatchEvent(new Event('scroll'));
    fakeWindow.flushFrames();
    await controller.whenIdle();
    expect(host.layout.setBounds).toHaveBeenCalledTimes(initialCalls + 1);

    fakeWindow.changeDpr(2);
    fakeWindow.flushFrames();
    await controller.whenIdle();
    expect(host.layout.setBounds).toHaveBeenCalledTimes(initialCalls + 2);
    expect(host.layout.setBounds).toHaveBeenLastCalledWith('gemini', currentRect);

    controller.dispose();
    await controller.whenIdle();
  });
});
