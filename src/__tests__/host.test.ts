import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

import { host, parseProviderStopResult } from '../host';

describe('host snapshot bindings', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it('wraps snapshot commands with Tauri invoke argument names', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await host.snapshot.save('snap-1.ok', '{"ok":true}');
    expect(invokeMock).toHaveBeenLastCalledWith('snapshot_save', {
      snapshotId: 'snap-1.ok',
      snapshotJson: '{"ok":true}',
    });

    invokeMock.mockResolvedValueOnce([{ id: 'snap-1.ok', graphId: 'debate' }]);
    await expect(host.snapshot.list()).resolves.toEqual([{ id: 'snap-1.ok', graphId: 'debate' }]);
    expect(invokeMock).toHaveBeenLastCalledWith('snapshot_list');

    invokeMock.mockResolvedValueOnce('{"ok":true}');
    await expect(host.snapshot.load('snap-1.ok')).resolves.toBe('{"ok":true}');
    expect(invokeMock).toHaveBeenLastCalledWith('snapshot_load', { snapshotId: 'snap-1.ok' });

    invokeMock.mockResolvedValueOnce(undefined);
    await host.snapshot.delete('snap-1.ok');
    expect(invokeMock).toHaveBeenLastCalledWith('snapshot_delete', { snapshotId: 'snap-1.ok' });
  });

  it('rejects unsafe snapshot ids before invoke', async () => {
    await expect(host.snapshot.load('../secret')).rejects.toThrow('Invalid snapshot id');
    await expect(host.snapshot.delete('/tmp/secret')).rejects.toThrow('Invalid snapshot id');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('wraps session checkpoint commands with Tauri invoke argument names', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await host.sessionCheckpoint.save('{"graphId":"free"}');
    expect(invokeMock).toHaveBeenLastCalledWith('session_checkpoint_save', {
      json: '{"graphId":"free"}',
    });

    invokeMock.mockResolvedValueOnce('{"graphId":"free"}');
    await expect(host.sessionCheckpoint.load()).resolves.toBe('{"graphId":"free"}');
    expect(invokeMock).toHaveBeenLastCalledWith('session_checkpoint_load');

    invokeMock.mockResolvedValueOnce(undefined);
    await host.sessionCheckpoint.clear();
    expect(invokeMock).toHaveBeenLastCalledWith('session_checkpoint_clear');
  });

  it('wraps provider draft fill as an outbound FILL_DRAFT eval', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await host.provider.fill('grok', 'draft text');

    expect(invokeMock).toHaveBeenLastCalledWith('provider_eval', {
      provider: 'grok',
      js: `window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch(${JSON.stringify({
        v: 1,
        action: 'FILL_DRAFT',
        provider: 'grok',
        payload: { text: 'draft text' },
      })});`,
    });
    expect(String(invokeMock.mock.calls.at(-1)?.[1]?.js)).not.toContain('SEND_MESSAGE');
  });

  it('routes extra instance keys to native while dispatching the base provider to the page engine', async () => {
    invokeMock.mockResolvedValue(undefined);
    const bounds = { x: 0, y: 0, width: 420, height: 320 } as DOMRectReadOnly;
    await host.provider.open('chatgpt#2', bounds);
    expect(invokeMock).toHaveBeenLastCalledWith('provider_open', {
      provider: 'chatgpt#2',
      bounds: { x: 0, y: 0, width: 420, height: 320 },
    });
    await host.provider.send('chatgpt#2', 'hello');
    expect(invokeMock).toHaveBeenLastCalledWith('provider_eval', {
      provider: 'chatgpt#2',
      js: `window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch(${JSON.stringify({
        v: 1, action: 'SEND_MESSAGE', provider: 'chatgpt', payload: { text: 'hello' },
      })});`,
    });
    await host.provider.fill('chatgpt#3', 'draft');
    expect(invokeMock).toHaveBeenLastCalledWith('provider_eval', {
      provider: 'chatgpt#3',
      js: `window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch(${JSON.stringify({
        v: 1, action: 'FILL_DRAFT', provider: 'chatgpt', payload: { text: 'draft' },
      })});`,
    });
  });

  it('isolates failed stop latches between provider instances', async () => {
    invokeMock.mockRejectedValueOnce(new Error('stop timed out'));
    await expect(host.provider.stop('chatgpt#2')).rejects.toThrow('stop timed out');
    await expect(host.provider.send('chatgpt#2', 'unsafe')).rejects.toThrow('reload provider page');
    invokeMock.mockResolvedValueOnce(undefined);
    await expect(host.provider.send('chatgpt#3', 'safe')).resolves.toBeUndefined();
    invokeMock.mockResolvedValueOnce(undefined);
    await host.provider.reload('chatgpt#2');
    invokeMock.mockResolvedValueOnce(undefined);
    await expect(host.provider.send('chatgpt#2', 'recovered')).resolves.toBeUndefined();
  });

  it('starts a fresh provider conversation through the dedicated host command', async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await host.provider.newSession('chatgpt');

    expect(invokeMock).toHaveBeenLastCalledWith('provider_new_session', { provider: 'chatgpt' });
  });

  it('requests the guarded reconnect mode without exposing a new provider command', async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await host.provider.reconnect('grok');

    expect(invokeMock).toHaveBeenLastCalledWith('provider_reload', {
      provider: 'grok',
      reconnect: true,
    });
  });

  it('stops provider automation through the semantic engine command and returns what the page did', async () => {
    invokeMock.mockResolvedValueOnce(JSON.stringify({ found: true, clicked: true, generating: true }));

    await expect(host.provider.stop('chatgpt')).resolves.toEqual({ outcome: 'clicked', generating: true });

    expect(invokeMock).toHaveBeenLastCalledWith('provider_eval_with_callback', {
      provider: 'chatgpt',
      js: "window.__MAC_ENGINE__ && typeof window.__MAC_ENGINE__.stop === 'function' ? window.__MAC_ENGINE__.stop() : null",
    });
  });

  it.each([
    ['a missing stop control', { found: false, clicked: false, generating: true }, { outcome: 'not-found', generating: true }],
    ['a click error', { found: true, clicked: false, generating: false, error: 'click blocked' }, { outcome: 'error', generating: false, detail: 'click blocked' }],
    ['a skipped stop', { found: false, clicked: false, generating: false, skipped: 'challenge' }, { outcome: 'skipped', generating: false, detail: 'challenge' }],
  ])('maps %s to a non-clicked stop outcome', (_label, page, expected) => {
    expect(parseProviderStopResult(JSON.stringify(page))).toEqual(expected);
  });

  it('treats a page without the engine or an unreadable result as an unconfirmed stop', () => {
    expect(parseProviderStopResult('null')).toEqual({ outcome: 'unavailable', detail: 'page engine not loaded' });
    expect(parseProviderStopResult('false')).toEqual({ outcome: 'unavailable', detail: 'page engine not loaded' });
    expect(parseProviderStopResult('not json')).toEqual({ outcome: 'error', detail: 'unreadable stop result' });
    expect(parseProviderStopResult(JSON.stringify(JSON.stringify({ clicked: true })))).toEqual({ outcome: 'clicked', generating: false });
  });

  it('blocks sending after an unclicked stop until the provider reloads', async () => {
    invokeMock.mockResolvedValueOnce(JSON.stringify({ found: false, clicked: false, generating: false }));
    await expect(host.provider.stop('gemini')).resolves.toEqual({ outcome: 'not-found', generating: false });
    invokeMock.mockClear();
    await expect(host.provider.send('gemini', 'must not send')).rejects.toThrow('reload provider page');
    expect(invokeMock).not.toHaveBeenCalled();

    invokeMock.mockResolvedValueOnce(undefined);
    await host.provider.reload('gemini');
    invokeMock.mockResolvedValueOnce(undefined);
    await expect(host.provider.send('gemini', 'after reload')).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenLastCalledWith('provider_eval', expect.objectContaining({ provider: 'gemini' }));
  });

  it('blocks sending after a stop callback failure, including when reload fails', async () => {
    invokeMock.mockRejectedValueOnce(new Error('callback timed out'));
    await expect(host.provider.stop('chatgpt')).rejects.toThrow('callback timed out');
    await expect(host.provider.send('chatgpt', 'unsafe')).rejects.toThrow('reload provider page');
    invokeMock.mockRejectedValueOnce(new Error('reload failed'));
    await expect(host.provider.reload('chatgpt')).rejects.toThrow('reload failed');
    await expect(host.provider.send('chatgpt', 'still unsafe')).rejects.toThrow('reload provider page');

    invokeMock.mockResolvedValueOnce(undefined);
    await host.provider.reload('chatgpt');
    invokeMock.mockResolvedValueOnce(undefined);
    await expect(host.provider.send('chatgpt', 'new page')).resolves.toBeUndefined();
  });

  it('shows providers without stealing popup focus unless explicitly requested', async () => {
    invokeMock.mockResolvedValue(undefined);

    await host.provider.show('claude');
    expect(invokeMock).toHaveBeenLastCalledWith('provider_show', { provider: 'claude', focus: false });

    await host.provider.show('claude', true);
    expect(invokeMock).toHaveBeenLastCalledWith('provider_show', { provider: 'claude', focus: true });
  });

  it.each(['chatgpt', 'claude', 'gemini', 'grok'] as const)('parks %s offscreen without stealing focus', async (provider) => {
    invokeMock.mockResolvedValue(undefined);
    const bounds = { x: -10_000, y: -10_000, width: 420, height: 320 } as DOMRectReadOnly;

    await host.provider.park(provider, bounds);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'provider_set_bounds', {
      provider,
      bounds: { x: -10_000, y: -10_000, width: 420, height: 320 },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'provider_show', { provider, focus: false });
  });

  it('subscribes to nav-blocked diagnostics and forwards the host-only payload', async () => {
    const unlisten = vi.fn();
    const handler = vi.fn();
    listenMock.mockResolvedValueOnce(unlisten);

    await expect(host.onNavBlocked(handler)).resolves.toBe(unlisten);

    expect(listenMock).toHaveBeenCalledWith('nav://blocked', expect.any(Function));
    const listener = listenMock.mock.calls[0][1] as (event: { payload: { provider: string; host: string } }) => void;
    listener({ payload: { provider: 'chatgpt', host: 'auth.openai.com' } });

    expect(handler).toHaveBeenCalledWith({ provider: 'chatgpt', host: 'auth.openai.com' });
  });
});

describe('host read-only GitHub bindings (#51)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('passes the path / repo and numbers to the read-only commands', async () => {
    const path = 'repos/xiaolebao516/ai-one/issues?state=open&sort=created&direction=desc&per_page=10&page=1';
    invokeMock.mockResolvedValueOnce([{ number: 1 }]);
    await expect(host.github.get(path)).resolves.toEqual([{ number: 1 }]);
    expect(invokeMock).toHaveBeenLastCalledWith('github_readonly_get', { path });

    invokeMock.mockResolvedValueOnce({ data: {} });
    await expect(host.github.associations('xiaolebao516/ai-one', [38, 19])).resolves.toEqual({ data: {} });
    expect(invokeMock).toHaveBeenLastCalledWith('github_readonly_associations', { repo: 'xiaolebao516/ai-one', numbers: [38, 19] });
  });

  it('rejects with Error objects carrying the command message, as collectSnapshot expects', async () => {
    invokeMock.mockRejectedValueOnce('Request not allowed.');
    await expect(host.github.get('user')).rejects.toThrow(new Error('Request not allowed.'));
    invokeMock.mockRejectedValueOnce({ unexpected: true });
    await expect(host.github.associations('o/r', [1])).rejects.toThrow(/^GitHub query failed/);
    // Anything outside the fixed message set (e.g. text echoed from elsewhere) is normalised.
    invokeMock.mockRejectedValueOnce('fatal: token ghp_secret for account someone');
    await expect(host.github.get('user')).rejects.toThrow(/^GitHub query failed/);
    invokeMock.mockRejectedValueOnce('command is only available to the main control webview');
    await expect(host.github.get('user')).rejects.toThrow(/^GitHub query failed/);
    invokeMock.mockRejectedValueOnce('gh query timed out; snapshot is incomplete.');
    await expect(host.github.get('user')).rejects.toThrow(new Error('gh query timed out; snapshot is incomplete.'));
  });
});

describe('host connection states with provider instances (#143)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  const state = (provider: string) => ({ provider, webview: 'loaded', dom: 'ready', login: 'logged_in' });

  it('gives existing consumers only the first instance of each provider, and instance-aware code everything', async () => {
    const all = [state('chatgpt'), state('chatgpt#2'), state('claude')];
    invokeMock.mockResolvedValueOnce(all);
    await expect(host.connections.get()).resolves.toEqual([state('chatgpt'), state('claude')]);
    invokeMock.mockResolvedValueOnce(all);
    await expect(host.connections.getAll()).resolves.toEqual(all);
    expect(invokeMock).toHaveBeenLastCalledWith('connections_get');
  });

  it('forwards update events by the same rule', async () => {
    let emit!: (event: { payload: unknown }) => void;
    listenMock.mockImplementation(async (_name: string, handler: (event: { payload: unknown }) => void) => {
      emit = handler;
      return () => undefined;
    });
    const base = vi.fn();
    const everything = vi.fn();
    await host.connections.onUpdate(base);
    const baseEmit = emit;
    await host.connections.onUpdateAll(everything);
    const allEmit = emit;

    baseEmit({ payload: state('chatgpt') });
    baseEmit({ payload: state('chatgpt#2') });
    allEmit({ payload: state('chatgpt#2') });

    expect(base).toHaveBeenCalledTimes(1);
    expect(base).toHaveBeenCalledWith(state('chatgpt'));
    expect(everything).toHaveBeenCalledWith(state('chatgpt#2'));
  });
});

describe('host bridge title messages with provider instances (#143)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it('keeps the old subscription on first-instance messages and offers an instance-aware one', async () => {
    let emit!: (event: { payload: unknown }) => void;
    listenMock.mockImplementation(async (_name: string, handler: (event: { payload: unknown }) => void) => {
      emit = handler;
      return () => undefined;
    });
    const base = vi.fn();
    const all = vi.fn();
    await host.bridge.subscribeTitle(base);
    const baseEmit = emit;
    await host.bridge.subscribeTitleAll(all);
    const allEmit = emit;

    const message = (provider?: string) => ({ v: 1, action: 'STATUS', provider });
    baseEmit({ payload: message('chatgpt') });
    baseEmit({ payload: message('chatgpt#2') });
    baseEmit({ payload: message(undefined) });
    allEmit({ payload: message('chatgpt#2') });

    expect(base).toHaveBeenCalledTimes(2);
    expect(base).not.toHaveBeenCalledWith(message('chatgpt#2'));
    expect(all).toHaveBeenCalledWith(message('chatgpt#2'));
  });
});

describe('host send with outbox draining (#143)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  async function drainedScript(): Promise<string> {
    invokeMock.mockResolvedValue(JSON.stringify({ sent: true }));
    await host.provider.send('chatgpt#2', 'task B', { drainOutbox: true });
    const call = invokeMock.mock.calls.at(-1) as [string, { js: string }];
    expect(call[0]).toBe('provider_eval_with_callback');
    return call[1].js;
  }

  function runInPage(js: string, bridge: Record<string, unknown> | undefined) {
    return JSON.parse(String(new Function('window', 'return ' + js)({ __MAC_BRIDGE__: bridge }))) as { sent: boolean; reason?: string };
  }

  it('drains in rounds until a size-limited peek reports nothing left, then dispatches once', async () => {
    const js = await drainedScript();
    let outbox = Array.from({ length: 7 }, (_, index) => ({ mid: index + 1 })); // only 2 visible per peek
    const dispatched: { payload: { text: string }; provider: string }[] = [];
    const result = runInPage(js, {
      peekOutbox: () => outbox.slice(0, 2),
      ackBulk: (maxMid: number) => { outbox = outbox.filter((entry) => entry.mid > maxMid); },
      dispatch: (message: { payload: { text: string }; provider: string }) => { dispatched.push(message); },
    });
    expect(result).toEqual({ sent: true });
    expect(outbox).toEqual([]);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].payload.text).toBe('task B');
    expect(dispatched[0].provider).toBe('chatgpt');
  });

  it.each([
    ['ack throws', { peekOutbox: () => [{ mid: 1 }], ackBulk: () => { throw new Error('boom'); } }, /drain failed/],
    ['ack does not advance', { peekOutbox: () => [{ mid: 1 }], ackBulk: () => undefined }, /did not advance/],
    ['peek throws', { peekOutbox: () => { throw new Error('peek boom'); }, ackBulk: () => undefined }, /drain failed/],
  ])('never dispatches when the outbox cannot be drained (%s)', async (_name, partial, reason) => {
    const js = await drainedScript();
    const dispatch = vi.fn();
    const result = runInPage(js, { ...partial, dispatch });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(reason);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('never dispatches when the round cap is reached with entries still arriving', async () => {
    const js = await drainedScript();
    let next = 1;
    const dispatch = vi.fn();
    const result = runInPage(js, { peekOutbox: () => [{ mid: next++ }], ackBulk: () => undefined, dispatch });
    expect(result).toMatchObject({ sent: false });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('never dispatches without a page bridge, and the host rejects the send when the page says it did not send', async () => {
    const js = await drainedScript();
    expect(runInPage(js, undefined)).toEqual({ sent: false, reason: 'no bridge' });
    invokeMock.mockResolvedValue(JSON.stringify({ sent: false, reason: 'round cap reached' }));
    await expect(host.provider.send('chatgpt#2', 'x', { drainOutbox: true })).rejects.toThrow(/could not be drained \(round cap reached\)/);
    invokeMock.mockResolvedValue('not json');
    await expect(host.provider.send('chatgpt#2', 'x', { drainOutbox: true })).rejects.toThrow(/unreadable outbox drain result/);
    invokeMock.mockResolvedValue(undefined);
    await host.provider.reload('chatgpt#2'); // an unreadable result quarantines the page; clear it for the next tests
  });

  it('refuses to dispatch once its expiry has passed (the host stops waiting after 5 s and cannot recall a queued script)', async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const js = await drainedScript(); // generated at t0; expires 2.5 s later
      const dispatch = vi.fn();

      // 1. The page only gets to run the script after the expiry.
      now = 1_000_000 + 4_000;
      expect(runInPage(js, { peekOutbox: () => [], ackBulk: () => undefined, dispatch })).toEqual({ sent: false, reason: 'expired' });

      // 2. The expiry passes while the outbox is being drained.
      now = 1_000_000 + 100;
      let outbox = [{ mid: 1 }];
      const slow = runInPage(js, {
        peekOutbox: () => outbox,
        ackBulk: (maxMid: number) => { outbox = outbox.filter((entry) => entry.mid > maxMid); now = 1_000_000 + 4_000; },
        dispatch,
      });
      expect(slow).toEqual({ sent: false, reason: 'expired' });
      expect(dispatch).not.toHaveBeenCalled();

      // 3. Inside the window it still sends.
      now = 1_000_000 + 100;
      expect(runInPage(js, { peekOutbox: () => [], ackBulk: () => undefined, dispatch })).toEqual({ sent: true });
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it('quarantines the page when the callback result is unknown: no further send until it is reloaded', async () => {
    invokeMock.mockRejectedValueOnce(new Error('provider eval callback timed out'));
    await expect(host.provider.send('chatgpt#2', 'A', { drainOutbox: true })).rejects.toThrow(/drain result unknown/);

    // The first message may have been dispatched; the next send must not be allowed to collect its reply.
    invokeMock.mockResolvedValue(JSON.stringify({ sent: true }));
    const before = invokeMock.mock.calls.length;
    await expect(host.provider.send('chatgpt#2', 'B', { drainOutbox: true })).rejects.toThrow(/reload provider page/);
    await expect(host.provider.send('chatgpt#2', 'B', { drainOutbox: false })).rejects.toThrow(/reload provider page/);
    expect(invokeMock.mock.calls.length).toBe(before); // nothing was sent to the page

    // Other instances are unaffected, and an explicit reload clears the quarantine.
    await expect(host.provider.send('chatgpt#3', 'C', { drainOutbox: true })).resolves.toBeUndefined();
    await host.provider.reload('chatgpt#2');
    await expect(host.provider.send('chatgpt#2', 'D', { drainOutbox: true })).resolves.toBeUndefined();
  });

  it('treats an unreadable callback result as unknown too', async () => {
    invokeMock.mockResolvedValueOnce('not json');
    await expect(host.provider.send('chatgpt#3', 'A', { drainOutbox: true })).rejects.toThrow(/unreadable outbox drain result/);
    await expect(host.provider.send('chatgpt#3', 'B', { drainOutbox: true })).rejects.toThrow(/reload provider page/);
    invokeMock.mockResolvedValue(undefined);
    await host.provider.reload('chatgpt#3');
  });

  it('a successful stop does not release the unknown-send quarantine; only a reload does', async () => {
    invokeMock.mockRejectedValueOnce(new Error('provider eval callback timed out'));
    await expect(host.provider.send('chatgpt#2', 'A', { drainOutbox: true })).rejects.toThrow(/drain result unknown/);

    invokeMock.mockResolvedValueOnce(JSON.stringify({ found: true, clicked: true }));
    await expect(host.provider.stop('chatgpt#2')).resolves.toMatchObject({ outcome: 'clicked' });

    invokeMock.mockResolvedValue(JSON.stringify({ sent: true }));
    const before = invokeMock.mock.calls.length;
    await expect(host.provider.send('chatgpt#2', 'B', { drainOutbox: true })).rejects.toThrow(/reload provider page/);
    expect(invokeMock.mock.calls.length).toBe(before);

    invokeMock.mockResolvedValue(undefined);
    await host.provider.reload('chatgpt#2');
    invokeMock.mockResolvedValue(JSON.stringify({ sent: true }));
    await expect(host.provider.send('chatgpt#2', 'C', { drainOutbox: true })).resolves.toBeUndefined();
  });

  it.each([
    ['an empty object', '{}'],
    ['null', 'null'],
    ['a non-boolean sent', JSON.stringify({ sent: 'yes' })],
    ['a bare number', '42'],
  ])('treats %s as an unknown result: quarantine, not "not sent"', async (_name, raw) => {
    invokeMock.mockResolvedValueOnce(raw);
    await expect(host.provider.send('chatgpt#3', 'A', { drainOutbox: true })).rejects.toThrow(/malformed outbox drain result/);
    await expect(host.provider.send('chatgpt#3', 'B', { drainOutbox: true })).rejects.toThrow(/reload provider page/);
    invokeMock.mockResolvedValue(undefined);
    await host.provider.reload('chatgpt#3');
  });

  it('an explicit sent:false is the only result that does not quarantine', async () => {
    invokeMock.mockResolvedValueOnce(JSON.stringify({ sent: false, reason: 'expired' }));
    await expect(host.provider.send('chatgpt#3', 'A', { drainOutbox: true })).rejects.toThrow(/could not be drained \(expired\)/);
    invokeMock.mockResolvedValue(JSON.stringify({ sent: true }));
    await expect(host.provider.send('chatgpt#3', 'B', { drainOutbox: true })).resolves.toBeUndefined();
  });

  it('keeps the plain send unchanged when draining is not requested', async () => {
    invokeMock.mockResolvedValue(undefined);
    await host.provider.send('chatgpt#2', 'task C');
    const call = invokeMock.mock.calls.at(-1) as [string, { js: string }];
    expect(call[0]).toBe('provider_eval');
    expect(call[1].js).not.toContain('peekOutbox');
    expect(call[1].js).toContain('dispatch');
  });
});
