import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AI_PROVIDERS } from '../../../shared/constants';
import type { AIProvider } from '../../../shared/types';
import { host } from '../../host';
import type { Locale } from '../../i18n/resolve';
import { Badge, Button, Card, Notice, SectionHeader } from '../../ui/v2';
import { ChatLedController } from '../../workflow/chatLed/controller';
import { executeCleanup, planCleanup, type CleanupPlanItem } from '../../workflow/chatLed/cleanup';
import { createChatGptCleaner } from '../../workflow/chatLed/drivers/chatgpt';
import { createRealChatLedEnv } from '../../workflow/chatLed/env';
import { exportRunMarkdown } from '../../workflow/chatLed/exportMarkdown';
import { closeRun } from '../../workflow/chatLed/machine';
import { loadRuns, saveRun } from '../../workflow/chatLed/store';
import type { ChatLedRun, CleanupItemResult } from '../../workflow/chatLed/types';
import { workbenchText } from '../workbenchText';
import { ChatLedView } from './ChatLedView';

/** Providers the coordinator may address (the coordinator itself is excluded by the controller). */
const CANDIDATES: AIProvider[] = ['claude', 'gemini', 'grok'];
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

function offscreenBounds(): DOMRectReadOnly {
  return { x: -10_000, y: -10_000, width: 420, height: 320, top: -10_000, left: -10_000, right: -9_580, bottom: -9_680, toJSON: () => ({}) };
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
  const [goal, setGoal] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [takeover, setTakeover] = useState<AIProvider | undefined>();
  const [exported, setExported] = useState<Record<string, string>>({});
  const [cleanup, setCleanup] = useState<Record<string, { results: CleanupItemResult[] | null; running: boolean }>>({});
  const controllers = useRef(new Map<string, ChatLedController>());
  const runsRef = useRef(runs);
  runsRef.current = runs;

  const persist = useCallback(
    (run: ChatLedRun) => {
      setRuns(saveRun(storage, run, runsRef.current));
    },
    [storage],
  );

  const cleaners = useMemo(
    () => [
      createChatGptCleaner({
        evalInPage: (js) => host.provider.evalWithCallback('chatgpt', js),
        navigate: async (url) => {
          await host.provider.eval('chatgpt', `location.href = ${JSON.stringify(url)}`);
          await sleep(4_000);
        },
        sleep,
      }),
    ],
    [],
  );

  useEffect(() => () => {
    // Leaving the page does not stop a run; controllers stay alive in module scope via the ref of
    // the mounted page only, so stop live runs that are still going to avoid orphaned sends.
    for (const controller of controllers.current.values()) {
      const phase = controller.getRun().phase;
      if (phase === 'coordinator-thinking' || phase === 'forwarding' || phase === 'paused') void controller.stop();
    }
  }, []);

  const start = async () => {
    const trimmed = goal.trim();
    if (!trimmed || starting) return;
    setStarting(true);
    setError(undefined);
    try {
      const env = createRealChatLedEnv();
      const controller = await ChatLedController.create(env, { id: newRunId(), goal: trimmed, candidates: CANDIDATES });
      controllers.current.set(controller.getRun().id, controller);
      persist(controller.getRun());
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
      <div className="mx-auto grid max-w-[1180px] gap-v2-lg p-v2-page">
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
            <p className="text-v2-meta text-v2-ink-2">
              {text.t('chatLedCoordinatorLine', {
                name: AI_PROVIDERS.chatgpt.name,
                names: CANDIDATES.map((provider) => AI_PROVIDERS[provider].name).join(', '),
              })}
            </p>
            {error ? <Notice tone="block">{error}</Notice> : null}
            <div>
              <Button variant="primary" onClick={() => void start()} disabled={!goal.trim() || starting} loading={starting}>
                {starting ? text.t('chatLedStarting') : text.t('chatLedStart')}
              </Button>
            </div>
          </div>
        </Card>
        <section aria-labelledby="chatled-history" className="grid gap-v2-sm">
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
  const state = cleanup[selected.id] ?? { results: null, running: false };
  const plan: CleanupPlanItem[] | null =
    selected.phase === 'finished' || selected.phase === 'stopped' ? planCleanup(selected, cleaners) : null;

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
      setExported((current) => ({ ...current, [selected.id]: file }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const doCleanup = async () => {
    if (!plan || state.running) return;
    setCleanup((current) => ({ ...current, [selected.id]: { results: null, running: true } }));
    let results: CleanupItemResult[] = [];
    try {
      // Only the user's click on "Clean up" reaches this point. The page must exist and be idle.
      await createRealChatLedEnv().prepare('chatgpt').catch(() => undefined);
      results = await executeCleanup(plan, cleaners);
    } finally {
      setCleanup((current) => ({ ...current, [selected.id]: { results, running: false } }));
    }
  };

  const doClose = () => {
    if (controller) controller.markClosed(Boolean(exported[selected.id]));
    else persist(closeRun(selected, Boolean(exported[selected.id]), Date.now()));
  };

  const doTakeOver = async (provider: AIProvider) => {
    controller?.pause();
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
          <span>{text.zh ? `你正在自己操作 ${PROVIDER_LABELS[takeover]} 的网页。ai-one 不会读取网页内容。` : `You are operating the ${PROVIDER_LABELS[takeover]} page yourself. ai-one does not read the page.`}</span>{' '}
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
        cleanup={{ plan, results: state.results, running: state.running }}
        exportedPath={exported[selected.id]}
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
