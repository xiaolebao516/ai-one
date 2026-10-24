import { useEffect, useRef } from 'react';
import type { AIProvider } from '../../shared/types';
import { host } from '../host';
import { globalOverlayGuard } from './overlayGuard';
import { hideUnlessRunPage } from '../workflow/chatLed/runPages';

export function useOverlayGuard(open: boolean, loadedProviders: AIProvider[]): void {
  const loadedProvidersRef = useRef(loadedProviders);
  const loadedProvidersKey = loadedProviders.join('|');
  loadedProvidersRef.current = loadedProviders;

  useEffect(() => {
    if (!open) return;
    globalOverlayGuard.open(loadedProvidersRef.current, {
      hide: hideUnlessRunPage,
      show: host.provider.show,
    });
    return () => {
      globalOverlayGuard.close(
        {
          hide: hideUnlessRunPage,
          show: host.provider.show,
        },
        loadedProvidersRef.current,
      );
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    globalOverlayGuard.reconcile(loadedProvidersRef.current, {
      hide: hideUnlessRunPage,
      show: host.provider.show,
    });
  }, [open, loadedProvidersKey]);
}
