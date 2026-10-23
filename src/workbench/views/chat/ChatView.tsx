import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AI_PROVIDERS } from '../../../../shared/constants';
import type { AIProvider } from '../../../../shared/types';
import { t as translateKey } from '../../../i18n/t';
import type { Locale } from '../../../i18n/resolve';
import {
  Badge,
  Button,
  Card,
  Notice,
  SectionHeader,
  Select,
  TabPanel,
  Tabs,
  type V2StatusTone,
} from '../../../ui/v2';
import { chipState } from '../../../ui/providerChipState';
import {
  appendFilesToAttachments,
  attachmentChipName,
  attachmentChipSize,
  hasReadingAttachment,
  readyAttachmentFiles,
  removeAttachment,
  type AttachmentChip,
} from '../../../ui/fileAttachments';
import { filesFromDataTransfer, isOsFileDrag, markFileDragCopy } from '../../../ui/fileDrop';
import { formatInsertedFilesPrompt } from '../../../ui/fileInsert';
import { MarkdownText } from '../../../ui/MarkdownText';
import { ReplayPanel } from '../../../ui/ReplayPanel';
import { buildMarkdown, exportFilename } from '../../../ui/exportMarkdown';
import { workbenchText } from '../../workbenchText';
import {
  CHAT_PRESET_IDS,
  CHAT_PROVIDERS,
  buildTaskPrefill,
  deriveCardState,
  deriveLoginState,
  insertMarkdownQuote,
  lastUserQuestion,
  truncateReplySummary,
  type ChatPresetId,
  type DerivedCardState,
  type ProviderReplyState,
} from './chatModel';
import type { ChatRuntime } from './useChatRuntime';
import { useNativeOverlayGuard } from './nativeOverlay';
import { ProviderWebTab } from './ProviderWebTab';

export interface ChatViewProps {
  locale: Locale;
  runtime: ChatRuntime;
  onConvertToTask: (input: { text: string }) => void;
}

function presetForSession(runtime: ChatRuntime): ChatPresetId {
  if (runtime.activeSession.presetId === 'deliberation') return 'deliberation';
  if (runtime.activeSession.mode === 'debate' || runtime.activeSession.mode === 'consult') return runtime.activeSession.mode;
  return 'free';
}

function loginLabel(locale: Locale, state: ReturnType<typeof deriveLoginState>): string {
  const text = workbenchText(locale);
  if (state === 'loggedIn') return text.t('chatLoggedIn');
  if (state === 'loggedOut') return text.t('chatLoggedOut');
  return text.t('chatNotProbed');
}

function loginTone(state: ReturnType<typeof deriveLoginState>): 'done' | 'block' | 'unknown' {
  if (state === 'loggedIn') return 'done';
  if (state === 'loggedOut') return 'block';
  return 'unknown';
}

function cardTone(status: DerivedCardState['status']): V2StatusTone {
  if (status === 'completed') return 'done';
  if (status === 'generating') return 'run';
  if (status === 'failed' || status === 'timedOut') return 'block';
  return 'unknown';
}

function cardLabel(locale: Locale, state: DerivedCardState): string {
  const text = workbenchText(locale);
  switch (state.status) {
    case 'completed': return text.t('chatCardCompleted');
    case 'generating': return text.t('chatCardGenerating', { seconds: state.elapsedSeconds });
    case 'failed': return text.t('chatCardFailed');
    case 'timedOut': return text.t('chatCardTimedOut', { seconds: state.elapsedSeconds });
    case 'notSent':
      if (state.reason === 'not-selected') return text.t('chatNotSentUnselected');
      if (state.reason === 'not-logged-in') return text.t('chatNotSentLoggedOut');
      if (state.reason === 'not-probed') return text.t('chatNotSentUnknown');
      return text.t('chatNotSentNotReady');
  }
}

function cardContent(state: DerivedCardState): string {
  return state.content;
}

function downloadMarkdown(runtime: ChatRuntime, locale: Locale): void {
  const session = runtime.activeSession;
  const exportedAt = new Date();
  const presetId = session.presetId === 'deliberation' ? 'deliberation' : session.mode;
  const preset = {
    id: presetId,
    icon: presetId === 'deliberation' ? '🗣️' : '💬',
    name: workbenchText(locale).t(
      presetId === 'debate' ? 'chatPresetDebate'
        : presetId === 'consult' ? 'chatPresetConsult'
          : presetId === 'deliberation' ? 'chatPresetDeliberation'
            : 'chatPresetFree',
    ),
  };
  const markdown = buildMarkdown(session.messages, session.mode, exportedAt, { preset });
  const blob = new Blob([markdown.content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFilename(session.mode, exportedAt, presetId);
  anchor.click();
  URL.revokeObjectURL(url);
}

function replySummaries(replyStates: Partial<Record<AIProvider, ProviderReplyState>>) {
  return CHAT_PROVIDERS.flatMap((provider) => {
    const reply = replyStates[provider];
    return reply?.content ? [{ provider, content: reply.content }] : [];
  });
}

export function ChatView({ locale, runtime, onConvertToTask }: ChatViewProps) {
  const text = workbenchText(locale);
  const [activeTab, setActiveTab] = useState('compare');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const presetId = presetForSession(runtime);
  const [expanded, setExpanded] = useState<Set<AIProvider>>(() => new Set());
  const [forwardSource, setForwardSource] = useState<AIProvider>();
  const [forwardTargets, setForwardTargets] = useState<AIProvider[]>([]);
  const [forwardNote, setForwardNote] = useState('');
  const [includeSummaries, setIncludeSummaries] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // The conversation popup (narrow widths) and the more-menu float over the native web tab.
  useNativeOverlayGuard(sidebarOpen || menuOpen);
  const [showReplay, setShowReplay] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(runtime.activeSession.title);
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
  const [actionNotice, setActionNotice] = useState<string>();
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentQuestion = lastUserQuestion(runtime.activeSession.messages);
  const hasBusy = runtime.busyProviders.length > 0 || runtime.replayRunning;
  const presetOptions = [
    { value: 'free', label: text.t('chatPresetFree') },
    { value: 'debate', label: text.t('chatPresetDebate') },
    { value: 'consult', label: text.t('chatPresetConsult') },
    { value: 'deliberation', label: text.t('chatPresetDeliberation') },
  ];
  const readyFiles = readyAttachmentFiles(attachments);
  const attachmentsReading = hasReadingAttachment(attachments);
  const activeTargets = presetId === 'free' ? runtime.selectedTargets : [];
  const busySelectedTargets = activeTargets.filter((provider) => runtime.busyProviders.includes(provider));
  const sendTargets = activeTargets.filter((provider) => !runtime.busyProviders.includes(provider) && deriveLoginState(runtime.providerStates[provider]) !== 'loggedOut');

  const choosePreset = (value: string) => {
    if (!(CHAT_PRESET_IDS as readonly string[]).includes(value)) return;
    const next = value as ChatPresetId;
    runtime.setPreset(next);
  };

  const toggleTarget = (provider: AIProvider) => {
    const selected = runtime.selectedTargets.includes(provider);
    if ((deriveLoginState(runtime.providerStates[provider]) === 'loggedOut' || runtime.busyProviders.includes(provider)) && !selected) return;
    setActionNotice(undefined);
    runtime.setSelectedTargets(
      runtime.selectedTargets.includes(provider)
        ? runtime.selectedTargets.filter((target) => target !== provider)
        : [...runtime.selectedTargets, provider],
    );
  };

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setActionNotice(undefined);
    const message = formatInsertedFilesPrompt(readyFiles, draft);
    if (!message.trim() || attachmentsReading || attachmentBusy) return;
    if (runtime.replayRunning) {
      setActionNotice(text.t('chatReplayBusy'));
      return;
    }
    if (presetId === 'deliberation') {
      // L7 has not supplied the local discussion task model/route yet. Never discard the draft
      // or pretend that the discussion started.
      setActionNotice(text.t('chatDeliberationNotice'));
      return;
    }
    if (presetId === 'free' && sendTargets.length === 0) {
      setActionNotice(busySelectedTargets.length > 0
        ? text.t('chatBusyNotice', { providers: busySelectedTargets.map((provider) => AI_PROVIDERS[provider].name).join(', ') })
        : text.t('chatNoTarget'));
      return;
    }
    const sent = await runtime.sendMessage(message, presetId === 'free' ? sendTargets : runtime.selectedTargets, presetId);
    if (sent) {
      setDraft('');
      setAttachments([]);
      setAttachmentError(undefined);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  const readFiles = async (files: File[]) => {
    if (files.length === 0 || attachmentBusy) return;
    setAttachmentBusy(true);
    setAttachmentError(undefined);
    try {
      const result = await appendFilesToAttachments(attachments, files, undefined, locale);
      setAttachments(result.chips);
      if (result.error) setAttachmentError(result.error.message);
    } finally {
      setAttachmentBusy(false);
    }
  };

  const convertToTask = () => {
    if (!currentQuestion) return;
    onConvertToTask({
      text: buildTaskPrefill(currentQuestion, replySummaries(runtime.replyStates), includeSummaries, text.t('chatSummaryHeading')),
    });
  };

  const beginForward = (provider: AIProvider) => {
    setForwardSource(provider);
    setForwardTargets([]);
    setForwardNote('');
    setActionNotice(undefined);
  };

  const sendForward = async () => {
    if (!forwardSource) return;
    if (forwardTargets.length === 0) {
      setActionNotice(text.t('chatSelectForwardTarget'));
      return;
    }
    const reply = runtime.replyStates[forwardSource];
    const content = reply?.content ?? '';
    if (!content) return;
    const sendableForwardTargets = forwardTargets.filter((target) =>
      !runtime.busyProviders.includes(target) && deriveLoginState(runtime.providerStates[target]) !== 'loggedOut',
    );
    if (sendableForwardTargets.length === 0) {
      const blocked = forwardTargets.filter((target) => runtime.busyProviders.includes(target));
      setActionNotice(blocked.length > 0
        ? text.t('chatBusyNotice', { providers: blocked.map((target) => AI_PROVIDERS[target].name).join(', ') })
        : text.t('chatSelectForwardTarget'));
      return;
    }
    if (sendableForwardTargets.length < forwardTargets.length) {
      const blocked = forwardTargets.filter((target) => !sendableForwardTargets.includes(target));
      setActionNotice(text.t('chatBusyExcluded', { providers: blocked.map((target) => AI_PROVIDERS[target].name).join(', ') }));
    }
    const sent = await runtime.forwardMessage(forwardSource, content, sendableForwardTargets, forwardNote);
    if (sent) {
      setForwardSource(undefined);
      setForwardTargets([]);
      setForwardNote('');
      setActionNotice(undefined);
    }
  };

  const renameCurrent = () => {
    runtime.renameSession(runtime.activeSessionId, renameDraft);
    setRenameOpen(false);
  };

  const deleteCurrent = () => {
    if (!pendingDeleteId) return;
    runtime.deleteSession(pendingDeleteId);
    setPendingDeleteId(undefined);
    setMenuOpen(false);
  };

  const tabItems = [
    { id: 'compare', label: text.t('chatCompare') },
    ...CHAT_PROVIDERS.map((provider) => {
      const login = deriveLoginState(runtime.providerStates[provider]);
      const state = chipState(runtime.providerStates[provider], 'chip', (key) => translateKey(key, locale));
      return {
        id: provider,
        label: (
          <span className="inline-flex items-center gap-v2-sm">
            <span>{AI_PROVIDERS[provider].name}</span>
            <Badge tone={loginTone(login)}>{loginLabel(locale, login)}</Badge>
            <span className="sr-only">{state.label}</span>
          </span>
        ),
      };
    }),
  ];

  return (
    <div className="flex h-full min-h-[520px] flex-col gap-v2-md p-v2-page">
      <div className="flex flex-wrap items-start justify-between gap-v2-md">
        <SectionHeader title={text.t('chatTitle')} description={text.t('chatSubtitle')} />
        <div className="flex flex-wrap items-center gap-v2-sm">
          <Button size="sm" variant={includeSummaries ? 'primary' : 'secondary'} aria-pressed={includeSummaries} onClick={() => setIncludeSummaries((value) => !value)}>
            {text.t('chatIncludeSummaries')}
          </Button>
          <Button size="sm" variant="secondary" disabled={!currentQuestion} disabledReason={text.t('chatNoQuestion')} onClick={convertToTask}>
            {text.t('chatConvertTask')}
          </Button>
          <div className="relative">
            <Button size="sm" variant="secondary" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
              {text.t('chatMore')} ⋯
            </Button>
            {menuOpen ? (
              <Card className="absolute right-0 top-full z-20 mt-v2-xs grid min-w-[190px] gap-v2-xs shadow-v2-float">
                <Button size="sm" variant="secondary" onClick={() => { setShowReplay((value) => !value); setMenuOpen(false); }} disabled={!runtime.desktopAvailable || hasBusy} disabledReason={hasBusy ? text.t('chatReplayBusy') : text.t('chatDesktopOnly')}>
                  {text.t('chatReplay')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => { try { downloadMarkdown(runtime, locale); } catch (error) { setActionNotice(error instanceof Error ? error.message : String(error)); } setMenuOpen(false); }}>
                  {text.t('chatExportMarkdown')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => { setRenameDraft(runtime.activeSession.title); setRenameOpen(true); setMenuOpen(false); }}>
                  {text.t('chatRename')}
                </Button>
                <Button size="sm" variant="secondary" disabled={hasBusy} disabledReason={text.t('chatBusyNotice', { providers: runtime.busyProviders.map((provider) => AI_PROVIDERS[provider].name).join(', ') })} onClick={() => { setPendingDeleteId(runtime.activeSessionId); setMenuOpen(false); }}>
                  {text.t('chatDelete')}
                </Button>
              </Card>
            ) : null}
          </div>
        </div>
      </div>

      <Tabs label={text.t('chatTabsLabel')} idBase="chat-view-tabs" items={tabItems} value={activeTab} onChange={setActiveTab} />

      <div className="flex min-h-0 flex-1 gap-v2-md">
        <aside className={`w-[180px] shrink-0 flex-col gap-v2-sm border-r border-v2-line pr-v2-md ${sidebarOpen ? 'flex' : 'hidden'} min-[1100px]:flex max-[1099px]:fixed max-[1099px]:inset-y-16 max-[1099px]:left-0 max-[1099px]:z-20 max-[1099px]:bg-v2-panel max-[1099px]:p-v2-md max-[1099px]:shadow-v2-float`}>
          <div className="flex items-center justify-between gap-v2-xs">
            <span className="text-v2-meta font-semibold text-v2-ink-2">{text.t('chatConversations')}</span>
            <div className="flex items-center gap-v2-xs">
              <Button size="sm" variant="secondary" className="min-[1100px]:hidden" onClick={() => setSidebarOpen(false)}>
                {text.t('chatCloseConversations')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => { runtime.newConversation(); setDraft(''); setAttachments([]); setRenameOpen(false); setForwardSource(undefined); setActionNotice(undefined); }}>
                {text.t('chatNewConversation')}
              </Button>
            </div>
          </div>
          <div className="grid gap-v2-xs overflow-y-auto">
            {runtime.sessions.map((session) => (
              <Button
                key={session.id}
                size="sm"
                variant={session.id === runtime.activeSessionId ? 'primary' : 'secondary'}
                className="w-full justify-start text-left"
                aria-current={session.id === runtime.activeSessionId ? 'page' : undefined}
                onClick={() => { runtime.selectSession(session); setDraft(''); setAttachments([]); setSidebarOpen(false); setRenameOpen(false); setForwardSource(undefined); setActionNotice(undefined); }}
              >
                <span className="block max-w-full truncate">{session.title}</span>
              </Button>
            ))}
            {runtime.sessions.length === 0 ? <p className="text-v2-meta text-v2-ink-3">{text.t('chatEmptyConversations')}</p> : null}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-v2-md">
          <div className="flex items-center gap-v2-sm min-[1100px]:hidden">
            <Button size="sm" variant="secondary" onClick={() => setSidebarOpen((value) => !value)} aria-expanded={sidebarOpen}>
              {text.t('chatConversations')}
            </Button>
            <span className="truncate text-v2-meta text-v2-ink-2">{runtime.activeSession.title}</span>
          </div>

          <TabPanel idBase="chat-view-tabs" id="compare" active={activeTab === 'compare'} className="min-h-0 flex-1">
            {currentQuestion ? (
              <p className="mb-v2-md whitespace-pre-wrap break-words text-v2-body text-v2-ink" data-testid="chat-current-question">
                <span className="mr-v2-sm font-semibold text-v2-ink-3">{text.t('chatYou')}</span>
                {currentQuestion}
              </p>
            ) : null}
            <div className="grid min-h-0 grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-v2-md">
              {CHAT_PROVIDERS.map((provider) => (
                <ReplyCard
                  key={provider}
                  provider={provider}
                  locale={locale}
                  runtime={runtime}
                  expanded={expanded.has(provider)}
                  onToggleExpanded={() => setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(provider)) next.delete(provider);
                    else next.add(provider);
                    return next;
                  })}
                  forwarding={forwardSource === provider}
                  forwardTargets={forwardTargets}
                  forwardNote={forwardNote}
                  onForwardNote={setForwardNote}
                  onToggleForwardTarget={(target) => setForwardTargets((current) =>
                    current.includes(target) ? current.filter((item) => item !== target) : [...current, target],
                  )}
                  onBeginForward={() => beginForward(provider)}
                  onCancelForward={() => { setForwardSource(undefined); setActionNotice(undefined); }}
                  onSendForward={() => void sendForward()}
                  onQuote={(reply) => {
                    const card = document.querySelector<HTMLElement>(`article[data-chat-provider="${provider}"]`);
                    const selection = typeof window === 'undefined' ? null : window.getSelection();
                    const belongsToCard = Boolean(
                      selection &&
                      !selection.isCollapsed &&
                      card &&
                      selection.anchorNode &&
                      selection.focusNode &&
                      card.contains(selection.anchorNode) &&
                      card.contains(selection.focusNode),
                    );
                    const selectedText = belongsToCard ? selection?.toString() : undefined;
                    setDraft((current) => insertMarkdownQuote(current, selectedText, reply));
                  }}
                  onViewWeb={() => setActiveTab(provider)}
                />
              ))}
            </div>
          </TabPanel>
          {CHAT_PROVIDERS.map((provider) => (
            <TabPanel key={provider} idBase="chat-view-tabs" id={provider} active={activeTab === provider} className="min-h-[max(320px,calc(100vh-520px))] flex-1 flex-col [&:not([hidden])]:flex">
              <ProviderWebTab provider={provider} active={activeTab === provider} />
            </TabPanel>
          ))}

          {renameOpen ? (
            <Card className="flex flex-wrap items-center gap-v2-sm">
              <label htmlFor="chat-rename-input" className="sr-only">{text.t('chatRename')}</label>
              <input id="chat-rename-input" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} placeholder={text.t('chatRenamePlaceholder')} className="min-w-[180px] flex-1 rounded-v2-sm border border-v2-line bg-v2-surface px-v2-sm py-v2-xs text-v2-body text-v2-ink" />
              <Button size="sm" variant="primary" onClick={renameCurrent}>{text.t('chatSave')}</Button>
              <Button size="sm" variant="secondary" onClick={() => setRenameOpen(false)}>{text.t('chatCancel')}</Button>
            </Card>
          ) : null}

          {pendingDeleteId ? (
            <Notice tone="block" title={text.t('chatDeletePrompt')}>
              <div className="mt-v2-sm flex flex-wrap gap-v2-sm">
                <Button size="sm" variant="danger" onClick={deleteCurrent}>{text.t('chatDelete')}</Button>
                <Button size="sm" variant="secondary" onClick={() => setPendingDeleteId(undefined)}>{text.t('chatCancel')}</Button>
              </div>
            </Notice>
          ) : null}

          {runtime.notice ? (
            <Notice tone={runtime.notice.tone} live="polite">
              {runtime.notice.message}
              <Button size="sm" variant="secondary" onClick={runtime.clearNotice}>{text.t('chatDismiss')}</Button>
            </Notice>
          ) : null}
          {runtime.persistenceNotice ? (
            <Notice tone={runtime.persistenceNotice.tone} live="polite">
              {runtime.persistenceNotice.message}
              <Button size="sm" variant="secondary" onClick={runtime.clearPersistenceNotice}>{text.t('chatDismiss')}</Button>
            </Notice>
          ) : null}
          {actionNotice ? <Notice tone="unknown" live="polite">{actionNotice}</Notice> : null}

          {showReplay ? (
            <Card>
              <ReplayPanel
                locale={locale}
                activeProviders={[...CHAT_PROVIDERS]}
                canStartReplay={runtime.canStartReplay}
                runBlockedMessage={text.t('chatReplayBusy')}
                onReplayStateChange={runtime.setReplayRunning}
              />
            </Card>
          ) : null}

          <form
            className="mt-auto grid gap-v2-sm border-t border-v2-line pt-v2-md"
            onSubmit={(event) => void submit(event)}
            onDragOver={(event) => { if (isOsFileDrag(event.dataTransfer)) markFileDragCopy(event); }}
            onDrop={(event) => {
              if (!isOsFileDrag(event.dataTransfer)) return;
              markFileDragCopy(event);
              void readFiles(filesFromDataTransfer(event.dataTransfer));
            }}
          >
            <div className="flex flex-wrap items-center gap-v2-sm">
              <span className="text-v2-meta text-v2-ink-2">{text.t('chatTargets')}</span>
              {CHAT_PROVIDERS.map((provider) => {
                const login = deriveLoginState(runtime.providerStates[provider]);
                const busy = runtime.busyProviders.includes(provider);
                const chip = chipState(runtime.providerStates[provider], 'chip', (key) => translateKey(key, locale));
                const selected = runtime.selectedTargets.includes(provider);
                const serial = presetId !== 'free';
                const disabled = ((busy || login === 'loggedOut') && !selected) || serial;
                const reason = busy
                  ? text.t('chatBusy', { provider: AI_PROVIDERS[provider].name })
                  : login === 'loggedOut'
                    ? text.t('chatLoggedOut')
                    : serial ? text.t('chatSerialTargetHint') : undefined;
                return (
                  <Button
                    key={provider}
                    size="sm"
                    variant={selected ? 'primary' : 'secondary'}
                    disabled={disabled}
                    disabledReason={reason}
                    title={busy ? text.t('chatBusy', { provider: AI_PROVIDERS[provider].name }) : chip.label}
                    className={login === 'loggedOut' ? 'border-dashed' : undefined}
                    aria-pressed={selected}
                    onClick={() => toggleTarget(provider)}
                  >
                    {AI_PROVIDERS[provider].name}
                    <span className="ml-1 text-v2-micro">{loginLabel(locale, login)}</span>
                    {busy ? <span className="ml-1 text-v2-micro">{text.t('chatBusyShort')}</span> : null}
                  </Button>
                );
              })}
            </div>

            {busySelectedTargets.length > 0 && sendTargets.length > 0 ? (
              <Notice tone="unknown">{text.t('chatBusyExcluded', { providers: busySelectedTargets.map((provider) => AI_PROVIDERS[provider].name).join(', ') })}</Notice>
            ) : null}
            {presetId === 'deliberation' ? (
              <Notice tone="unknown">{text.t('chatDeliberationNotice')}</Notice>
            ) : presetId !== 'free' ? (
              <Notice tone="unknown">{text.t('chatSerialTargetHint')}</Notice>
            ) : null}

            <label htmlFor="chat-composer" className="sr-only">{text.t('chatInputPlaceholder')}</label>
            <textarea
              id="chat-composer"
              rows={3}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={text.t('chatInputPlaceholder')}
              className="w-full resize-y rounded-v2-md border border-v2-line bg-v2-surface px-v2-md py-v2-sm text-v2-body text-v2-ink placeholder:text-v2-ink-3 focus:outline-none focus:ring-2 focus:ring-v2-primary"
            />

            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-v2-sm">
                {attachments.map((chip) => (
                  <Badge key={chip.id} tone={chip.phase === 'error' ? 'block' : chip.phase === 'reading' ? 'unknown' : 'neutral'}>
                    {attachmentChipName(chip)} · {attachmentChipSize(chip)} B
                    {chip.phase === 'reading' ? ` · ${text.t('chatAttachmentReading')}` : null}
                    {chip.phase === 'error' ? ` · ${chip.message}` : null}
                    <button type="button" className="ml-1 underline" aria-label={text.t('chatRemoveAttachment', { name: attachmentChipName(chip) })} onClick={() => setAttachments((current) => removeAttachment(current, chip.id))}>×</button>
                  </Badge>
                ))}
              </div>
            ) : null}
            {attachmentError ? <Notice tone="unknown">{attachmentError}</Notice> : null}

            <div className="flex flex-wrap items-center justify-between gap-v2-sm">
              <div className="flex flex-wrap items-center gap-v2-sm">
                <Select
                  id="chat-preset-select"
                  label={text.t('chatPresetLabel')}
                  value={presetId}
                  options={presetOptions}
                  onChange={choosePreset}
                  size="sm"
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    void readFiles(Array.from(event.target.files ?? []));
                    event.target.value = '';
                  }}
                />
                <Button size="sm" variant="secondary" disabled={attachmentBusy} loading={attachmentBusy} onClick={() => fileInputRef.current?.click()}>
                  {text.t('chatAttach')}
                </Button>
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={runtime.replayRunning || presetId === 'deliberation' || attachmentsReading || attachmentBusy || (!draft.trim() && readyFiles.length === 0) || (presetId === 'free' && sendTargets.length === 0)}
                disabledReason={runtime.replayRunning
                  ? text.t('chatReplayBusy')
                  : presetId === 'deliberation'
                    ? text.t('chatDeliberationNotice')
                    : presetId === 'free' && sendTargets.length === 0
                      ? busySelectedTargets.length > 0
                        ? text.t('chatBusyNotice', { providers: busySelectedTargets.map((provider) => AI_PROVIDERS[provider].name).join(', ') })
                        : text.t('chatNoTarget')
                      : undefined}
                loading={presetId === 'free' && sendTargets.length === 0 && busySelectedTargets.length > 0}
              >
                {presetId === 'deliberation' ? text.t('chatStartDiscussion') : text.t('chatSend')}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

interface ReplyCardProps {
  provider: AIProvider;
  locale: Locale;
  runtime: ChatRuntime;
  expanded: boolean;
  onToggleExpanded: () => void;
  forwarding: boolean;
  forwardTargets: AIProvider[];
  forwardNote: string;
  onForwardNote: (note: string) => void;
  onToggleForwardTarget: (provider: AIProvider) => void;
  onBeginForward: () => void;
  onCancelForward: () => void;
  onSendForward: () => void;
  onQuote: (reply: string) => void;
  onViewWeb: () => void;
}

function ReplyCard({
  provider,
  locale,
  runtime,
  expanded,
  onToggleExpanded,
  forwarding,
  forwardTargets,
  forwardNote,
  onForwardNote,
  onToggleForwardTarget,
  onBeginForward,
  onCancelForward,
  onSendForward,
  onQuote,
  onViewWeb,
}: ReplyCardProps) {
  const text = workbenchText(locale);
  const providerState = runtime.providerStates[provider];
  const login = deriveLoginState(providerState);
  const busy = runtime.busyProviders.includes(provider) || runtime.replayRunning;
  const timeoutAction = runtime.timeoutActions[provider]?.sessionId === runtime.activeSessionId
    ? runtime.timeoutActions[provider]
    : undefined;
  const derived = deriveCardState({
    providerState,
    selected: runtime.comparisonTargets.includes(provider),
    reply: runtime.replyStates[provider],
    now: runtime.now,
  });
  const content = cardContent(derived);
  const summary = truncateReplySummary(content);
  const forwardedFrom = derived.status === 'notSent' ? undefined : derived.forwardedFrom;
  return (
    <Card as="article" data-chat-provider={provider} className="flex min-w-0 flex-col gap-v2-sm">
      <div className="flex items-start justify-between gap-v2-sm">
        <div className="min-w-0">
          <h2 className="truncate text-v2-heading font-semibold text-v2-ink">{AI_PROVIDERS[provider].name}</h2>
          <div className="mt-v2-xs flex flex-wrap items-center gap-v2-xs">
            <Badge tone={loginTone(login)}>{loginLabel(locale, login)}</Badge>
            <Badge tone={cardTone(derived.status)}>{cardLabel(locale, derived)}</Badge>
            {forwardedFrom ? <Badge tone="unknown">{text.t('chatReceivedForward', { provider: AI_PROVIDERS[forwardedFrom].name })}</Badge> : null}
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={onViewWeb}>{text.t('chatViewWeb')}</Button>
      </div>

      {runtime.replyStates[provider]?.truncated ? (
        <Notice tone="unknown">{text.t('chatForwardTruncated')}</Notice>
      ) : null}
      {content ? (
        <div className="min-w-0 text-v2-body text-v2-ink-2">
          {expanded ? <MarkdownText text={content} /> : <p className="whitespace-pre-wrap break-words">{summary}</p>}
        </div>
      ) : (
        <p className="text-v2-meta text-v2-ink-3">{derived.status === 'notSent' ? cardLabel(locale, derived) : text.t('chatNoResponseYet')}</p>
      )}

      <div className="flex flex-wrap gap-v2-xs">
        {content ? (
          <>
            <Button size="sm" variant="secondary" onClick={onToggleExpanded}>
              {expanded ? text.t('chatCollapse') : text.t('chatExpand')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onQuote(content)}>{text.t('chatQuote')}</Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || runtime.replyStates[provider]?.truncated === true}
              disabledReason={runtime.replyStates[provider]?.truncated
                ? text.t('chatForwardTruncated')
                : text.t('chatBusy', { provider: AI_PROVIDERS[provider].name })}
              onClick={onBeginForward}
            >
              {text.t('chatForward')}
            </Button>
          </>
        ) : null}
        {derived.status === 'failed' || derived.status === 'timedOut' ? (
          <>
            <Button size="sm" variant="secondary" disabled={busy && !timeoutAction} disabledReason={text.t('chatBusy', { provider: AI_PROVIDERS[provider].name })} onClick={() => void runtime.retryProvider(provider)}>
              {text.t('chatRetry')}
            </Button>
            {timeoutAction?.skipAllowed === false ? null : (
              <Button size="sm" variant="secondary" disabled={busy && !timeoutAction} disabledReason={text.t('chatBusy', { provider: AI_PROVIDERS[provider].name })} onClick={() => runtime.skipProvider(provider)}>{text.t('chatSkip')}</Button>
            )}
          </>
        ) : null}
      </div>

      {forwarding ? (
        <div className="grid gap-v2-sm border-t border-v2-line pt-v2-sm">
          <span className="text-v2-meta text-v2-ink-2">{text.t('chatForwardTo')}</span>
          <div className="flex flex-wrap gap-v2-xs">
            {CHAT_PROVIDERS.filter((target) => target !== provider && deriveLoginState(runtime.providerStates[target]) !== 'loggedOut').map((target) => {
              const targetBusy = runtime.busyProviders.includes(target);
              return (
                <Button
                  key={target}
                  size="sm"
                  variant={forwardTargets.includes(target) ? 'primary' : 'secondary'}
                  disabled={targetBusy && !forwardTargets.includes(target)}
                  disabledReason={targetBusy ? text.t('chatBusy', { provider: AI_PROVIDERS[target].name }) : undefined}
                  aria-pressed={forwardTargets.includes(target)}
                  onClick={() => onToggleForwardTarget(target)}
                >
                  {AI_PROVIDERS[target].name}
                  {targetBusy ? ` · ${text.t('chatBusyShort')}` : ''}
                </Button>
              );
            })}
          </div>
          <label htmlFor={`chat-forward-note-${provider}`} className="sr-only">{text.t('chatForwardNote')}</label>
          <textarea
            id={`chat-forward-note-${provider}`}
            rows={2}
            value={forwardNote}
            onChange={(event) => onForwardNote(event.target.value)}
            placeholder={text.t('chatForwardNote')}
            className="w-full resize-y rounded-v2-md border border-v2-line bg-v2-surface px-v2-sm py-v2-xs text-v2-body text-v2-ink"
          />
          <div className="flex gap-v2-sm">
            <Button size="sm" variant="primary" disabled={forwardTargets.length === 0 || busy} onClick={onSendForward}>{text.t('chatForwardSend')}</Button>
            <Button size="sm" variant="secondary" onClick={onCancelForward}>{text.t('chatCancel')}</Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
