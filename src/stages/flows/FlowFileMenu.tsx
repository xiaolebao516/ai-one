import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { getLocalStoreFs, type LocalStoreFs } from '../../host/localStore';
import {
  buildExport,
  parseFlowsFile,
  planImport,
  type FlowsFile,
  type ImportPlan,
} from '../flowModel';
import type { ImportResolution } from '../flowEditor';
import { Button, Card, Notice } from '../../ui/v2';
import type { FlowsText } from '../../workbench/views/flowsText';

interface FlowFileMenuProps {
  file: FlowsFile;
  flowId: string;
  text: FlowsText;
  fs?: LocalStoreFs;
  disabled?: boolean;
  onImport: (incoming: FlowsFile, resolution: Exclude<ImportResolution, 'cancel'>) => void;
}

interface PendingImport {
  incoming: FlowsFile;
  plan: ImportPlan;
  choice: 'keep-both' | 'overwrite' | '';
}

function issueLabel(code: string, text: FlowsText): string {
  const map: Record<string, Parameters<FlowsText['t']>[0]> = {
    'bad-shape': 'issueBadShape',
    'unknown-schema-version': 'issueUnknownSchema',
    'empty-id': 'issueInvalidId',
    'empty-name': 'issueEmptyName',
    'invalid-builtin': 'issueInvalidBuiltin',
    'invalid-collaboration': 'issueInvalidCollaboration',
    'invalid-participants': 'issueInvalidParticipants',
    'invalid-participant': 'issueInvalidParticipant',
    'empty-resource': 'issueEmptyResource',
    'empty-role': 'issueEmptyRole',
    'invalid-effort': 'issueInvalidEffort',
    'invalid-fresh-session': 'issueInvalidFreshSession',
    'invalid-end-condition': 'issueInvalidEnd',
    'invalid-on-fail': 'issueInvalidFail',
    'invalid-rework-limit': 'issueInvalidRework',
    'invalid-note': 'issueInvalidNote',
    'invalid-command': 'issueInvalidCommand',
    'invalid-description': 'issueInvalidDescription',
    'missing-author': 'issueMissingAuthor',
    'missing-audit': 'issueMissingAudit',
    'same-author-audit-session': 'issueSameAudit',
    'empty-flow': 'issueEmptyFlow',
    'unknown-stage': 'issueUnknownStage',
    'forbidden-next': 'issueForbiddenNext',
    'invalid-overrides': 'issueInvalidOverrides',
    'invalid-override-field': 'issueInvalidOverrideField',
    'duplicate-id': 'issueDuplicateId',
  };
  const key = map[code] ?? 'issueDefault';
  return text.t(key);
}

function schemaVersionOf(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed) {
      const version = parsed.schemaVersion;
      if (typeof version === 'string' || typeof version === 'number') return String(version);
    }
  } catch {
    return '?';
  }
  return '?';
}

export function FlowFileMenu({ file, flowId, text, fs, disabled = false, onImport }: FlowFileMenuProps) {
  const fsRef = useRef<LocalStoreFs>(fs ?? getLocalStoreFs());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [feedbackTone, setFeedbackTone] = useState<'neutral' | 'block'>('neutral');
  const conflictCount = pending ? pending.plan.stages.conflicts.length + pending.plan.flows.conflicts.length : 0;

  useEffect(() => {
    if (!open && !pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      setPending(null);
      setFeedback(undefined);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, pending]);

  const exportFlow = async () => {
    const exported = buildExport(file, flowId);
    if (!exported) {
      setFeedback(text.t('exportUnavailable'));
      setFeedbackTone('block');
      return;
    }
    try {
      const name = await fsRef.current.exportFile(flowId + '.json', JSON.stringify(exported, null, 2));
      setFeedback(name ? text.t('exportDone', { name }) : text.t('exportUnavailable'));
      setFeedbackTone(name ? 'neutral' : 'block');
    } catch (error) {
      setFeedback(text.t('exportFailed', { message: error instanceof Error ? error.message : String(error) }));
      setFeedbackTone('block');
    }
    setOpen(false);
  };

  const readImport = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected) return;
    const reader = new FileReader();
    reader.onerror = () => {
      setFeedback(text.t('importReadError'));
      setFeedbackTone('block');
      setPending(null);
    };
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setFeedback(text.t('importReadError'));
        setFeedbackTone('block');
        return;
      }
      const parsed = parseFlowsFile(reader.result);
      if (!parsed.ok) {
        if (parsed.reason === 'not-json') setFeedback(text.t('importNotJson'));
        else if (parsed.reason === 'unknown-schema-version') {
          setFeedback(text.t('importUnknownSchema', { version: schemaVersionOf(reader.result) }));
        } else if (parsed.reason === 'bad-shape') setFeedback(text.t('importBadShape'));
        else setFeedback(text.t('importInvalid') + ' ' + parsed.issues.map((issue) => issueLabel(issue.code, text) + ' (' + issue.path + ')').join(' · '));
        setFeedbackTone('block');
        setPending(null);
        setOpen(true);
        return;
      }

      if (parsed.file.flows.length === 0 && parsed.file.stages.length === 0) {
        setFeedback(text.t('importNone'));
        setFeedbackTone('block');
        setPending(null);
        setOpen(true);
        return;
      }
      const plan = planImport(file, parsed.file);
      setPending({ incoming: parsed.file, plan, choice: '' });
      setFeedback(undefined);
      setFeedbackTone('neutral');
      setOpen(true);
    };
    reader.readAsText(selected);
  };

  const applyChoice = () => {
    if (!pending || (conflictCount > 0 && !pending.choice)) return;
    const currentPlan = planImport(file, pending.incoming);
    if (JSON.stringify(currentPlan) !== JSON.stringify(pending.plan)) {
      setPending({ ...pending, plan: currentPlan, choice: '' });
      setFeedback(text.t('importStalePreview'));
      setFeedbackTone('block');
      setOpen(true);
      return;
    }
    onImport(pending.incoming, pending.choice || 'keep-both');
    setPending(null);
    setFeedback(undefined);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={text.t('flowActions')}
        onClick={() => { setOpen((value) => !value); setFeedback(undefined); }}
      >
        ⋯
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-v2-xs w-[min(440px,85vw)] max-w-[calc(100vw-2rem)]">
          <Card className="grid gap-v2-sm shadow-v2-float" role="group" aria-label={text.t('flowActions')}>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => void exportFlow()}>{text.t('exportFile')}</Button>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => inputRef.current?.click()}>{text.t('importFile')}</Button>
            <input ref={inputRef} type="file" accept=".json" className="sr-only" aria-label={text.t('importFile')} onChange={readImport} />
            <p className="text-v2-micro text-v2-ink-3">{text.t('storageNote')}</p>
            {feedback ? <Notice tone={feedbackTone === 'block' ? 'block' : 'neutral'} live={feedbackTone === 'block' ? 'assertive' : 'polite'}>{feedback}</Notice> : null}
            {pending ? (
              <section className="grid gap-v2-sm border-t border-v2-line pt-v2-sm" aria-labelledby="flows-import-preview">
                <h3 id="flows-import-preview" className="font-semibold text-v2-ink">{text.t('importPreview')}</h3>
                <p className="text-v2-meta text-v2-ink-2">{text.t('importAdds', { stages: pending.plan.stages.add.length + pending.plan.stages.crossTypeIdConflicts.length, flows: pending.plan.flows.add.length + pending.plan.flows.crossTypeIdConflicts.length })}</p>
                <p className="text-v2-meta text-v2-ink-2">{text.t('importConflicts', { stages: pending.plan.stages.conflicts.length, flows: pending.plan.flows.conflicts.length })}</p>
                <ul className="grid gap-1 text-v2-meta text-v2-ink-2">
                  {pending.plan.stages.conflicts.map((conflict) => (
                    <li key={'stage-' + conflict.item.id}>· {text.t('stageName')}: {conflict.item.name} — {conflict.existing.map((item) => item.name).join(', ')}</li>
                  ))}
                  {pending.plan.flows.conflicts.map((conflict) => (
                    <li key={'flow-' + conflict.item.id}>· {text.t('flowName')}: {conflict.item.name} — {conflict.existing.map((item) => item.name).join(', ')}</li>
                  ))}
                </ul>
                {conflictCount === 0 ? <p className="text-v2-meta text-v2-ink-3">{text.t('importNoConflicts')}</p> : <p className="text-v2-meta text-v2-ink-3">{text.t('chooseConflict')}</p>}
                {conflictCount > 0 ? (
                  <label className="flex items-start gap-v2-sm text-v2-meta text-v2-ink-2">
                    <input type="radio" className="accent-v2-primary" name="flows-import-resolution" value="keep-both" checked={pending.choice === 'keep-both'} onChange={() => setPending({ ...pending, choice: 'keep-both' })} />
                    {text.t('importKeepBoth')}
                  </label>
                ) : null}
                {conflictCount > 0 ? (
                  <label className="flex items-start gap-v2-sm text-v2-meta text-v2-ink-2">
                    <input type="radio" className="accent-v2-primary" name="flows-import-resolution" value="overwrite" checked={pending.choice === 'overwrite'} onChange={() => setPending({ ...pending, choice: 'overwrite' })} />
                    {text.t('importOverwrite')}
                  </label>
                ) : null}
                <div className="flex flex-wrap gap-v2-sm">
                  <Button size="sm" disabled={(conflictCount > 0 && !pending.choice) || disabled} onClick={applyChoice}>{text.t('importApply')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPending(null); setFeedback(text.t('importCancelled')); setFeedbackTone('neutral'); }}>{text.t('importCancel')}</Button>
                </div>
              </section>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
