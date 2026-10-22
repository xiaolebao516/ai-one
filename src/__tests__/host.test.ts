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
  });
});
