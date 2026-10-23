import type { LocalStoreFs } from '../../host/localStore';
import type { Locale } from '../../i18n/resolve';
import { Badge, Button, LoadingState, Notice } from '../../ui/v2';
import { FlowSecurityRules } from '../../stages/flows/FlowSecurityRules';
import { FlowWorkspace } from '../../stages/flows/FlowWorkspace';
import { useFlowsEditor } from '../../stages/useFlowsEditor';
import { flowsText } from './flowsText';

export interface FlowsViewProps {
  locale: Locale;
  /** Tests inject an in-memory LocalStoreFs; production resolves the Tauri/browser implementation. */
  fs?: LocalStoreFs;
}

export function FlowsView({ locale, fs }: FlowsViewProps) {
  const text = flowsText(locale);
  const editor = useFlowsEditor(locale, fs, text);

  return (
    <div className="mx-auto grid min-h-full max-w-[1800px] gap-v2-lg p-v2-page">
      <header className="grid gap-v2-sm">
        <div className="flex flex-wrap items-center gap-v2-sm">
          <h1 className="text-v2-heading font-semibold text-v2-ink">{text.t('pageTitle')}</h1>
          <Badge>{text.t('localFile')}</Badge>
          {editor.hasUnsaved ? <Badge tone="unknown">{text.t('dirty')}</Badge> : null}
        </div>
        <p className="max-w-3xl text-v2-body text-v2-ink-2">{text.t('intro')}</p>
        <Notice tone="neutral" title={text.t('howRunLabel')}>{text.t('howRuns')}</Notice>
      </header>

      {editor.loading ? <LoadingState label={text.t('loadingFlows')} /> : null}
      {editor.status === 'fresh' && !editor.hasUnsaved ? <Notice tone="neutral">{text.t('freshNotice')}</Notice> : null}
      {editor.status === 'recovered' ? (
        <Notice tone="unknown" title={text.t('recoveredTitle')}>
          {editor.backup ? text.t('recoveredBody', { name: editor.backup }) : text.t('recoveredNoBackup')}
        </Notice>
      ) : null}
      {editor.loadError ? (
        <Notice
          tone="block"
          title={text.t('loadErrorTitle')}
          actions={<Button size="sm" variant="secondary" onClick={() => void editor.reload()}>{text.t('retryLoad')}</Button>}
        >
          {text.t('loadErrorBody', { message: editor.loadError })}
        </Notice>
      ) : null}
      {editor.operationError ? <Notice tone="block" title={text.t('saveFailed')}>{editor.operationError}</Notice> : null}

      <FlowWorkspace editor={editor} locale={locale} text={text} fs={fs} />
      <FlowSecurityRules text={text} />
    </div>
  );
}
