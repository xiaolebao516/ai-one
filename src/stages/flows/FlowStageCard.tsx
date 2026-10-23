import { useState, type DragEvent, type KeyboardEvent } from 'react';
import type { StageDef } from '../flowModel';
import { Badge, Card, cx } from '../../ui/v2';
import type { FlowsText } from '../../workbench/views/flowsText';
import type { Locale } from '../../i18n/resolve';

interface FlowStageCardProps {
  stage: StageDef;
  index: number;
  locale: Locale;
  text: FlowsText;
  selected: boolean;
  invalid: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onMove: (from: number, to: number) => void;
}

function label(stage: StageDef, locale: Locale): string {
  return locale.toLowerCase().startsWith('zh') ? stage.name : stage.nameEn ?? stage.name;
}

function collaborationLabel(value: StageDef['collaboration'], text: FlowsText): string {
  const labels: Record<StageDef['collaboration'], string> = {
    solo: text.t('collabSolo'),
    discussion: text.t('collabDiscussion'),
    'author-review': text.t('collabAuthorReview'),
    parallel: text.t('collabParallel'),
  };
  return labels[value];
}

export function FlowStageCard({
  stage,
  index,
  locale,
  text,
  selected,
  invalid,
  readOnly,
  onSelect,
  onMove,
}: FlowStageCardProps) {
  const [dragging, setDragging] = useState(false);
  const name = label(stage, locale);
  const participants = stage.participants.map((participant) => {
    const model = participant.model ? ' · ' + participant.model : '';
    const fresh = participant.freshSession ? ' · ' + text.t('freshSession') : '';
    return participant.resource + model + ' · ' + participant.role + fresh;
  }).join(' / ');

  const startDrag = (event: DragEvent<HTMLButtonElement>) => {
    if (readOnly) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    setDragging(true);
  };

  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    if (readOnly) return;
    const from = Number(event.dataTransfer.getData('text/plain'));
    if (Number.isInteger(from) && from >= 0) onMove(from, index);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || readOnly) return;
    event.preventDefault();
    onMove(index, index + (event.key === 'ArrowUp' ? -1 : 1));
  };

  return (
    <Card
      as="article"
      accent={invalid ? 'block' : undefined}
      onDragOver={(event) => { if (!readOnly) event.preventDefault(); }}
      onDrop={drop}
      className={cx(
        'grid gap-v2-xs transition-opacity',
        selected ? 'border-2 border-v2-primary' : 'border border-v2-line',
        dragging ? 'opacity-50' : undefined,
      )}
      data-testid="flow-stage-card"
      data-stage-id={stage.id}
      aria-invalid={invalid || undefined}
    >
      <div className="flex min-w-0 items-start gap-v2-sm">
        <button
          type="button"
          draggable={!readOnly}
          disabled={readOnly}
          aria-label={text.t('dragHandle', { name })}
          title={text.t('dragHandle', { name })}
          onDragStart={startDrag}
          onDragEnd={() => setDragging(false)}
          onKeyDown={handleKeyDown}
          className="mt-0.5 inline-flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded-v2-sm text-v2-ink-3 hover:bg-v2-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-primary active:cursor-grabbing"
        >
          <span aria-hidden="true">⋮⋮</span>
        </button>
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? 'step' : undefined}
          className="min-w-0 flex-1 rounded-v2-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-primary"
        >
          <span className="flex flex-wrap items-center gap-v2-sm">
            <span className="text-v2-micro font-v2-mono text-v2-ink-3">{index + 1}</span>
            <span className="font-semibold text-v2-ink">{name}</span>
            {stage.builtin ? <Badge>{text.t('builtin')}</Badge> : null}
            {stage.command ? <Badge>/{stage.command}</Badge> : null}
          </span>
          <span className="mt-1 block text-v2-meta text-v2-ink-2">
            {collaborationLabel(stage.collaboration, text)} · {text.t('participantSummary', { n: stage.participants.length })}
          </span>
          <span className="mt-1 block break-words text-v2-meta text-v2-ink-3">
            {participants || text.t('participantSummaryEmpty')}
          </span>
          {stage.reworkLimit !== undefined ? (
            <span className="mt-1 block text-v2-meta text-v2-ink-3">{text.t('reworkLimit')}: {stage.reworkLimit}</span>
          ) : null}
        </button>
      </div>
    </Card>
  );
}
