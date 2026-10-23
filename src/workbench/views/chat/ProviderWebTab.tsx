import { AI_PROVIDERS } from '../../../../shared/constants';
import type { AIProvider } from '../../../../shared/types';
import { useI18n } from '../../../i18n/context';
import { workbenchText } from '../../workbenchText';

export interface ProviderWebTabProps {
  provider: AIProvider;
  active: boolean;
}

/** Placeholder only. The native provider webview and its bounds are owned by the next implementation stage. */
export function ProviderWebTab({ provider, active }: ProviderWebTabProps) {
  const { locale } = useI18n();
  const text = workbenchText(locale);
  return (
    <div
      aria-label={AI_PROVIDERS[provider].name}
      data-provider={provider}
      data-active={active}
      className="flex min-h-0 flex-1 items-center justify-center rounded-v2-lg border border-v2-line bg-v2-surface p-v2-card text-v2-body text-v2-ink-2"
    >
      {text.t('chatWebPlaceholder', { provider: AI_PROVIDERS[provider].name })}
    </div>
  );
}
