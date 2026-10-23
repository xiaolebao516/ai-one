// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('no tauri'))), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));

import { DEMO_DISPATCH } from '../workbench/dispatchModel';
import { useDispatchData, type DispatchData, type DispatchLoader } from '../workbench/useDispatchData';

const live: Root[] = [];
let current: DispatchData | undefined;

function Probe({ options }: { options: Parameters<typeof useDispatchData>[0] }) {
  current = useDispatchData(options);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function rawSnapshot(suffix: string): unknown {
  return {
    sessions: [{
      id: 'sess_20261023_100000_' + suffix,
      task_id: 'task_20261023_100000_' + suffix,
      status: 'running',
      created_at: '2026-10-23T10:00:00.000Z',
    }],
    receipts: [],
    slots: [],
  };
}

async function mount(options: Parameters<typeof useDispatchData>[0]) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  live.push(root);
  await act(async () => root.render(<Probe options={options} />));
  return {
    root,
    render: async (next: Parameters<typeof useDispatchData>[0]) => act(async () => root.render(<Probe options={next} />)),
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  current = undefined;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const root of live.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = '';
  current = undefined;
  vi.restoreAllMocks();
});

describe('useDispatchData', () => {
  it('returns fixed demo data without calling the loader', async () => {
    const loader = vi.fn<DispatchLoader>(() => Promise.resolve({}));
    await mount({ source: 'demo', repoPath: '', loader, isDesktop: true });
    expect(current?.state).toBe('demo');
    expect(current?.snapshot).toBe(DEMO_DISPATCH);
    expect(loader).not.toHaveBeenCalled();
  });

  it('reports a missing path and a browser preview without reading local metadata', async () => {
    const loader = vi.fn<DispatchLoader>(() => Promise.resolve({}));
    await mount({ source: 'github', repoPath: '', loader, isDesktop: true });
    expect(current?.state).toBe('no-path');
    await mount({ source: 'github', repoPath: 'C:\\work\\repo', loader, isDesktop: false });
    expect(current?.state).toBe('unavailable');
    expect(loader).not.toHaveBeenCalled();
  });

  it('parses a successful local read and records its observation time', async () => {
    const loader: DispatchLoader = async () => rawSnapshot('ready');
    await mount({ source: 'github', repoPath: 'C:\\work\\repo', loader, isDesktop: true });
    await flush();
    expect(current?.state).toBe('ready');
    expect(current?.snapshot?.events[0]?.taskId).toBe('task_20261023_100000_ready');
    expect(typeof current?.observedAt).toBe('number');
  });

  it('turns loader failures into error with no snapshot', async () => {
    const loader: DispatchLoader = async () => { throw new Error('offline'); };
    await mount({ source: 'github', repoPath: '/repo', loader, isDesktop: true });
    await flush();
    expect(current?.state).toBe('error');
    expect(current?.snapshot).toBeUndefined();
    expect(current?.observedAt).toBeUndefined();
  });

  it('clears the previous snapshot as soon as the path changes', async () => {
    const next = deferred<unknown>();
    const loader: DispatchLoader = (path) => path === '/first' ? Promise.resolve(rawSnapshot('first')) : next.promise;
    const mounted = await mount({ source: 'github', repoPath: '/first', loader, isDesktop: true });
    await flush();
    expect(current?.state).toBe('ready');
    expect(current?.snapshot?.events[0]?.taskId).toBe('task_20261023_100000_first');
    await mounted.render({ source: 'github', repoPath: '/second', loader, isDesktop: true });
    expect(current?.state).toBe('loading');
    expect(current?.snapshot).toBeUndefined();
    await act(async () => {
      next.resolve(rawSnapshot('second'));
      await next.promise;
    });
    expect(current?.state).toBe('ready');
    expect(current?.snapshot?.events[0]?.taskId).toBe('task_20261023_100000_second');
  });

  it('discards late results from a superseded path', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<unknown>>>();
    const loader: DispatchLoader = (path) => {
      const request = deferred<unknown>();
      pending.set(path, request);
      return request.promise;
    };
    const mounted = await mount({ source: 'github', repoPath: '/first', loader, isDesktop: true });
    await mounted.render({ source: 'github', repoPath: '/second', loader, isDesktop: true });
    await act(async () => {
      pending.get('/second')?.resolve(rawSnapshot('second'));
      await pending.get('/second')?.promise;
    });
    expect(current?.snapshot?.events[0]?.taskId).toBe('task_20261023_100000_second');
    await act(async () => {
      pending.get('/first')?.resolve(rawSnapshot('first'));
      await pending.get('/first')?.promise;
    });
    expect(current?.state).toBe('ready');
    expect(current?.snapshot?.events[0]?.taskId).toBe('task_20261023_100000_second');
  });

  it('clears the current snapshot and reloads on refresh', async () => {
    const calls: ReturnType<typeof deferred<unknown>>[] = [];
    const loader: DispatchLoader = () => {
      const request = deferred<unknown>();
      calls.push(request);
      return request.promise;
    };
    await mount({ source: 'github', repoPath: '/repo', loader, isDesktop: true });
    await act(async () => {
      calls[0].resolve(rawSnapshot('first'));
      await calls[0].promise;
    });
    expect(current?.state).toBe('ready');
    await act(async () => current?.refresh());
    expect(current?.state).toBe('loading');
    expect(current?.snapshot).toBeUndefined();
    expect(calls).toHaveLength(2);
    await act(async () => {
      calls[1].resolve(rawSnapshot('second'));
      await calls[1].promise;
    });
    expect(current?.snapshot?.events[0]?.taskId).toBe('task_20261023_100000_second');
  });
});
