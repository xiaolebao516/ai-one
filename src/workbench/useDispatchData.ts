import { useCallback, useEffect, useRef, useState } from 'react';
import { host } from '../host';
import { parseDispatchSnapshot } from '../dispatch/parse';
import type { DispatchSnapshot } from '../dispatch/types';
import { DEMO_DISPATCH } from './dispatchModel';
import type { WorkbenchSource } from './workbenchModel';

export type DispatchLoader = (repoPath: string) => Promise<unknown>;
export type DispatchReadState = 'demo' | 'no-path' | 'unavailable' | 'loading' | 'ready' | 'error';

export interface DispatchData {
  state: DispatchReadState;
  snapshot?: DispatchSnapshot;
  observedAt?: number;
  refresh: () => void;
}

interface StoredResult {
  key: string;
  result: Omit<DispatchData, 'refresh'>;
}

const readDispatch: DispatchLoader = (repoPath) => host.dispatch.snapshot(repoPath);

function immediateResult(source: WorkbenchSource, repoPath: string, desktop: boolean): Omit<DispatchData, 'refresh'> | undefined {
  if (source === 'demo') return { state: 'demo', snapshot: DEMO_DISPATCH };
  if (!repoPath.trim()) return { state: 'no-path' };
  if (!desktop) return { state: 'unavailable' };
  return undefined;
}

export function useDispatchData(options: {
  source: WorkbenchSource;
  repoPath: string;
  /** Must be a stable reference, like GitHubLoader. */
  loader?: DispatchLoader;
  isDesktop?: boolean;
}): DispatchData {
  const { source, repoPath, loader = readDispatch } = options;
  const desktop = options.isDesktop ?? host.app.isDesktop();
  const [refreshToken, setRefreshToken] = useState(0);
  const [stored, setStored] = useState<StoredResult>({ key: '', result: { state: 'loading' } });
  const requestRef = useRef(0);
  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);
  const key = JSON.stringify([source, repoPath, desktop, refreshToken]);

  useEffect(() => {
    const request = ++requestRef.current;
    const immediate = immediateResult(source, repoPath, desktop);
    if (immediate) {
      setStored({ key, result: immediate });
      return () => {
        if (requestRef.current === request) requestRef.current += 1;
      };
    }

    setStored({ key, result: { state: 'loading' } });
    void loader(repoPath)
      .then((raw) => {
        if (request !== requestRef.current) return;
        setStored({ key, result: { state: 'ready', snapshot: parseDispatchSnapshot(raw), observedAt: Date.now() } });
      })
      .catch(() => {
        if (request === requestRef.current) setStored({ key, result: { state: 'error' } });
      });

    return () => {
      if (requestRef.current === request) requestRef.current += 1;
    };
  }, [desktop, key, loader, repoPath, refreshToken, source]);

  const current = immediateResult(source, repoPath, desktop) ??
    (stored.key === key ? stored.result : { state: 'loading' as const });
  return { ...current, refresh };
}
