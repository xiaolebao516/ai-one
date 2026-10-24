import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AI_PROVIDERS } from '../../../shared/constants';
import { providerInstanceName } from '../../../shared/providerInstances';
import type { AIProvider, ProviderInstance } from '../../../shared/types';
import { host } from '../../host';
import type { Locale } from '../../i18n/resolve';
import { Badge, Button, Card, Notice, SectionHeader } from '../../ui/v2';
import { ChatLedController } from '../../workflow/chatLed/controller';
import { executeCleanup, planCleanup, type CleanupPlanItem } from '../../workflow/chatLed/cleanup';
import { createChatGptCleaner } from '../../workflow/chatLed/drivers/chatgpt';
import { createClaudeCleaner } from '../../workflow/chatLed/drivers/claude';
import { createGeminiCleaner } from '../../workflow/chatLed/drivers/gemini';
import { createRealChatLedEnv, prepareProviderPage } from '../../workflow/chatLed/env';
import { exportRunMarkdown } from '../../workflow/chatLed/exportMarkdown';
import { appendCleanupResult, beginCleanup, closeRun, finishCleanup, interruptCleanup, isRunActive, recordExport } from '../../workflow/chatLed/machine';
import { setRunPages } from '../../workflow/chatLed/runPages';
import { loadRuns, saveRunChecked } from '../../workflow/chatLed/store';
import type { ChatLedMode, ChatLedRun } from '../../workflow/chatLed/types';
import { workbenchText } from '../workbenchText';
import { ChatLedView } from './ChatLedView';

/** Providers the coordinator may address (the coordinator itself is excluded by the controller). */
const CANDIDATES: AIProvider[] = ['claude', 'gemini', 'grok'];
const EXTRA_WORKERS: readonly ProviderInstance[] = ['chatgpt#2', 'chatgpt#3'];
const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(AI_PROVIDERS).map(([key, info]) => [key, info.name]),
);

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The unsent task text survives leaving the tab and restarting the app (#196). Local only. */
const DRAFT_KEY = 'ai-one:chat-led:draft:v1';

function readDraft(storage: Storage | undefined): string {
  try {
    return storage?.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(storage: Storage | undefined, draft: string): void {
  try {
    if (draft) storage?.setItem(DRAFT_KEY, draft);
    else storage?.removeItem(DRAFT_KEY);
  } catch {
    // Storage full or unavailable: the draft still lives in the mounted page.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function newRunId(): string {
  return `chatled-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`;
}

function wideBounds(): DOMRectReadOnly {
  const width = Math.max(480, Math.floor(window.innerWidth * 0.55));
  const height = Math.max(360, window.innerHeight - 140);
  const x = window.innerWidth - width - 16;
  const y = 96;
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
}

function offscreenBounds(width = 420, height = 320): DOMRectReadOnly {
  return { x: -10_000, y: -10_000, width, height, top: -10_000, left: -10_000, right: -10_000 + width, bottom: -10_000 + height, toJSON: () => ({}) };
}

/**
 * Chat-led task entry and live page (#113). Intentionally standalone: the overview composer (L4)
 * will call the same start path later. Live runs are owned by controllers kept in a ref; stored
 * runs from earlier sessions are shown read-only (plus export / cleanup / close).
 */
export function ChatLedPage({ locale }: { locale: Locale }) {
  const text = workbenchText(locale);
  const storage = useMemo(browserStorage, []);
  const [runs, setRuns] = useState<ChatLedRun[]>(() => loadRuns(storage));
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [goal, setGoal] = useState(() => readDraft(storage));
  useEffect(() => writeDraft(storage, goal), [storage, goal]);
  const [mode, setMode] = useState<ChatLedMode>('general');
  const [workers, setWorkers] = useState<0 | 1 | 2>(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [takeover, setTakeover] = useState<ProviderInstance | undefined>();
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const controllers = useRef(new Map<string, ChatLedController>());
  const persistedRef = useRef(true); // did the latest write really reach storage?
  const runsRef = useRef(runs);
  runsRef.current = runs;

  const persist = useCallback(
    (run: ChatLedRun) => {
      const saved = saveRunChecked(storage, run, runsRef.current);
      persistedRef.current = saved.persisted;
      runsRef.current = saved.runs;
      setRuns(saved.runs);
      if (!saved.persisted) setError(text.t('chatLedRunPersistFailed'));
      return saved.persisted;
    },
    [storage, text],
  );

  const cleaners = useMemo(
    () => [
      createChatGptCleaner({
        evalInPage: (js) => host.provider.evalWithCallback('chatgpt', js),
        reload: () => host.provider.reload('chatgpt'),
        navigate: async (url) => {
          await host.provider.eval('chatgpt', `location.href = ${JSON.stringify(url)}`);
          await sleep(4_000);
        },
        sleep,
      }),
      createClaudeCleaner({
        evalInPage: (js) => host.provider.evalWithCallback('claude', js),
        reload: () => host.provider.reload('claude'),
        navigate: async (url) => {
          await host.provider.eval('claude', `location.href = ${JSON.stringify(url)}`);
          await sleep(4_000);
        },
        sleep,
      }),
      createGeminiCleaner({
        evalInPage: (js) => host.provider.evalWithCallback('gemini', js),
        reload: () => host.provider.reload('gemini'),
        navigate: async (url) => {
          await host.provider.eval('gemini', `location.href = ${JSON.stringify(url)}`);
          await sleep(4_000);
        },
        sleep,
      }),
    ],
    [],
  );

  useEffect(() => () => {
    // The workbench keeps this page mounted across tabs (#196), so this runs only when the workbench
    // itself goes away: stop live runs that are still going to avoid orphaned sends.
    for (const controller of controllers.current.values()) {
      const phase = controller.getRun().phase;
      if (phase === 'coordinator-thinking' || phase === 'forwarding' || phase === 'paused') void controller.stop();
    }
  }, []);

  // One active chat-led run at a time: runs share the same provider pages and workflow state.
  const activeRun = runs.find((run) => controllers.current.has(run.id) && isRunActive(run));

  // Pages the live run uses stay live (offscreen, never hidden) while the user is on another tab.
  const runPagesKey = activeRun
    ? [...new Set([activeRun.coordinator, ...activeRun.available, ...activeRun.forwards.map((forward) => forward.to)])].join('|')
    : '';
  useEffect(() => {
    setRunPages(runPagesKey ? (runPagesKey.split('|') as ProviderInstance[]) : []);
  }, [runPagesKey]);
  useEffect(() => () => setRunPages([]), []);

  const start = async () => {
    const trimmed = goal.trim();
    if (!trimmed || starting) return;
    if (activeRun) {
      setError(text.t('chatLedActiveRunNotice'));
      return;
    }
    setStarting(true);
    setError(undefined);
    try {
      const env = createRealChatLedEnv();
      const controller = await ChatLedController.create(env, { id: newRunId(), goal: trimmed, candidates: [...CANDIDATES, ...EXTRA_WORKERS.slice(0, workers)], mode, workers });
      controllers.current.set(controller.getRun().id, controller);
      persist(controller.getRun());
      if (!persistedRef.current) {
        controllers.current.delete(controller.getRun().id);
        const remaining = runsRef.current.filter((run) => run.id !== controller.getRun().id);
        runsRef.current = remaining;
        setRuns(remaining);
        setError(text.t('chatLedRunPersistFailed'));
        return;
      }
      controller.subscribe(persist);
      setSelectedId(controller.getRun().id);
      setGoal('');
      void controller.start();
    } catch (cause) {
      setError(text.t('chatLedStartFailed', { message: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setStarting(false);
    }
  };

  const selected = runs.find((run) => run.id === selectedId);

  if (!selected) {
    return (
      <div className="mx-auto grid max-w-[1180px] grid-cols-[minmax(0,1fr)] gap-v2-lg p-v2-page">
        <header>
          <h1 className="text-[24px] font-semibold leading-tight text-v2-ink">{text.t('chatLedPageTitle')}</h1>
          <p className="mt-v2-xs text-v2-meta text-v2-ink-2">{text.t('chatLedPageIntro')}</p>
        </header>
        <Card>
          <div className="grid gap-v2-sm">
            <label htmlFor="chatled-goal" className="text-v2-meta font-medium text-v2-ink">
              {text.t('chatLedGoalLabel')}
            </label>
            <textarea
              id="chatled-goal"
              className="min-h-[120px] w-full rounded-v2-md border border-v2-line bg-v2-surface p-v2-sm text-v2-body text-v2-ink"
              value={goal}
              placeholder={text.t('chatLedGoalPlaceholder')}
              onChange={(event) => setGoal(event.target.value)}
            />
            <label htmlFor="chatled-mode" className="text-v2-meta font-medium text-v2-ink">
              {text.zh ? '协作模式' : 'Collaboration mode'}
            </label>
            <select
              id="chatled-mode"
              aria-label={text.zh ? '协作模式' : 'Collaboration mode'}
              className="w-full rounded-v2-md border border-v2-line bg-v2-surface p-v2-sm text-v2-body text-v2-ink"
              value={mode}
              onChange={(event) => setMode(event.target.value as ChatLedMode)}
            >
              <option value="general">{text.zh ? '通用' : 'General'}</option>
              <option value="repo">{text.zh ? '仓库协作（仅文案约束）' : 'Repository (instructions only)'}</option>
              <option value="discuss">{text.zh ? '独立讨论' : 'Independent discussion'}</option>
            </select>
            <label htmlFor="chatled-workers" className="text-v2-meta font-medium text-v2-ink">{text.t('chatLedWorkersLabel')}</label>
            <select
              id="chatled-workers"
              aria-label={text.t('chatLedWorkersLabel')}
              className="w-full rounded-v2-md border border-v2-line bg-v2-surface p-v2-sm text-v2-body text-v2-ink"
              value={workers}
              onChange={(event) => {
                const count = Number(event.target.value);
                if (count === 0 || count === 1 || count === 2) setWorkers(count);
              }}
            >
              <option value={0}>{text.t('chatLedWorkersNone')}</option>
              <option value={1}>{text.t('chatLedWorkersOne')}</option>
              <option value={2}>{text.t('chatLedWorkersTwo')}</option>
            </select>
            <p className="text-v2-meta text-v2-ink-2">
              {text.t('chatLedCoordinatorLine', {
                name: AI_PROVIDERS.chatgpt.name,
                names: CANDIDATES.map((provider) => AI_PROVIDERS[provider].name).join(', '),
              })}
            </p>
            {error ? <Notice tone="block">{error}</Notice> : null}
            <div>
              <Button
                variant="primary"
                onClick={() => void start()}
                disabled={!goal.trim() || starting || Boolean(activeRun)}
                disabledReason={activeRun ? text.t('chatLedActiveRunNotice') : undefined}
                loading={starting}
              >
                {starting ? text.t('chatLedStarting') : text.t('chatLedStart')}
              </Button>
            </div>
          </div>
        </Card>
        <section aria-labelledby="chatled-history" className="grid grid-cols-[minmax(0,1fr)] gap-v2-sm">
          <SectionHeader id="chatled-history" title={text.t('chatLedHistory')} />
          {runs.length === 0 ? (
            <p className="text-v2-meta text-v2-ink-2">{text.t('chatLedHistoryEmpty')}</p>
          ) : (
            runs.map((run) => (
              <Card key={run.id}>
                <div className="flex items-center justify-between gap-v2-sm">
                  <div className="min-w-0">
                    <p className="truncate text-v2-body text-v2-ink">{run.goal}</p>
                    <p className="mt-v2-xs flex items-center gap-v2-xs text-v2-meta text-v2-ink-2">
                      <Badge tone={run.closed ? 'done' : 'unknown'}>{run.closed ? 'closed' : run.phase}</Badge>
                      <span>{new Date(run.createdAt).toLocaleString()}</span>
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setSelectedId(run.id)}>
                    {text.t('chatLedOpenRun')}
                  </Button>
                </div>
              </Card>
            ))
          )}
        </section>
      </div>
    );
  }

  const controller = controllers.current.get(selected.id);
  const pendingSessions = controller?.hasPendingSessions() ?? false;
  const cleanupRunning = cleanupBusy || Boolean(selected.cleanupRunning) || pendingSessions;
  // A closed run, or one whose cleanup outcome is already stored, is read-only: never offered again.
  const cleanupDone = Boolean(selected.closed) || selected.cleanupResults !== undefined || Boolean(selected.cleanupRunning);
  const extraInstances = [...new Set(selected.conversations.map((item) => item.provider).filter(
    (provider) => provider === 'chatgpt#2' || provider === 'chatgpt#3',
  ))];
  const runCleaners = [
    ...cleaners,
    ...extraInstances.map((instance) => ({
      ...createChatGptCleaner({
        evalInPage: (js: string) => host.provider.evalWithCallback(instance, js),
        reload: () => host.provider.reload(instance),
        navigate: async (url: string) => {
          await host.provider.eval(instance, `location.href = ${JSON.stringify(url)}`);
          await sleep(4_000);
        },
        sleep,
      }),
      instance,
    })),
  ];
  const plan: CleanupPlanItem[] | null =
    !cleanupDone && (selected.phase === 'finished' || selected.phase === 'stopped') ? planCleanup(selected, runCleaners) : null;
  const exportFile = selected.exportedAt ? `ai-one-chat-led-${selected.id}.md` : undefined;

  const doExport = () => {
    const markdown = exportRunMarkdown(selected, text.zh ? 'zh' : 'en');
    const file = `ai-one-chat-led-${selected.id}.md`;
    try {
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      if (controller) controller.markExported();
      else persist(recordExport(selected, Date.now()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // Applies a pure transition to the live controller's run, or to the stored run (read fresh each
  // time, so several quick per-item updates never overwrite each other).
  const apply = (transition: (run: ChatLedRun) => ChatLedRun) => {
    if (controller) controller.apply(transition);
    else {
      const current = runsRef.current.find((run) => run.id === selected.id);
      if (current) persist(transition(current));
    }
  };

  const doCleanup = async () => {
    // Cleanup is irreversible: it needs the click, a plan, an exported log, no other active run
    // (it drives the same ChatGPT page) and no session still being created. Checked again here.
    if (!plan || cleanupRunning || !selected.exportedAt || activeRun) return;
    setCleanupBusy(true);
    // The run is marked "cleanup running" and every confirmed item is stored right away, so a
    // reload in the middle never replays a deletion (see interruptCleanup).
    apply((run) => beginCleanup(run, Date.now()));
    if (!persistedRef.current) {
      // The "cleanup running" marker did not reach storage: a reload could replay deletions. Do nothing.
      apply((run) => interruptCleanup(run, Date.now()));
      setCleanupBusy(false);
      setError(text.t('chatLedPersistFailed'));
      return;
    }
    const prepared = new Set<ProviderInstance>();
    try {
      // Prepare every page first; a failed preparation prevents the entire destructive batch.
      for (const item of plan) {
        if (item.action === 'manual' || prepared.has(item.provider)) continue;
        await prepareProviderPage(item.provider);
        await host.provider.park(item.provider, offscreenBounds(1280, 900));
        prepared.add(item.provider);
        await sleep(2_500);
      }
      for (const item of plan) {
        await executeCleanup([item], runCleaners, {
          onProgress: (_index, result) => {
            apply((run) => appendCleanupResult(run, result, Date.now()));
            if (!persistedRef.current) throw new Error('Cleanup progress checkpoint could not be saved.');
          },
        });
      }
      apply((run) => finishCleanup(run, Date.now()));
      if (!persistedRef.current) throw new Error('Cleanup completion checkpoint could not be saved.');
    } catch (cause) {
      // A failed checkpoint or setup step leaves every unconfirmed conversation manual-only.
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      apply((run) => interruptCleanup(
        run.cleanupRunning ? run : { ...run, cleanupRunning: true },
        Date.now(),
        message,
      ));
    } finally {
      for (const provider of prepared) {
        await host.provider.park(provider, offscreenBounds()).catch(() => undefined);
      }
      setCleanupBusy(false);
    }
  };

  const doClose = () => {
    if (cleanupRunning) return;
    if (controller) controller.markClosed(Boolean(selected.exportedAt));
    else persist(closeRun(selected, Boolean(selected.exportedAt), Date.now()));
  };

  const doTakeOver = async (provider: ProviderInstance) => {
    controller?.pause();
    if (controller?.hasPendingSessions()) await controller.stop();
    setTakeover(provider);
    try {
      await host.provider.park(provider, wideBounds());
      await host.provider.show(provider, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const backFromTakeover = async () => {
    if (takeover) await host.provider.park(takeover, offscreenBounds()).catch(() => undefined);
    setTakeover(undefined);
  };

  return (
    <div className="mx-auto grid max-w-[1180px] gap-v2-md p-v2-page">
      <div>
        <Button size="sm" onClick={() => setSelectedId(undefined)}>
          {text.t('chatLedBackToList')}
        </Button>
      </div>
      {takeover ? (
        <Notice tone="you">
          <span>{text.zh ? `你正在自己操作 ${providerInstanceName(takeover, PROVIDER_LABELS)} 的网页。ai-one 不会读取网页内容。` : `You are operating the ${providerInstanceName(takeover, PROVIDER_LABELS)} page yourself. ai-one does not read the page.`}</span>{' '}
          <Button size="sm" onClick={() => void backFromTakeover()}>
            {text.zh ? '回到任务' : 'Back to task'}
          </Button>
        </Notice>
      ) : null}
      {error ? <Notice tone="block">{error}</Notice> : null}
      <ChatLedView
        locale={locale}
        run={selected}
        providerLabels={PROVIDER_LABELS}
        cleanup={{ plan, results: selected.cleanupResults ?? null, running: cleanupRunning }}
        exportedPath={exportFile}
        onPause={() => controller?.pause()}
        onResume={() => controller?.resume()}
        onStop={() => void controller?.stop()}
        onRemind={() => void controller?.remind()}
        onExtendLimit={(extra) => void controller?.extendLimit(extra)}
        onTakeOver={(provider) => void doTakeOver(provider)}
        onExport={doExport}
        onCleanup={() => void doCleanup()}
        onClose={doClose}
      />
    </div>
  );
}
