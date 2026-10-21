import { useEffect, useState } from 'react';
import { AI_PROVIDERS } from '../../shared/constants';
import type { AIProvider } from '../../shared/types';
import type { Locale } from '../i18n/resolve';
import { formatI18n, t } from '../i18n/t';
import type { StepRecoveryDetail, StepRecoveryFailureKind, StepTimeoutAction } from '../workflow/stepTimeout';
import { chooseTimeoutDialogAction } from './timeoutActions';

export interface StepTimeoutDialogState {
  provider: string;
  remainingMs: number;
  timedOut: boolean;
  requestId?: number;
  failureKind?: StepRecoveryFailureKind;
  recoveryDetail?: StepRecoveryDetail;
  skipAllowed?: boolean;
}

/** In-context recovery card: keeps the underlying WebView visible to inspect before a retry. */
export function StepTimeoutDialog({ event, onClose, locale }: {
  event: StepTimeoutDialogState;
  onClose: () => void;
  locale: Locale;
}) {
  const [remainingMs, setRemainingMs] = useState(event.remainingMs);
  useEffect(() => {
    if (event.timedOut) return;
    const startedAt = Date.now();
    setRemainingMs(event.remainingMs);
    const timer = window.setInterval(() => {
      setRemainingMs(Math.max(0, event.remainingMs - (Date.now() - startedAt)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [event.provider, event.remainingMs, event.timedOut]);

  if (!event.timedOut) {
    return (
      <div className="mt-2 border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
        {formatI18n(t('stepTimeout.waiting', locale), { provider: event.provider, seconds: Math.ceil(remainingMs / 1000) })}
      </div>
    );
  }

  const choose = (action: StepTimeoutAction) => {
    chooseTimeoutDialogAction(action, onClose, event.requestId);
  };
  const isProviderError = event.failureKind === 'provider-error';
  const isPageReloaded = isProviderError && event.recoveryDetail === 'provider-page-reloaded';
  const titleKey = isProviderError ? 'stepTimeout.providerErrorTitle' : 'stepTimeout.title';
  const descriptionKey = isPageReloaded
    ? 'workflow.providerPageReloaded'
    : isProviderError ? 'stepTimeout.providerErrorDescription' : 'stepTimeout.description';
  const providerLabel = isPageReloaded && event.provider in AI_PROVIDERS
    ? AI_PROVIDERS[event.provider as AIProvider].name : event.provider;

  return (
    <section
      className="ai-sister-step-recovery mb-2 rounded-xl border border-amber-300/80 bg-amber-50/80 p-3 shadow-sm dark:border-amber-800 dark:bg-amber-950/35"
      aria-labelledby="step-recovery-title"
      aria-describedby="step-recovery-description"
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-900/75 dark:text-amber-200" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.3 3.8 2.4 17.5a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="step-recovery-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t(titleKey, locale)}
          </h3>
          <p id="step-recovery-description" className="mt-0.5 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
            {formatI18n(t(descriptionKey, locale), { provider: providerLabel })}
          </p>
          <p className="mt-1 text-[0.6875rem] font-medium text-amber-800 dark:text-amber-200">
            {t('stepTimeout.recoveryState', locale)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white" onClick={() => choose('retry')}>
          {t('stepTimeout.retry', locale)}
        </button>
        {event.skipAllowed !== false && (
          <button type="button" className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900" onClick={() => choose('skip')}>
            {t('stepTimeout.skip', locale)}
          </button>
        )}
        <button type="button" className="rounded-lg px-2 py-1.5 text-xs text-zinc-600 hover:bg-amber-100 dark:text-zinc-300 dark:hover:bg-amber-900/50" onClick={() => choose('cancel')}>
          {t('stepTimeout.cancel', locale)}
        </button>
      </div>
      <p className="mt-2 border-t border-amber-200/70 pt-2 text-[0.6875rem] leading-relaxed text-zinc-600 dark:border-amber-800/80 dark:text-zinc-400">
        {formatI18n(t('stepTimeout.retryResendWarning', locale), { provider: providerLabel })}
      </p>
    </section>
  );
}
