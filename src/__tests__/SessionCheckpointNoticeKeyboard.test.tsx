// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionCheckpointNotice } from '../ui/SessionCheckpointNotice';
import type { StartupSessionCheckpointNotice } from '../ui/sessionCheckpointStartup';

/**
 * Mounted keyboard test for the migrated checkpoint notice (#42).
 *
 * The existing SessionCheckpointNotice.test.tsx renders static markup, so it can prove structure
 * but not focus order or activation. Task #42 asks for keyboard regression on the migrated area;
 * this mounts the real component in jsdom and drives it with real key events.
 *
 * jsdom does not run a <button>'s default Enter/Space activation, so — exactly like
 * TaskHudKeyboard.test.tsx — the browser's default activation is stood in for by click(), while
 * the keydown itself is dispatched for real. What this pins down is the part that actually breaks:
 * whether a single activation fires the callback exactly once, and whether the replay button is
 * genuinely out of reach while replaying or without a snapshot.
 */

const live: { root: Root }[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const { root } of live.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
});

function notice(withSnapshot = true): StartupSessionCheckpointNotice {
  return {
    checkpoint: {
      graphId: 'debate',
      graphVersion: 1,
      mode: 'debate',
      questionHash: 'hash-only',
      stepIndex: 2,
      startedAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:01:00.000Z',
    },
    ...(withSnapshot
      ? { replaySnapshot: { id: 'snapshot-debate', graphId: 'debate', createdAt: '2026-07-06T00:02:00.000Z' } }
      : {}),
  };
}

async function mount(options: { withSnapshot?: boolean; replaying?: boolean } = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  live.push({ root });

  const onDismiss = vi.fn();
  const onReplay = vi.fn();
  const ui: ReactElement = (
    <SessionCheckpointNotice
      notice={notice(options.withSnapshot ?? true)}
      replaying={options.replaying}
      onDismiss={onDismiss}
      onReplay={onReplay}
      locale="en"
    />
  );
  await act(async () => root.render(ui));

  const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
  const dismiss = () => {
    const button = buttons().at(-1);
    if (!button) throw new Error('dismiss button missing');
    return button;
  };
  const replay = () => {
    const button = buttons()[0];
    if (!button) throw new Error('replay button missing');
    return button;
  };
  return { container, buttons, dismiss, replay, onDismiss, onReplay };
}

/** Enter on a focused button: real key event, then the browser's default activation. */
async function pressEnter(button: HTMLButtonElement): Promise<void> {
  await act(async () => button.focus());
  await act(async () => {
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    if (!button.disabled) button.click();
  });
}

/** Space on a focused button: browsers activate on keyup. */
async function pressSpace(button: HTMLButtonElement): Promise<void> {
  await act(async () => button.focus());
  await act(async () => {
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    button.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
    if (!button.disabled) button.click();
  });
}

describe('SessionCheckpointNotice keyboard (mounted)', () => {
  it('keeps both actions in the tab order, replay first', async () => {
    const harness = await mount();
    const [first, second] = harness.buttons();
    expect(harness.buttons()).toHaveLength(2);
    expect(first).toBe(harness.replay());
    expect(second).toBe(harness.dismiss());
    for (const button of harness.buttons()) {
      expect(button.disabled).toBe(false);
      expect(button.getAttribute('tabindex')).not.toBe('-1');
      expect(button.getAttribute('type')).toBe('button');
    }
  });

  it('fires replay once on Enter and dismiss once on Space', async () => {
    const harness = await mount();
    await pressEnter(harness.replay());
    expect(harness.onReplay).toHaveBeenCalledTimes(1);
    await pressSpace(harness.dismiss());
    expect(harness.onDismiss).toHaveBeenCalledTimes(1);
    // One activation per key press: no duplicate handler wiring.
    expect(harness.onReplay).toHaveBeenCalledTimes(1);
  });

  it('takes the replay button out of reach while replaying', async () => {
    const harness = await mount({ replaying: true });
    const replay = harness.replay();
    expect(replay.disabled).toBe(true);
    expect(replay.getAttribute('aria-busy')).toBe('true');
    await pressEnter(replay);
    await pressSpace(replay);
    expect(harness.onReplay).not.toHaveBeenCalled();
    // Dismiss stays usable while a replay is running.
    await pressEnter(harness.dismiss());
    expect(harness.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders no replay action when there is no replay snapshot', async () => {
    const harness = await mount({ withSnapshot: false });
    expect(harness.buttons()).toHaveLength(1);
    await pressEnter(harness.dismiss());
    expect(harness.onDismiss).toHaveBeenCalledTimes(1);
  });
});
