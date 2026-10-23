// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NativeOverlayProvider, useNativeOverlayCount, useNativeOverlayGuard } from './nativeOverlay';

const roots: { root: Root; container: HTMLElement }[] = [];

function Guard({ open }: { open: boolean }) {
  useNativeOverlayGuard(open);
  return null;
}

function Count() {
  return <output data-testid="count">{useNativeOverlayCount()}</output>;
}

function view(open: boolean, secondOpen = false) {
  return (
    <NativeOverlayProvider>
      <Guard open={open} />
      <Guard open={secondOpen} />
      <Count />
    </NativeOverlayProvider>
  );
}

function conditionalView(showGuard: boolean) {
  return (
    <NativeOverlayProvider>
      {showGuard ? <Guard open /> : null}
      <Count />
    </NativeOverlayProvider>
  );
}

async function mount(open: boolean, secondOpen = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  await act(async () => root.render(view(open, secondOpen)));
  return { root, container };
}

async function mountConditional(showGuard: boolean) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  await act(async () => root.render(conditionalView(showGuard)));
  return { root, container };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const entry of roots.splice(0)) {
    await act(async () => entry.root.unmount());
  }
  document.body.innerHTML = '';
});

describe('native overlay guard', () => {
  it('counts open overlays and releases registrations when closed', async () => {
    const { root, container } = await mount(false);
    const count = () => container.querySelector('[data-testid="count"]')?.textContent;

    expect(count()).toBe('0');

    await act(async () => root.render(view(true)));
    expect(count()).toBe('1');

    await act(async () => root.render(view(true, true)));
    expect(count()).toBe('2');

    await act(async () => root.render(view(false, true)));
    expect(count()).toBe('1');

    await act(async () => root.render(view(false, false)));
    expect(count()).toBe('0');
  });

  it('releases an overlay registration when its owner unmounts', async () => {
    const { root, container } = await mountConditional(true);
    const count = () => container.querySelector('[data-testid="count"]')?.textContent;

    expect(count()).toBe('1');
    await act(async () => root.render(conditionalView(false)));
    expect(count()).toBe('0');
  });
});
