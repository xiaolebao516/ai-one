import { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_AI_PROVIDERS, AI_PROVIDERS } from '../../../../shared/constants';
import type { AIProvider, BridgeMessage, ChatMode, ProviderState, WorkflowPresetId } from '../../../../shared/types';
import { host as defaultHost } from '../../../host';
import { resetProviderBootState, startBridgePull as defaultStartBridgePull } from '../../../bridge/pull';
import { isRenderableResponseMessage } from '../../../bridge/render';
import { mergePullBridgeState, type PullBridgeState } from '../../../appBridgeState';
import { providerFromRoleAssignment } from '../../../ui/autoFocus';
import {
  buildConversationReplayContext,
  createActiveProviderResponse,
  createConversationMessageId,
  ensureFreshProviderSessions,
  pendingProviderSessionResets,
  ProviderSessionResetError,
  type ActiveProviderResponse,
} from '../../../ui/conversationContinuity';
import {
  createConversationSession,
  DEFAULT_CONVERSATION_SESSION_TITLE,
  loadConversationSessions,
  removeConversationSession,
  saveConversationSessionsWithQuotaRecovery,
  titleFromFirstUserMessage,
  upsertConversationSession,
  type ConversationSession,
  type ConversationSessionMessage,
} from '../../../ui/conversationSessions';
import { defaultRolesForPreset } from '../../../ui/presetCatalogData';
import { waitForProvidersSendable } from '../../../ui/targets';
import { isSendable } from '../../../workflow/sendability';
import { runWorkflow as defaultRunWorkflow, type RunWorkflowParams, type RunWorkflowResult } from '../../../workflow';
import type { Locale } from '../../../i18n/resolve';
import { workbenchText } from '../../workbenchText';
import {
  CHAT_PROVIDERS,
  busyTargets,
  buildForwardMessage,
  classifyResponseContent,
  deriveLoginState,
  lastUserQuestion,
  settlePendingTargets,
  type ChatSendPresetId,
  type ProviderReplyState,
} from './chatModel';

export interface ChatRuntimeHost {
  app: Pick<typeof defaultHost.app, 'isDesktop'>;
  connections: Pick<typeof defaultHost.connections, 'get' | 'onUpdate'>;
  bridge: Pick<typeof defaultHost.bridge, 'onMessage'>;
  provider: Pick<typeof defaultHost.provider, 'open' | 'park' | 'newSession'>;
}

export interface ChatRuntimeOptions {
  enabled: boolean;
  locale: Locale;
  isDesktop?: boolean;
  host?: ChatRuntimeHost;
  runWorkflow?: (params: RunWorkflowParams) => Promise<RunWorkflowResult>;
  startBridgePull?: () => Promise<() => void>;
}

export interface ChatRuntimeNotice {
  tone: 'neutral' | 'unknown' | 'block' | 'done';
  message: string;
}

export interface ChatRuntime {
  providerStates: Record<AIProvider, ProviderState>;
  sessions: ConversationSession[];
  activeSessionId: string;
  activeSession: ConversationSession;
  replyStates: Partial<Record<AIProvider, ProviderReplyState>>;
  comparisonTargets: AIProvider[];
  selectedTargets: AIProvider[];
  busyProviders: AIProvider[];
  now: number;
  notice?: ChatRuntimeNotice;
  setSelectedTargets: (targets: AIProvider[]) => void;
  clearNotice: () => void;
  newConversation: () => void;
  selectSession: (session: ConversationSession) => void;
  renameSession: (sessionId: string, title: string) => void;
  deleteSession: (sessionId: string) => void;
  sendMessage: (text: string, targets: AIProvider[], presetId: ChatSendPresetId) => Promise<boolean>;
  forwardMessage: (source: AIProvider, original: string, targets: AIProvider[], note: string) => Promise<boolean>;
  retryProvider: (provider: AIProvider) => Promise<boolean>;
  skipProvider: (provider: AIProvider) => void;
  setPreset: (presetId: import('./chatModel').ChatPresetId) => void;
  desktopAvailable: boolean;
}

interface SendOptions {
  forwardedFrom?: AIProvider;
  preserveComparison?: boolean;
}

interface ProviderRequest {
  text: string;
  presetId: ChatSendPresetId;
  sessionId: string;
  forwardedFrom?: AIProvider;
}

const OFFSCREEN_BOUNDS: DOMRectReadOnly = {
  x: -10_000,
  y: -10_000,
  width: 420,
  height: 320,
  top: -10_000,
  left: -10_000,
  right: -9_580,
  bottom: -9_680,
  toJSON: () => ({}),
};

function emptyProviderState(provider: AIProvider): ProviderState {
  return { provider, webview: 'none', dom: 'unknown', login: 'unknown', thinking: false, lastStatusAt: 0 };
}

function initialProviderStates(): Record<AIProvider, ProviderState> {
  return Object.fromEntries(ALL_AI_PROVIDERS.map((provider) => [provider, emptyProviderState(provider)])) as Record<AIProvider, ProviderState>;
}

function renderablePayload(payload: unknown): { content: string; truncated: boolean } {
  if (typeof payload === 'string') return { content: payload, truncated: false };
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const typed = payload as { text?: unknown; truncated?: unknown };
    return { content: typeof typed.text === 'string' ? typed.text : '', truncated: typed.truncated === true };
  }
  return { content: JSON.stringify(payload ?? '') ?? String(payload ?? ''), truncated: false };
}

function isProvider(value: string | undefined): value is AIProvider {
  return Boolean(value && (ALL_AI_PROVIDERS as readonly string[]).includes(value));
}

function repliesFromSession(messages: readonly ConversationSessionMessage[]): Partial<Record<AIProvider, ProviderReplyState>> {
  let questionIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user' && !messages[index].forwardedFrom) {
      questionIndex = index;
      break;
    }
  }
  if (questionIndex < 0) return {};
  const replies: Partial<Record<AIProvider, ProviderReplyState>> = {};
  for (const message of messages.slice(questionIndex + 1)) {
    if (message.role !== 'ai' || !isProvider(message.provider)) continue;
    const status = message.final === false ? 'failed' : classifyResponseContent(message.content);
    replies[message.provider] = {
      status,
      content: message.content,
      ...(message.truncated ? { truncated: true } : {}),
      ...(message.forwardedFrom ? { forwardedFrom: message.forwardedFrom } : {}),
    };
  }
  return replies;
}

function latestProviderStates(
  snapshot: readonly ProviderState[],
  current: Record<AIProvider, ProviderState>,
  pullBridge: ReadonlyMap<AIProvider, PullBridgeState>,
): Record<AIProvider, ProviderState> {
  const next = { ...current };
  for (const state of snapshot) next[state.provider] = mergePullBridgeState(state, pullBridge.get(state.provider));
  return next;
}

function preflightNotice(result: Extract<RunWorkflowResult, { ok: false }>, locale: Locale): string {
  const text = workbenchText(locale);
  const parts: string[] = [];
  if (result.preflight.unavailable.length > 0) {
    parts.push(text.t('chatPreflightUnavailable', {
      providers: result.preflight.unavailable.map((provider) => AI_PROVIDERS[provider].name).join(', '),
    }));
  }
  if (result.preflight.aliased.length > 0) {
    parts.push(text.t('chatPreflightAliased', {
      providers: result.preflight.aliased.map((provider) => AI_PROVIDERS[provider].name).join(', '),
    }));
  }
  return parts.length > 0 ? parts.join(' ') : text.t('chatSendFailed');
}

export function useChatRuntime({
  enabled,
  locale,
  isDesktop: isDesktopOverride,
  host: hostOverride,
  runWorkflow: runWorkflowOverride,
  startBridgePull: startBridgePullOverride,
}: ChatRuntimeOptions): ChatRuntime {
  const runtimeHost = hostOverride ?? defaultHost;
  const executeWorkflow = runWorkflowOverride ?? defaultRunWorkflow;
  const startPull = startBridgePullOverride ?? defaultStartBridgePull;
  const [initial] = useState(() => {
    const loaded = loadConversationSessions();
    const sessions = loaded.length > 0 ? loaded : [createConversationSession()];
    const activeReplies = repliesFromSession(sessions[0].messages);
    const lastSuccessfulReplies = sessions
      .map((session) => repliesFromSession(session.messages))
      .find((replies) => CHAT_PROVIDERS.some((provider) => replies[provider]?.status === 'completed'));
    return {
      sessions,
      activeSessionId: sessions[0].id,
      replyStates: activeReplies,
      comparisonTargets: Object.keys(activeReplies).filter(isProvider) as AIProvider[],
      selectedTargets: CHAT_PROVIDERS.filter((provider) => lastSuccessfulReplies?.[provider]?.status === 'completed'),
    };
  });
  const [sessions, setSessions] = useState<ConversationSession[]>(initial.sessions);
  const [activeSessionId, setActiveSessionId] = useState(initial.activeSessionId);
  const [providerStates, setProviderStates] = useState<Record<AIProvider, ProviderState>>(initialProviderStates);
  const providerStatesRef = useRef(providerStates);
  const [replyStates, setReplyStates] = useState<Partial<Record<AIProvider, ProviderReplyState>>>(initial.replyStates);
  const [comparisonTargets, setComparisonTargets] = useState<AIProvider[]>(initial.comparisonTargets);
  const [selectedTargets, setSelectedTargets] = useState<AIProvider[]>(initial.selectedTargets);
  const [busyStartedAt, setBusyStartedAt] = useState<Partial<Record<AIProvider, number>>>({});
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<ChatRuntimeNotice>();
  const [desktopAvailable, setDesktopAvailable] = useState(false);
  const sessionsRef = useRef(sessions);
  const sessionsDirtyRef = useRef(false);
  const activeSessionIdRef = useRef(activeSessionId);
  const desktopAvailableRef = useRef(false);
  const pullBridgeRef = useRef(new Map<AIProvider, PullBridgeState>());
  const activeResponsesRef = useRef(new Map<AIProvider, ActiveProviderResponse>());
  const busyProvidersRef = useRef(new Set<AIProvider>());
  const activeWorkflowRunRef = useRef<string | undefined>(undefined);
  const busyStartedAtRef = useRef(new Map<AIProvider, number>());
  const runSessionByProviderRef = useRef(new Map<AIProvider, string>());
  const runIdByProviderRef = useRef(new Map<AIProvider, string>());
  const forwardedFromByProviderRef = useRef(new Map<AIProvider, AIProvider>());
  const requestByProviderRef = useRef(new Map<AIProvider, ProviderRequest>());
  const successfulByRunRef = useRef(new Map<string, Set<AIProvider>>());
  const pendingProviderResetsRef = useRef(new Set<AIProvider>(CHAT_PROVIDERS));

  const activeSession = (sessions.find((session) => session.id === activeSessionId) ?? sessions[0])!;
  const busyProviders = Object.keys(busyStartedAt).filter((provider) => busyStartedAt[provider as AIProvider] !== undefined) as AIProvider[];
  const hasBusyProviders = busyProviders.length > 0;

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    providerStatesRef.current = providerStates;
  }, [providerStates]);

  useEffect(() => {
    sessionsRef.current = sessions;
    sessionsDirtyRef.current = true;
  }, [sessions]);

  useEffect(() => {
    if (!enabled) return;
    const timer = globalThis.setInterval(() => {
      if (!sessionsDirtyRef.current) return;
      sessionsDirtyRef.current = false;
      saveConversationSessionsWithQuotaRecovery(sessionsRef.current);
    }, 250);
    return () => {
      globalThis.clearInterval(timer);
      if (sessionsDirtyRef.current) saveConversationSessionsWithQuotaRecovery(sessionsRef.current);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !hasBusyProviders) return;
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, [enabled, hasBusyProviders]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let cleanupPull: (() => void) | undefined;
    let cleanupUpdates: (() => void) | undefined;
    let cleanupBridge: (() => void) | undefined;
    let desktop = false;
    try {
      desktop = isDesktopOverride ?? runtimeHost.app.isDesktop();
    } catch {
      desktop = false;
    }
    desktopAvailableRef.current = desktop;
    void Promise.resolve().then(() => {
      if (!disposed) setDesktopAvailable(desktop);
    });
    if (!desktop) return () => { disposed = true; desktopAvailableRef.current = false; };

    const handleBridgeMessage = (message: BridgeMessage) => {
      if (message.action === 'STATUS_REPORT' && message.provider) {
        const payload = message.payload as { bridge?: 'ok' | 'degraded'; reason?: string } | undefined;
        if (payload?.bridge) {
          if (message.transport === 'local') {
            if (payload.bridge === 'degraded') pullBridgeRef.current.set(message.provider, { bridge: 'degraded', reason: payload.reason });
            else pullBridgeRef.current.delete(message.provider);
          }
          setProviderStates((current) => ({
            ...current,
            [message.provider as AIProvider]: {
              ...(current[message.provider as AIProvider] ?? emptyProviderState(message.provider as AIProvider)),
              bridge: payload.bridge,
              bridgeReason: payload.reason,
            },
          }));
        }
        return;
      }
      if (message.action === 'ROLE_ASSIGNMENT') {
        const provider = providerFromRoleAssignment(message);
        if (!provider) return;
        const payload = message.payload as { label?: unknown } | undefined;
        activeResponsesRef.current.set(
          provider,
          createActiveProviderResponse(provider, typeof payload?.label === 'string' ? payload.label : undefined),
        );
        return;
      }
      if (!isRenderableResponseMessage(message) || !message.provider) return;
      const provider = message.provider;
      let active = activeResponsesRef.current.get(provider);
      if (!active) {
        active = createActiveProviderResponse(provider);
        activeResponsesRef.current.set(provider, active);
      }
      const { content, truncated } = renderablePayload(message.payload);
      const isFinal = message.action === 'RESPONSE_DONE';
      const forwardedFrom = forwardedFromByProviderRef.current.get(provider);
      const runId = runIdByProviderRef.current.get(provider);
      const sessionId = runSessionByProviderRef.current.get(provider) ?? activeSessionIdRef.current;
      const status = isFinal ? classifyResponseContent(content) : 'generating';
      const startedAt = busyStartedAtRef.current.get(provider) ?? Date.now();

      setSessions((current) => {
        const session = current.find((candidate) => candidate.id === sessionId);
        if (!session) return current;
        const existing = session.messages.find((item) => item.id === active?.id);
        const nextMessage: ConversationSessionMessage = {
          id: active!.id,
          role: 'ai',
          content,
          provider,
          ...(active?.label ? { modeRole: active.label } : existing?.modeRole ? { modeRole: existing.modeRole } : {}),
          ...(forwardedFrom ? { forwardedFrom } : existing?.forwardedFrom ? { forwardedFrom: existing.forwardedFrom } : {}),
          final: isFinal,
          truncated,
        };
        const messages = existing
          ? session.messages.map((item) => item.id === active!.id ? nextMessage : item)
          : [...session.messages, nextMessage];
        return upsertConversationSession(current, { ...session, messages, updatedAt: Date.now() });
      });

      if (sessionId === activeSessionIdRef.current) {
        setReplyStates((current) => ({
          ...current,
          [provider]: {
            status,
            content,
            startedAt,
            ...(truncated ? { truncated: true } : {}),
            ...(forwardedFrom ? { forwardedFrom } : {}),
            ...(status === 'failed' || status === 'timedOut' ? { error: content } : {}),
          },
        }));
      }

      if (!isFinal) return;
      if (runId) {
        const successful = successfulByRunRef.current.get(runId) ?? new Set<AIProvider>();
        if (status === 'completed') successful.add(provider);
        else successful.delete(provider);
        successfulByRunRef.current.set(runId, successful);
      }
      activeResponsesRef.current.delete(provider);
    };

    void startPull().then((cleanup) => {
      if (disposed) cleanup();
      else cleanupPull = cleanup;
    }).catch((error: unknown) => {
      if (!disposed) setNotice({ tone: 'unknown', message: error instanceof Error ? error.message : String(error) });
    });
    void runtimeHost.connections.get().then((snapshot) => {
      if (disposed) return;
      setProviderStates((current) => latestProviderStates(snapshot, current, pullBridgeRef.current));
    }).catch((error: unknown) => {
      if (!disposed) setNotice({ tone: 'unknown', message: error instanceof Error ? error.message : String(error) });
    });
    void runtimeHost.connections.onUpdate((state) => {
      const merged = mergePullBridgeState(state, pullBridgeRef.current.get(state.provider));
      setProviderStates((current) => ({ ...current, [state.provider]: merged }));
    }).then((cleanup) => {
      if (disposed) cleanup();
      else cleanupUpdates = cleanup;
    }).catch((error: unknown) => {
      if (!disposed) setNotice({ tone: 'unknown', message: error instanceof Error ? error.message : String(error) });
    });
    void runtimeHost.bridge.onMessage(handleBridgeMessage).then((cleanup) => {
      if (disposed) cleanup();
      else cleanupBridge = cleanup;
    }).catch((error: unknown) => {
      if (!disposed) setNotice({ tone: 'unknown', message: error instanceof Error ? error.message : String(error) });
    });

    return () => {
      disposed = true;
      desktopAvailableRef.current = false;
      cleanupPull?.();
      cleanupUpdates?.();
      cleanupBridge?.();
    };
  }, [enabled, isDesktopOverride, runtimeHost, startPull]);

  const appendMessage = useCallback((sessionId: string, message: ConversationSessionMessage) => {
    setSessions((current) => {
      const session = current.find((candidate) => candidate.id === sessionId);
      if (!session) return current;
      const messages = [...session.messages, message];
      const title = session.title === DEFAULT_CONVERSATION_SESSION_TITLE
        ? titleFromFirstUserMessage(messages)
        : session.title;
      return upsertConversationSession(current, { ...session, title, messages, updatedAt: Date.now() });
    });
  }, []);

  const clearRun = useCallback((runId: string, providers: readonly AIProvider[]) => {
    const released: AIProvider[] = [];
    for (const provider of providers) {
      if (runIdByProviderRef.current.get(provider) !== runId) continue;
      busyProvidersRef.current.delete(provider);
      busyStartedAtRef.current.delete(provider);
      runIdByProviderRef.current.delete(provider);
      runSessionByProviderRef.current.delete(provider);
      forwardedFromByProviderRef.current.delete(provider);
      activeResponsesRef.current.delete(provider);
      released.push(provider);
    }
    if (released.length > 0) {
      setBusyStartedAt((current) => {
        const next = { ...current };
        for (const provider of released) delete next[provider];
        return next;
      });
    }
  }, []);

  const runSend = useCallback(async (
    rawText: string,
    requestedTargets: AIProvider[],
    presetId: ChatSendPresetId,
    options: SendOptions = {},
  ): Promise<boolean> => {
    const text = rawText;
    const targets = [...new Set(requestedTargets)];
    if (!text.trim()) {
      setNotice({ tone: 'unknown', message: workbenchText(locale).t('chatNoQuestion') });
      return false;
    }
    if (!desktopAvailableRef.current) {
      setNotice({ tone: 'unknown', message: workbenchText(locale).t('chatDesktopOnly') });
      return false;
    }
    const mode: ChatMode = presetId;
    const roles = presetId === 'free' ? undefined : defaultRolesForPreset(mode, presetId);
    const participants = presetId === 'free'
      ? targets
      : [...new Set(Object.values(roles ?? {}).filter(isProvider))];
    if (participants.length === 0) {
      setNotice({ tone: 'unknown', message: workbenchText(locale).t('chatNoTarget') });
      return false;
    }
    const blockedByBusy = busyTargets(participants, busyProvidersRef.current);
    if (blockedByBusy.length > 0) {
      setNotice({
        tone: 'unknown',
        message: workbenchText(locale).t('chatBusyNotice', {
          providers: blockedByBusy.map((provider) => AI_PROVIDERS[provider].name).join(', '),
        }),
      });
      return false;
    }

    if (activeWorkflowRunRef.current) {
      const currentBusy = [...busyProvidersRef.current];
      setNotice({
        tone: 'unknown',
        message: workbenchText(locale).t('chatBusyNotice', {
          providers: currentBusy.map((provider) => AI_PROVIDERS[provider].name).join(', '),
        }),
      });
      return false;
    }
    const sessionId = activeSessionId;
    const session = sessions.find((candidate) => candidate.id === sessionId) ?? activeSession;
    const context = options.forwardedFrom ? undefined : buildConversationReplayContext(session.messages);
    const startedAt = Date.now();
    const runId = createConversationMessageId('chat-run');
    activeWorkflowRunRef.current = runId;
    successfulByRunRef.current.set(runId, new Set());
    for (const provider of participants) {
      busyProvidersRef.current.add(provider);
      busyStartedAtRef.current.set(provider, startedAt);
      runSessionByProviderRef.current.set(provider, sessionId);
      runIdByProviderRef.current.set(provider, runId);
      requestByProviderRef.current.set(provider, { text, presetId, sessionId, ...(options.forwardedFrom ? { forwardedFrom: options.forwardedFrom } : {}) });
      if (options.forwardedFrom) forwardedFromByProviderRef.current.set(provider, options.forwardedFrom);
      else forwardedFromByProviderRef.current.delete(provider);
    }
    setBusyStartedAt((current) => ({
      ...current,
      ...Object.fromEntries(participants.map((provider) => [provider, startedAt])),
    }));
    setNotice(undefined);
    if (options.preserveComparison) {
      setComparisonTargets((current) => [...new Set([...current, ...participants])]);
      setReplyStates((current) => {
        const next = { ...current };
        for (const provider of participants) next[provider] = { status: 'generating', content: '', startedAt, ...(options.forwardedFrom ? { forwardedFrom: options.forwardedFrom } : {}) };
        return next;
      });
    } else {
      setComparisonTargets(participants);
      setReplyStates(() => {
        const next: Partial<Record<AIProvider, ProviderReplyState>> = {};
        for (const provider of CHAT_PROVIDERS) {
          next[provider] = participants.includes(provider)
            ? { status: 'generating', content: '', startedAt }
            : { status: 'notSent', content: '', notSentReason: 'not-selected' };
        }
        return next;
      });
    }
    appendMessage(sessionId, {
      id: createConversationMessageId('user'),
      role: 'user',
      content: text,
      ...(options.forwardedFrom ? { forwardedFrom: options.forwardedFrom } : {}),
      final: true,
    });

    let runTargets: AIProvider[] = [...participants];
    let latestStates = providerStates;
    try {
      const preparation = await Promise.all(participants.map(async (provider) => {
        try {
          let current = latestStates[provider] ?? emptyProviderState(provider);
          if (current.webview !== 'loaded') {
            current = await runtimeHost.provider.open(provider, OFFSCREEN_BOUNDS);
            setProviderStates((states) => ({ ...states, [provider]: mergePullBridgeState(current, pullBridgeRef.current.get(provider)) }));
          }
          await runtimeHost.provider.park(provider, OFFSCREEN_BOUNDS);
          return { provider, error: undefined as unknown, state: current };
        } catch (error) {
          return { provider, error, state: undefined as ProviderState | undefined };
        }
      }));
      for (const item of preparation) {
        if (!item.error && item.state) {
          latestStates = {
            ...latestStates,
            [item.provider]: mergePullBridgeState(item.state, pullBridgeRef.current.get(item.provider)),
          };
        }
      }
      const openFailures = preparation.filter((item) => item.error !== undefined);
      if (openFailures.length > 0) {
        const failed = new Set(openFailures.map((item) => item.provider));
        setReplyStates((current) => {
          const next = { ...current };
          for (const provider of failed) {
            next[provider] = { status: 'failed', content: '', error: workbenchText(locale).t('chatSendFailed') };
          }
          return next;
        });
        setNotice({
          tone: 'block',
          message: openFailures.map((item) => `${AI_PROVIDERS[item.provider].name}: ${item.error instanceof Error ? item.error.message : String(item.error)}`).join(' · '),
        });
        if (presetId !== 'free') {
          runTargets = [];
          setReplyStates((current) => {
            const next = { ...current };
            for (const provider of participants) {
              if (!failed.has(provider)) next[provider] = { status: 'notSent', content: '', notSentReason: 'not-ready' };
            }
            return next;
          });
        } else {
          runTargets = runTargets.filter((provider) => !failed.has(provider));
        }
      }

      try {
        const snapshot = await runtimeHost.connections.get();
        const refreshed = latestProviderStates(snapshot, latestStates, pullBridgeRef.current);
        for (const item of preparation) {
          if (!item.error && item.state?.webview === 'loaded' && refreshed[item.provider].webview !== 'loaded') {
            refreshed[item.provider] = { ...refreshed[item.provider], webview: 'loaded' };
          }
        }
        latestStates = refreshed;
        setProviderStates(latestStates);
      } catch {
        // Keep the last known snapshot; the workflow preflight will report what it cannot confirm.
      }

      const freshenTargets = pendingProviderSessionResets(
        pendingProviderResetsRef.current,
        runTargets,
        (provider) => latestStates[provider]?.webview === 'loaded',
      );
      if (freshenTargets.length > 0) {
        setNotice({ tone: 'neutral', message: workbenchText(locale).t('chatPreparingSession') });
        let freshened: AIProvider[] = [];
        let resetFailures = new Set<AIProvider>();
        try {
          await ensureFreshProviderSessions(freshenTargets, {
            resetBootState: resetProviderBootState,
            newSession: (provider) => runtimeHost.provider.newSession(provider),
          });
          freshened = [...freshenTargets];
        } catch (error) {
          if (error instanceof ProviderSessionResetError) {
            freshened = [...error.completedProviders];
            resetFailures = new Set(error.failures.map((failure) => failure.provider));
            setNotice({
              tone: 'block',
              message: workbenchText(locale).t('chatSessionResetFailed', {
                providers: error.failures.map((failure) => AI_PROVIDERS[failure.provider].name).join(', '),
              }),
            });
          } else {
            resetFailures = new Set(freshenTargets);
            setNotice({ tone: 'block', message: error instanceof Error ? error.message : String(error) });
          }
        }
        for (const provider of freshened) pendingProviderResetsRef.current.delete(provider);
        if (resetFailures.size > 0) {
          setReplyStates((current) => {
            const next = { ...current };
            for (const provider of resetFailures) {
              next[provider] = { status: 'failed', content: '', error: workbenchText(locale).t('chatSessionResetFailed', { providers: AI_PROVIDERS[provider].name }) };
            }
            if (presetId !== 'free') {
              for (const provider of participants) {
                if (!resetFailures.has(provider)) next[provider] = { status: 'notSent', content: '', notSentReason: 'not-ready' };
              }
            }
            return next;
          });
          runTargets = presetId === 'free' ? runTargets.filter((provider) => !resetFailures.has(provider)) : [];
        }
        await waitForProvidersSendable(freshened, () => providerStatesRef.current);
        try {
          const snapshot = await runtimeHost.connections.get();
          latestStates = latestProviderStates(snapshot, latestStates, pullBridgeRef.current);
          setProviderStates(latestStates);
        } catch {
          // Keep the last observed state and let the sendability gate below decide per provider.
        }
        if (resetFailures.size === 0 && openFailures.length === 0) setNotice(undefined);
      }

      if (presetId === 'free') {
        const ready = runTargets.filter((provider) => isSendable(latestStates[provider]));
        const notReady = runTargets.filter((provider) => !isSendable(latestStates[provider]));
        if (notReady.length > 0) {
          setReplyStates((current) => {
            const next = { ...current };
            for (const provider of notReady) {
              const login = deriveLoginState(latestStates[provider]);
              next[provider] = {
                status: 'notSent',
                content: current[provider]?.content ?? '',
                notSentReason: login === 'loggedOut' ? 'not-logged-in' : login === 'unknown' ? 'not-probed' : 'not-ready',
              };
            }
            return next;
          });
          setNotice({
            tone: 'unknown',
            message: workbenchText(locale).t('chatNotReadyNotice', {
              providers: notReady.map((provider) => AI_PROVIDERS[provider].name).join(', '),
            }),
          });
        }
        runTargets = ready;
        const skipped = participants.filter((provider) => !ready.includes(provider));
        clearRun(runId, skipped);
      }

      if (runTargets.length === 0) {
        clearRun(runId, participants);
        return false;
      }

      const result = await executeWorkflow({
        text,
        context,
        mode,
        presetId: presetId as WorkflowPresetId,
        roles,
        targets: presetId === 'free' ? runTargets : undefined,
        activeProviders: [...CHAT_PROVIDERS],
        locale,
      });
      if (!result.ok) {
        setNotice({ tone: 'block', message: preflightNotice(result, locale) });
        setReplyStates((current) => {
          const next = { ...current };
          for (const provider of runTargets) {
            if (next[provider]?.status === 'generating') {
              next[provider] = { status: 'notSent', content: next[provider]?.content ?? '', notSentReason: 'not-ready' };
            }
          }
          return next;
        });
      }
      return result.ok;
    } catch (error) {
      setNotice({ tone: 'block', message: error instanceof Error ? error.message : String(error) });
      setReplyStates((current) => {
        const next = { ...current };
        for (const provider of runTargets) {
          if (next[provider]?.status === 'generating') {
            next[provider] = { status: 'failed', content: next[provider]?.content ?? '', error: error instanceof Error ? error.message : String(error) };
          }
        }
        return next;
      });
      return false;
    } finally {
      const owned = runTargets.filter((provider) => runIdByProviderRef.current.get(provider) === runId);
      if (owned.length > 0) {
        setReplyStates((current) => settlePendingTargets(owned, current, latestStates));
      }
      const successful = [...(successfulByRunRef.current.get(runId) ?? new Set<AIProvider>())];
      if (successful.length > 0) {
        setSelectedTargets(successful);
      }
      successfulByRunRef.current.delete(runId);
      clearRun(runId, participants);
      if (activeWorkflowRunRef.current === runId) activeWorkflowRunRef.current = undefined;
    }
  }, [activeSession, activeSessionId, appendMessage, clearRun, executeWorkflow, locale, providerStates, runtimeHost, sessions]);

  const sendMessage = useCallback(
    (text: string, targets: AIProvider[], presetId: ChatSendPresetId) => runSend(text, targets, presetId),
    [runSend],
  );

  const forwardMessage = useCallback(
    (source: AIProvider, original: string, targets: AIProvider[], note: string) => {
      if (replyStates[source]?.truncated) {
        setNotice({ tone: 'block', message: workbenchText(locale).t('chatForwardTruncated') });
        return Promise.resolve(false);
      }
      const message = buildForwardMessage(AI_PROVIDERS[source].name, original, note);
      return runSend(message, targets, 'free', { forwardedFrom: source, preserveComparison: true });
    },
    [locale, replyStates, runSend],
  );

  const retryProvider = useCallback((provider: AIProvider) => {
    const request = requestByProviderRef.current.get(provider);
    if (!request || request.sessionId !== activeSessionId) {
      const lastUserMessage = [...activeSession.messages].reverse().find((message) => message.role === 'user');
      const retryText = lastUserMessage?.content ?? lastUserQuestion(activeSession.messages) ?? '';
      if (lastUserMessage?.forwardedFrom) {
        return runSend(retryText, [provider], 'free', {
          forwardedFrom: lastUserMessage.forwardedFrom,
          preserveComparison: true,
        });
      }
      const sessionPreset: ChatSendPresetId = activeSession.presetId === 'deliberation'
        ? 'free'
        : activeSession.mode === 'debate' || activeSession.mode === 'consult'
          ? activeSession.mode
          : 'free';
      return runSend(retryText, [provider], sessionPreset);
    }
    if (request.forwardedFrom) return runSend(request.text, [provider], 'free', { forwardedFrom: request.forwardedFrom, preserveComparison: true });
    return runSend(request.text, request.presetId === 'free' ? [provider] : CHAT_PROVIDERS.filter((candidate) => comparisonTargets.includes(candidate)), request.presetId);
  }, [activeSession.messages, comparisonTargets, runSend]);

  const skipProvider = useCallback((provider: AIProvider) => {
    setSelectedTargets((current) => current.filter((candidate) => candidate !== provider));
    setComparisonTargets((current) => current.filter((candidate) => candidate !== provider));
    setReplyStates((current) => ({
      ...current,
      [provider]: { status: 'notSent', content: '', notSentReason: 'not-selected' },
    }));
  }, []);

  const newConversation = useCallback(() => {
    const session = createConversationSession();
    pendingProviderResetsRef.current = new Set(CHAT_PROVIDERS);
    setSessions((current) => upsertConversationSession(current, session));
    activeSessionIdRef.current = session.id;
    setActiveSessionId(session.id);
    setReplyStates({});
    setComparisonTargets([]);
    setNotice(undefined);
  }, []);

  const selectSession = useCallback((session: ConversationSession) => {
    if (activeSessionIdRef.current !== session.id) pendingProviderResetsRef.current = new Set(CHAT_PROVIDERS);
    activeSessionIdRef.current = session.id;
    setActiveSessionId(session.id);
    const hydrated = repliesFromSession(session.messages);
    const busyForSession = [...busyProvidersRef.current].filter((provider) => runSessionByProviderRef.current.get(provider) === session.id);
    for (const provider of busyForSession) {
      if (activeResponsesRef.current.has(provider)) {
        hydrated[provider] = {
          status: 'generating',
          content: hydrated[provider]?.content ?? '',
          startedAt: busyStartedAtRef.current.get(provider) ?? Date.now(),
          ...(forwardedFromByProviderRef.current.get(provider) ? { forwardedFrom: forwardedFromByProviderRef.current.get(provider) } : {}),
        };
      }
    }
    setReplyStates(hydrated);
    setComparisonTargets([...new Set([...Object.keys(hydrated).filter(isProvider), ...busyForSession])]);
    setNotice(undefined);
  }, []);

  const renameSession = useCallback((sessionId: string, title: string) => {
    setSessions((current) => {
      const session = current.find((candidate) => candidate.id === sessionId);
      if (!session) return current;
      return upsertConversationSession(current, { ...session, title, updatedAt: Date.now() });
    });
  }, []);

  const deleteSession = useCallback((sessionId: string) => {
    const remaining = removeConversationSession(sessions, sessionId);
    if (remaining.length > 0) {
      setSessions(remaining);
      if (activeSessionId === sessionId) selectSession(remaining[0]);
      return;
    }
    const replacement = createConversationSession();
    pendingProviderResetsRef.current = new Set(CHAT_PROVIDERS);
    setSessions([replacement]);
    activeSessionIdRef.current = replacement.id;
    setActiveSessionId(replacement.id);
    setReplyStates({});
    setComparisonTargets([]);
    setNotice(undefined);
  }, [activeSessionId, selectSession, sessions]);

  const clearNotice = useCallback(() => setNotice(undefined), []);
  const updateSelectedTargets = useCallback((targets: AIProvider[]) => setSelectedTargets([...new Set(targets)]), []);
  const setPreset = useCallback((presetId: import('./chatModel').ChatPresetId) => {
    setSessions((current) => {
      const session = current.find((candidate) => candidate.id === activeSessionId);
      if (!session) return current;
      const mode: ChatMode = presetId === 'deliberation' ? 'consult' : presetId;
      const next: ConversationSession = { ...session, mode, updatedAt: Date.now() };
      if (presetId === 'deliberation') next.presetId = 'deliberation';
      else delete next.presetId;
      return upsertConversationSession(current, next);
    });
  }, [activeSessionId]);

  return {
    providerStates,
    sessions,
    activeSessionId,
    activeSession,
    replyStates,
    comparisonTargets,
    selectedTargets,
    busyProviders,
    now,
    notice,
    setSelectedTargets: updateSelectedTargets,
    clearNotice,
    newConversation,
    selectSession,
    renameSession,
    deleteSession,
    sendMessage,
    forwardMessage,
    retryProvider,
    skipProvider,
    setPreset,
    desktopAvailable,
  };
}
