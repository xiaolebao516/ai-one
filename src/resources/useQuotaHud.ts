import { useCallback, useEffect, useRef, useState } from 'react';
import { host } from '../host';
import { parseQuotaHudReading } from './parse';
import type { QuotaHudReading } from './types';

export type QuotaHudLoader = () => Promise<unknown>;
export type QuotaHudStarter = () => Promise<unknown>;
export type QuotaHudReadState = 'unavailable' | 'loading' | 'ready' | 'error';

export interface QuotaHudData {
  state: QuotaHudReadState;
  reading?: QuotaHudReading;
  refresh: () => void;
  start: () => Promise<unknown>;
}

interface StoredResult {
  key: string;
  result: Omit<QuotaHudData, 'refresh' | 'start'>;
}

const readQuotaHud: QuotaHudLoader = () => host.quotaHud.read();
const startQuotaHud: QuotaHudStarter = () => host.quotaHud.start();
const UNAVAILABLE_READING: QuotaHudReading = {
  state: 'unavailable',
  heartbeatAgeSeconds: null,
  snapshot: null,
  readAt: null,
};

function isDesktop(): boolean {
  try {
    return host.app.isDesktop();
  } catch {
    return false;
  }
}

/** Polls the shared HUD snapshot only on desktop; old requests can never overwrite newer reads. */
export function useQuotaHud(options: {
  loader?: QuotaHudLoader;
  starter?: QuotaHudStarter;
  isDesktop?: boolean;
} = {}): QuotaHudData {
  const { loader = readQuotaHud, starter = startQuotaHud } = options;
  const desktop = options.isDesktop ?? isDesktop();
  const [refreshToken, setRefreshToken] = useState(0);
  const [stored, setStored] = useState<StoredResult>({ key: '', result: { state: 'loading' } });
  const requestRef = useRef(0);
  const key = JSON.stringify([desktop, refreshToken]);
  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  const start = useCallback(async (): Promise<unknown> => {
    if (!desktop) return undefined;
    try {
      return await starter();
    } finally {
      refresh();
    }
  }, [desktop, refresh, starter]);

  useEffect(() => {
    if (!desktop) {
      setStored({ key, result: { state: 'unavailable' } });
      return;
    }

    const readNow = (showLoading: boolean) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        if (showLoading) setStored({ key, result: { state: 'loading' } });
        return;
      }
      const request = ++requestRef.current;
      if (showLoading) setStored({ key, result: { state: 'loading' } });
      void Promise.resolve()
        .then(() => loader())
        .then((raw) => {
          if (request !== requestRef.current) return;
          setStored({ key, result: { state: 'ready', reading: parseQuotaHudReading(raw) } });
        })
        .catch(() => {
          if (request === requestRef.current) setStored({ key, result: { state: 'error' } });
        });
    };

    readNow(true);
    const interval = window.setInterval(() => readNow(false), 10_000);
    const onVisibilityChange = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') readNow(false);
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
      requestRef.current += 1;
    };
  }, [desktop, key, loader]);

  const current = !desktop
    ? { state: 'unavailable' as const, reading: UNAVAILABLE_READING }
    : stored.key === key
      ? stored.result
      : { state: 'loading' as const };

  return { ...current, refresh, start };
}
