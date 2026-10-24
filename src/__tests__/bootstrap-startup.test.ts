// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://claude.ai/"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeTitleFrame } from '../../injected/codec';

describe('provider startup handshake', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    document.head.innerHTML = '<title>Claude</title>';
    document.body.innerHTML = '<div class="ProseMirror" contenteditable="true"></div>';
    window.__MAC_PROVIDER__ = 'claude';
    window.__MAC_APP_HOSTS__ = ['claude.ai'];
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete window.__MAC_BRIDGE__;
    delete window.__MAC_PROVIDER__;
    delete window.__MAC_APP_HOSTS__;
  });

  async function start() {
    const titles = vi.spyOn(document, 'title', 'set');
    await import('../../injected/bootstrap');
    await vi.advanceTimersByTimeAsync(50);
    return () => titles.mock.calls.flatMap(([title]) => {
      const frame = decodeTitleFrame(title);
      return frame ? [frame] : [];
    });
  }

  it('recovers a lost first frame with the same boot and increasing sequence, then stops on engine attachment', async () => {
    const frames = await start();
    // The first native title event can arrive before the new WebView is registered.
    const first = frames()[0];
    expect(first).toBeDefined();
    await vi.advanceTimersByTimeAsync(3000);
    const retried = frames();
    expect(retried.length).toBeGreaterThan(1);
    expect(retried.every((frame) => frame.bootId === first.bootId)).toBe(true);
    expect(retried.map((frame) => frame.seq)).toEqual([...new Set(retried.map((frame) => frame.seq))].sort((a, b) => a - b));
    expect(retried.at(-1)?.json).toMatchObject({ action: 'STATUS_REPORT', payload: { dom: 'unknown' } });

    const check = { v: 1 as const, action: 'CHECK_STATUS' as const, provider: 'claude' as const };
    window.__MAC_BRIDGE__!.dispatch(check);
    const handler = vi.fn();
    window.__MAC_BRIDGE__!.onDispatch(handler);
    const count = frames().length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(frames()).toHaveLength(count);
    expect(handler).toHaveBeenCalledExactlyOnceWith(check);
  });

  it('keeps retries passive while a challenge is present and resumes after it clears', async () => {
    const frames = await start();
    document.body.innerHTML = '<div id="challenge-running">Checking your browser</div>';
    const count = frames().length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(frames()).toHaveLength(count);
    document.body.innerHTML = '<div class="ProseMirror" contenteditable="true"></div>';
    await vi.advanceTimersByTimeAsync(1500);
    expect(frames().length).toBeGreaterThan(count);
  });

  it('does not emit startup frames on an unlisted host', async () => {
    window.__MAC_APP_HOSTS__ = ['auth.example.com'];
    const frames = await start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(window.__MAC_BRIDGE__).toBeUndefined();
    expect(frames()).toEqual([]);
  });
});
