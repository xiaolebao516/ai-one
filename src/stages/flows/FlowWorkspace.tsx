import type { LocalStoreFs } from '../../host/localStore';
import type { Locale } from '../../i18n/resolve';
import type { ValidationIssueCode } from '../flowModel';
import type { FlowsEditorController } from '../useFlowsEditor';
import { CompactFlowSelectors, FlowSidebar } from './FlowSidebar';
import { FlowStageList } from './FlowStageList';
import { StageEditor } from './StageEditor';
import { Card, Button, Notice, cx } from '../../ui/v2';
import type { FlowsText } from '../../workbench/views/flowsText';

interface FlowWorkspaceProps {
  editor: FlowsEditorController;
  locale: Locale;
  text: FlowsText;
  fs?: LocalStoreFs;
}

function issueLabel(code: ValidationIssueCode, text: FlowsText): string {
  const keys: Partial<Record<ValidationIssueCode, Parameters<typeof text.t>[0]>> = {
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
  return text.t(keys[code] ?? 'issueDefault');
}

export function FlowWorkspace({ editor, locale, text, fs }: FlowWorkspaceProps) {
  const file = editor.file;
  const selectedFlow = editor.selectedFlow;
  const selectedStage = editor.selectedStage;

  return (
    <div className="grid min-w-0 gap-v2-lg">
      {editor.pendingAction ? (
        <Notice tone="unknown" title={text.t('dirty')} live="polite">
          <p>{text.t('saveBeforeSwitch')}</p>
          <div className="mt-v2-sm flex flex-wrap gap-v2-sm">
            <Button size="sm" onClick={() => { void editor.saveCurrent(); }}>{text.t('saveAndContinue')}</Button>
            <Button size="sm" variant="secondary" onClick={editor.discardAndContinue}>{text.t('discardAndContinue')}</Button>
            <Button size="sm" variant="ghost" onClick={editor.keepEditing}>{text.t('keepEditing')}</Button>
          </div>
        </Notice>
      ) : null}

      {editor.issues.length ? (
        <Notice tone="block" title={text.t('validationSummary', { n: editor.issues.length })} live="assertive">
          <ul className="grid gap-1">
            {editor.issues.map((issue, index) => (
              <li key={issue.path + '-' + issue.code + '-' + index} className="text-v2-meta">
                {text.t('importValidation', { message: issueLabel(issue.code, text), path: issue.path })}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {editor.feedback ? <Notice tone={editor.feedback.tone} live={editor.feedback.tone === 'block' ? 'assertive' : 'polite'}>{editor.feedback.message}</Notice> : null}
      {editor.editError ? <Notice tone="block">{editor.editError}</Notice> : null}

      {file ? (
        <>
          <CompactFlowSelectors
            file={file}
            locale={locale}
            text={text}
            selectedFlowId={editor.selectedFlowId}
            selection={editor.selection}
            disabled={editor.mutationsDisabled}
            onSelectFlow={editor.selectFlow}
            onSelectLibraryStage={editor.selectLibraryStage}
            onCreateFlow={editor.createFlow}
            onCreateStage={editor.createStage}
          />
          <div className="relative grid min-w-0 content-start gap-v2-lg overflow-x-clip min-[1100px]:grid-cols-[150px_minmax(0,1fr)] min-[1320px]:grid-cols-[170px_minmax(0,1fr)_minmax(320px,0.85fr)]">
            <div className="hidden min-w-0 min-[1100px]:block">
              <FlowSidebar
                file={file}
                locale={locale}
                text={text}
                selectedFlowId={editor.selectedFlowId}
                selection={editor.selection}
                disabled={editor.mutationsDisabled}
                onSelectFlow={editor.selectFlow}
                onSelectLibraryStage={editor.selectLibraryStage}
                onCreateFlow={editor.createFlow}
                onCreateStage={editor.createStage}
              />
            </div>
            {selectedFlow ? (
              <FlowStageList
                file={file}
                flow={selectedFlow}
                locale={locale}
                text={text}
                selection={editor.selection}
                issues={editor.issues}
                disabled={editor.mutationsDisabled}
                saving={editor.saving}
                draftDirty={editor.draftDirty}
                insertIndex={editor.insertIndex}
                selectedAddStage={editor.selectedAddStage}
                deleteConfirm={editor.deleteFlowConfirm}
                fs={fs}
                onFlowNameChange={editor.changeFlowName}
                onCopyFlow={editor.copyFlow}
                onSave={() => { void editor.saveCurrent(); }}
                onRequestDeleteFlow={editor.requestDeleteFlow}
                onConfirmDeleteFlow={editor.confirmDeleteFlow}
                onCancelDeleteFlow={editor.cancelDeleteFlow}
                onSelectStage={editor.selectFlowStage}
                onMoveStage={editor.moveFlowStage}
                onOpenInsert={editor.openInsert}
                onSelectAddStage={editor.selectAddStage}
                onAddStage={editor.addSelectedStage}
                onCreateAndAddStage={editor.createAndAddStage}
                onImport={editor.importFile}
              />
            ) : (
              <Card><p className="text-v2-meta text-v2-ink-3">{text.t('noFlows')}</p></Card>
            )}

            <aside
              className={cx(
                'min-w-0 transition-[transform,opacity] duration-200 ease-out max-[1319px]:absolute max-[1319px]:right-0 max-[1319px]:top-0 max-[1319px]:z-20 max-[1319px]:w-[min(440px,48vw)] max-[1319px]:max-h-[calc(100vh-10rem)] max-[1319px]:overflow-y-auto max-[1319px]:shadow-v2-float',
                selectedStage
                  ? 'max-[1319px]:visible max-[1319px]:translate-x-0 max-[1319px]:opacity-100'
                  : 'max-[1319px]:invisible max-[1319px]:pointer-events-none max-[1319px]:translate-x-full max-[1319px]:opacity-0 min-[1320px]:hidden',
              )}
              aria-label={text.t('stageDetails')}
              aria-hidden={!selectedStage}
            >
              <StageEditor
                file={file}
                locale={locale}
                text={text}
                selection={editor.selection}
                stage={selectedStage}
                draft={editor.draft}
                selectedFlow={selectedFlow}
                usageFlows={editor.usageFlows}
                readOnly={editor.status === 'error'}
                scopePrompt={editor.scopePrompt}
                scopeCanFlow={editor.scopeCanFlow}
                deleteConfirm={editor.deleteStageConfirm}
                disabled={editor.mutationsDisabled}
                onChange={editor.changeStageDraft}
                onCopy={editor.copyStage}
                onRemoveFromFlow={editor.removeStageFromFlow}
                onRequestDelete={editor.requestDeleteStage}
                onConfirmDelete={editor.confirmDeleteStage}
                onCancelDelete={editor.cancelDeleteStage}
                onChooseScope={editor.chooseScope}
                onCancelScope={editor.cancelScope}
              />
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}
