// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskHud } from '../ui/TaskHud';

/**
 * Mounted keyboard tests for the HUD (#40). TaskHud.test.tsx renders static markup and can only
 * prove structure; the focus rules below (arrow keys across tabs, Esc back and close, focus back to
 * the opener) are browser behaviour and need a real DOM with real key events.
 */

interface Harness {
  container: HTMLElement;
  opener: HTMLButtonElement;
  onClose: ReturnType<typeof vi.fn>;
  unmount: () => Promise<void>;
}

const live: { root: Root; container: HTMLElement }[] = [];

beforeEach(() => {
  // React 18 only allows `act` on a concurrent (createRoot) tree when this flag is set.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const { root } of live.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
});

async function mount(ui?: ReactElement): Promise<Harness> {
  const opener = document.createElement('button');
  opener.type = 'button';
  opener.textContent = 'Tasks';
  document.body.append(opener);
  // The HUD remembers what had focus at first render and restores it on unmount.
  opener.focus();

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  live.push({ root, container });
  const onClose = vi.fn();
  await act(async () => root.render(ui ?? <TaskHud locale="en" onClose={onClose} />));
  return {
    container,
    opener,
    onClose,
    unmount: async () => {
      const index = live.findIndex((entry) => entry.root === root);
      if (index >= 0) live.splice(index, 1);
      await act(async () => root.unmount());
    },
  };
}

function key(target: Element | null, name: string): void {
  if (!target) throw new Error('No element to send the key to');
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
}

function find<T extends Element>(harness: Harness, selector: string): T {
  const element = harness.container.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

const tab = (harness: Harness, id: 'overview' | 'list') => find<HTMLButtonElement>(harness, `#task-hud-tabs-tab-${id}`);
const heading = (harness: Harness) => find<HTMLHeadingElement>(harness, 'h1');
const active = () => document.activeElement as HTMLElement | null;

describe('Task HUD keyboard navigation (mounted)', () => {
  it('moves focus to the view heading when the HUD opens', async () => {
    const harness = await mount();
    expect(active()).toBe(heading(harness));
    expect(active()?.textContent).toContain('4 tasks moving');
  });

  it('keeps focus on the activated tab so arrow keys switch views continuously', async () => {
    const harness = await mount();
    const overviewTab = tab(harness, 'overview');
    const listTab = tab(harness, 'list');

    await act(async () => overviewTab.focus());
    await act(async () => key(overviewTab, 'ArrowRight'));
    expect(listTab.getAttribute('aria-selected')).toBe('true');
    expect(active()).toBe(listTab);
    expect(heading(harness).textContent).toContain('Tasks');

    await act(async () => key(listTab, 'ArrowLeft'));
    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
    expect(active()).toBe(overviewTab);

    // The activated tab is also the tab stop, so Home / End / more arrows still work.
    await act(async () => key(overviewTab, 'ArrowRight'));
    expect(active()).toBe(listTab);
    await act(async () => key(listTab, 'Home'));
    expect(active()).toBe(overviewTab);
    await act(async () => key(overviewTab, 'End'));
    expect(active()).toBe(listTab);
    expect(tab(harness, 'list').getAttribute('aria-selected')).toBe('true');
  });

  it('opens a task from the list, goes back with Esc, then closes with Esc', async () => {
    const harness = await mount();

    await act(async () => key(tab(harness, 'overview'), 'ArrowRight'));
    expect(heading(harness).textContent).toContain('Tasks');

    const row = Array.from(harness.container.querySelectorAll<HTMLButtonElement>('ul button')).find((button) =>
      (button.textContent ?? '').includes('Merge strategy for offline edit conflicts'),
    );
    if (!row) throw new Error('Task row not found');
    await act(async () => row.focus());
    // jsdom does not run a <button>'s default Enter activation, so a real click stands in for it.
    await act(async () => row.click());
    expect(heading(harness).textContent).toContain('Merge strategy for offline edit conflicts');
    expect(active()).toBe(heading(harness));

    await act(async () => key(active(), 'Escape'));
    expect(harness.onClose).not.toHaveBeenCalled();
    expect(heading(harness).textContent).toContain('Tasks');
    expect(active()).toBe(heading(harness));

    await act(async () => key(active(), 'Escape'));
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the entry that opened the HUD when it unmounts', async () => {
    const harness = await mount();
    expect(active()).not.toBe(harness.opener);

    await harness.unmount();
    expect(active()).toBe(harness.opener);
  });
});
