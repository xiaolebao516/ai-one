import type { FlowDef, FlowsFile, StageDef } from '../../stages/flowModel';
import type { StageSelection } from '../../stages/flowEditor';
import type { Locale } from '../../i18n/resolve';
import { Badge, Button, Card, Select, cx } from '../../ui/v2';
import type { FlowsText } from '../views/flowsText';

interface FlowSidebarProps {
  file: FlowsFile;
  locale: Locale;
  text: FlowsText;
  selectedFlowId: string;
  selection: StageSelection | null;
  disabled?: boolean;
  onSelectFlow: (flowId: string) => void;
  onSelectLibraryStage: (stageId: string) => void;
  onCreateFlow: () => void;
  onCreateStage: () => void;
}

function itemLabel(item: FlowDef | StageDef, locale: Locale): string {
  return locale.toLowerCase().startsWith('zh') ? item.name : item.nameEn ?? item.name;
}

export function FlowSidebar({
  file,
  locale,
  text,
  selectedFlowId,
  selection,
  disabled = false,
  onSelectFlow,
  onSelectLibraryStage,
  onCreateFlow,
  onCreateStage,
}: FlowSidebarProps) {
  return (
    <aside className="grid content-start gap-v2-md" aria-label={text.t('myFlows')}>
      <Button size="sm" disabled={disabled} onClick={onCreateFlow}>＋ {text.t('createFlow')}</Button>
      <section className="grid gap-v2-xs" aria-labelledby="flows-sidebar-flows">
        <h2 id="flows-sidebar-flows" className="px-v2-xs text-v2-micro font-semibold text-v2-ink-3">{text.t('myFlows')}</h2>
        <ul className="grid gap-1">
          {file.flows.map((flow) => (
            <li key={flow.id}>
              <button
                type="button"
                disabled={disabled}
                aria-current={selectedFlowId === flow.id ? 'page' : undefined}
                onClick={() => onSelectFlow(flow.id)}
                className={cx(
                  'flex min-h-8 w-full items-center justify-between gap-v2-xs rounded-v2-md px-v2-sm py-1.5 text-left text-v2-meta focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-primary',
                  selectedFlowId === flow.id ? 'bg-v2-surface font-semibold text-v2-ink shadow-v2-card' : 'text-v2-ink-2 hover:bg-v2-hover',
                )}
              >
                <span className="min-w-0 flex-1 break-words">{itemLabel(flow, locale)}</span>
                {flow.builtin ? <Badge>{text.t('builtin')}</Badge> : null}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-v2-xs" aria-labelledby="flows-sidebar-stages">
        <div className="flex items-center justify-between gap-v2-xs">
          <h2 id="flows-sidebar-stages" className="px-v2-xs text-v2-micro font-semibold text-v2-ink-3">{text.t('stageLibrary')}</h2>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={onCreateStage}>＋</Button>
        </div>
        {file.stages.length ? (
          <ul className="grid gap-1">
            {file.stages.map((stage) => {
              const active = selection?.kind === 'library' && selection.stageId === stage.id;
              return (
                <li key={stage.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onSelectLibraryStage(stage.id)}
                    className={cx(
                      'flex min-h-8 w-full items-center justify-between gap-v2-xs rounded-v2-md px-v2-sm py-1.5 text-left text-v2-meta focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-primary',
                      active ? 'bg-v2-surface font-semibold text-v2-ink shadow-v2-card' : 'text-v2-ink-2 hover:bg-v2-hover',
                    )}
                  >
                    <span className="min-w-0 flex-1 break-words">{itemLabel(stage, locale)}</span>
                    {stage.builtin ? <Badge>{text.t('builtin')}</Badge> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <Card padding="sm"><p className="text-v2-meta text-v2-ink-3">{text.t('noStages')}</p></Card>
        )}
      </section>
    </aside>
  );
}

interface CompactFlowSelectorsProps {
  file: FlowsFile;
  locale: Locale;
  text: FlowsText;
  selectedFlowId: string;
  selection: StageSelection | null;
  disabled?: boolean;
  onSelectFlow: (flowId: string) => void;
  onSelectLibraryStage: (stageId: string) => void;
  onCreateFlow: () => void;
  onCreateStage: () => void;
}

export function CompactFlowSelectors({
  file,
  locale,
  text,
  selectedFlowId,
  selection,
  disabled = false,
  onSelectFlow,
  onSelectLibraryStage,
  onCreateFlow,
  onCreateStage,
}: CompactFlowSelectorsProps) {
  const flowOptions = [
    { value: '', label: text.t('selectFlow'), disabled: true },
    ...file.flows.map((flow) => ({
      value: flow.id,
      label: itemLabel(flow, locale) + (flow.builtin ? ' · ' + text.t('builtin') : ''),
    })),
  ];
  const stageOptions = [
    { value: '', label: text.t('selectStage'), disabled: true },
    ...file.stages.map((stage) => ({
      value: stage.id,
      label: itemLabel(stage, locale) + (stage.builtin ? ' · ' + text.t('builtin') : ''),
    })),
  ];
  const librarySelection = selection?.kind === 'library' ? selection.stageId : '';
  return (
    <div className="grid gap-v2-sm min-[1100px]:hidden">
      <div className="flex flex-wrap gap-v2-sm">
        <Button size="sm" disabled={disabled} onClick={onCreateFlow}>＋ {text.t('createFlow')}</Button>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={onCreateStage}>＋ {text.t('createStage')}</Button>
      </div>
      <div className="grid grid-cols-1 gap-v2-sm min-[700px]:grid-cols-2">
        <Select id="flows-compact-flow" label={text.t('myFlows')} options={flowOptions} value={selectedFlowId} onChange={onSelectFlow} disabled={disabled} className="w-full" />
        <Select id="flows-compact-stage" label={text.t('stageLibrary')} options={stageOptions} value={librarySelection} onChange={onSelectLibraryStage} disabled={disabled} className="w-full" />
      </div>
    </div>
  );
}
