import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import App from '../App';
import type { Locale } from '../i18n/resolve';
import { needsYouTasks, type HudTask } from '../ui/taskHudModel';
import { Badge, Button, Icon, IconButton, Notice, V2Scope, cx, type V2IconName } from '../ui/v2';
import { CommandPalette } from './CommandPalette';
import { deriveResources, quotaTitleView, type QuotaTitleLevel } from '../resources/registry';
import { useQuotaHud, type QuotaHudData, type QuotaHudLoader, type QuotaHudStarter } from '../resources/useQuotaHud';
import { NAV_KEY, paletteCommands } from './paletteCommands';
import { useDispatchData, type DispatchLoader } from './useDispatchData';
import { categoryHealth, countLabel, observedAt, repoNotices, useWorkbenchData, type GitHubLoader, type WorkbenchData } from './useWorkbenchData';
import {
  HOME_ROUTE,
  MAX_REPOS,
  NAV_VIEWS,
  navViewFor,
  nextTheme,
  resolveRoute,
  resolveTheme,
  isEditableTarget,
  shortcutFor,
  type NavView,
  type PaletteCommand,
  type WorkbenchRoute,
} from './workbenchModel';
import { workbenchText, type WorkbenchText } from './workbenchText';
import { UserAcceptanceSection, acceptanceIssueKeys, pendingAcceptanceCount } from './views/UserAcceptanceSection';
import { useUserAcceptance, type AcceptanceLoader, type AcceptanceState } from './useUserAcceptance';
import type { AcceptanceWriter } from './userAcceptance';
import { ChatLedPage } from './views/ChatLedPage';
import { ResourcesView } from './views/ResourcesView';
import { TaskView } from './views/TaskView';
import { TasksView } from './views/TasksView';

const NAV_ICON: Record<NavView, V2IconName> = { chat: 'message', chatled: 'flow', tasks: 'list', resources: 'gauge' };

export interface WorkbenchProps {
  locale: Locale;
  /** Reads GitHub; tests pass a controllable one. Must be a stable reference. */
  githubLoader?: GitHubLoader;
  acceptanceLoader?: AcceptanceLoader;
  acceptanceWriter?: AcceptanceWriter;
  /** Reads local Prodex metadata; tests pass a controllable one. Must be a stable reference. */
  dispatchLoader?: DispatchLoader;
  /** Overrides the desktop check for local reads (tests). */
  isDesktop?: boolean;
  /** Reads the shared quota HUD snapshot; tests pass a controllable loader. */
  quotaHudLoader?: QuotaHudLoader;
  /** Starts the local quota HUD; tests can inject a no-op. */
  quotaHudStarter?: QuotaHudStarter;
  /** The chat tab; tests pass a stub instead of the full multi-AI chat. */
  renderChat?: (suspended: boolean) => ReactNode;
  /** The tab the app opens on (tests). */
  initialRoute?: WorkbenchRoute;
}

const defaultChat = (suspended: boolean) => <App embedded suspended={suspended} />;

/**
 * ai-one: one window, four tabs. The multi-AI chat (ask several AIs at once, let them discuss or
 * review each other) is the first tab and stays mounted, so switching away never loses a running
 * conversation; its native webviews are parked while another tab is showing.
 */
export function Workbench({ locale, githubLoader, acceptanceLoader, acceptanceWriter, dispatchLoader, isDesktop, quotaHudLoader, quotaHudStarter, renderChat = defaultChat, initialRoute = HOME_ROUTE }: WorkbenchProps) {
  const text = workbenchText(locale);
  const data = useWorkbenchData(githubLoader);
  const acceptance = useUserAcceptance(data.prefs.source, data.prefs.repos, data.github.results, acceptanceLoader, acceptanceWriter);
  const dispatch = useDispatchData({ source: data.prefs.source, repoPath: data.prefs.dispatchRepo, loader: dispatchLoader, isDesktop });
  const quotaHud = useQuotaHud({ loader: quotaHudLoader, starter: quotaHudStarter, isDesktop });
  const [route, setRoute] = useState<WorkbenchRoute>(initialRoute);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const mode = resolveTheme(data.prefs.theme, useSystemDark());
  const current = resolveRoute(route, data.tasks);
  // A task that is gone from a settled data set is gone: make the fallback the real route, so the
  // old task does not pop back up when the data source flips again. While loading, keep the route.
  const fellBack = route.view === 'task' && current.view !== 'task';
  useEffect(() => {
    if (fellBack && data.health !== 'loading') setRoute({ view: 'tasks' });
  }, [fellBack, data.health]);
  const go = (next: WorkbenchRoute) => setRoute(next);
  const openTask = (task: HudTask) => go({ view: 'task', taskId: task.id });

  // The chat mounts on first visit and then stays, hidden, behind the other tabs.
  const onChat = current.view === 'chat';
  const [chatMounted, setChatMounted] = useState(onChat);
  useEffect(() => {
    if (onChat) setChatMounted(true);
  }, [onChat]);

  // Each page starts at its top; the scroll position of the previous page means nothing here.
  const routeKey = `${current.view}:${current.taskId ?? ''}`;
  useEffect(() => {
    pageRef.current?.scrollTo?.({ top: 0 });
  }, [routeKey]);

  const paletteOpenRef = useRef(paletteOpen);
  paletteOpenRef.current = paletteOpen;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event);
      if (!shortcut) return;
      if (shortcut.kind === 'palette') {
        // Ctrl+K works everywhere, including while typing.
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (shortcut.kind === 'escape') {
        if (!paletteOpenRef.current) return;
        event.preventDefault();
        setPaletteOpen(false);
      } else if (!paletteOpenRef.current && !isEditableTarget(event.target)) {
        // Tab switching never steals keys from a text field or the open palette.
        event.preventDefault();
        setRoute({ view: shortcut.view });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const commands = useMemo(() => paletteCommands(text, data.tasks, locale), [text, data.tasks, locale]);
  const runCommand = (command: PaletteCommand) => {
    setPaletteOpen(false);
    const { action } = command;
    if (action.kind === 'go') go(action.route);
    else if (action.kind === 'source') data.setSource(action.source);
    else if (action.kind === 'refresh') data.refresh();
    else data.setTheme(nextTheme(data.prefs.theme));
  };

  const task = current.view === 'task' ? data.tasks.find((item) => item.id === current.taskId) : undefined;
  let view: ReactNode = null;
  if (current.view === 'tasks') {
    view = (
      <>
        <SourceBar text={text} data={data} locale={locale} />
        <TasksView locale={locale} tasks={data.tasks} health={data.health} onOpenTask={openTask}
          lead={<UserAcceptanceSection locale={locale} state={acceptance} demo={data.health === 'demo'} />} />
      </>
    );
  } else if (current.view === 'task' && task) {
    view = (
      <>
        <SourceBar text={text} data={data} locale={locale} />
        <TaskView key={task.id} locale={locale} task={task} onBack={() => go({ view: 'tasks' })} canDispatch={data.health !== 'demo'} />
      </>
    );
  } else if (current.view === 'chatled') {
    view = <ChatLedPage locale={locale} />;
  } else if (current.view === 'resources') {
    view = <ResourcesView locale={locale} dispatch={dispatch} quotaHud={quotaHud} repoPath={data.prefs.dispatchRepo} onSetRepo={data.setDispatchRepo} onOpenClassic={() => go({ view: 'chat' })} />;
  }

  return (
    <V2Scope mode={mode} className="fixed inset-0 flex flex-col overflow-hidden bg-v2-bg" data-testid="workbench">
      <TabBar
        text={text}
        active={navViewFor(current)}
        needsYou={needsYouCount(data, acceptance)}
        quotaHud={quotaHud}
        theme={data.prefs.theme}
        onNavigate={(next) => go({ view: next })}
        onPalette={() => setPaletteOpen(true)}
        onTheme={() => data.setTheme(nextTheme(data.prefs.theme))}
      />
      <main className="relative min-h-0 flex-1 border-t border-v2-line bg-v2-panel">
        {chatMounted ? (
          <div
            data-testid="chat-tab"
            aria-hidden={onChat ? undefined : true}
            className={cx('absolute inset-0', onChat ? '' : 'invisible pointer-events-none')}
          >
            {renderChat(!onChat)}
          </div>
        ) : null}
        {onChat ? null : (
          <div ref={pageRef} tabIndex={-1} className="absolute inset-0 overflow-auto" data-testid="page">
            {view}
          </div>
        )}
      </main>
      {paletteOpen ? (
        <CommandPalette
          title={text.t('paletteTitle')}
          placeholder={text.t('palettePlaceholder')}
          emptyText={text.t('paletteEmpty')}
          commands={commands}
          onRun={runCommand}
          onClose={() => setPaletteOpen(false)}
          fallbackFocus={pageRef}
        />
      ) : null}
    </V2Scope>
  );
}

/** What waits for the user: acceptances plus decisions / blockers not already covered by one. */
function needsYouCount(data: WorkbenchData, acceptance: AcceptanceState): string | undefined {
  const acceptances = data.health === 'demo' || acceptance.loading ? 0 : pendingAcceptanceCount(acceptance);
  // The acceptance list has its own read: a failed task read does not hide what is known to wait.
  if (data.health === 'loading' || data.health === 'failed') return acceptances > 0 ? countLabel(acceptances, 'partial') : undefined;
  const accepted = data.health === 'demo' ? new Set<string>() : acceptanceIssueKeys(acceptance);
  const tasks = needsYouTasks(data.tasks).filter(
    (task) => !(task.status === 'accept' && task.issue && accepted.has(task.repo.toLowerCase() + ':' + task.issue)),
  );
  const n = tasks.length + acceptances;
  const precision = acceptance.partial && data.health !== 'demo' ? 'partial' : categoryHealth(data.health, data.tasks);
  // "≥0" tells the user nothing; the task list itself says what could not be read.
  if (n === 0) return undefined;
  return countLabel(n, precision);
}

interface TabBarProps {
  text: WorkbenchText;
  active: NavView;
  needsYou?: string;
  quotaHud: QuotaHudData;
  theme: WorkbenchData['prefs']['theme'];
  onNavigate: (view: NavView) => void;
  onPalette: () => void;
  onTheme: () => void;
}

function TabBar({ text, active, needsYou, quotaHud, theme, onNavigate, onPalette, onTheme }: TabBarProps) {
  const themeLabel = text.t(theme === 'system' ? 'themeSystem' : theme === 'light' ? 'themeLight' : 'themeDark');
  return (
    <header className="flex h-12 shrink-0 items-center gap-v2-md px-v2-md">
      <span className="flex shrink-0 items-center gap-v2-sm font-semibold text-v2-ink">
        <span aria-hidden="true" className="inline-block h-4 w-4 rounded-v2-sm bg-v2-primary" />
        {text.t('brand')}
      </span>
      <nav aria-label={text.t('navAria')} className="flex min-w-0 flex-1 justify-center">
        <ul className="flex items-center gap-1 rounded-v2-pill bg-v2-surface p-1 shadow-v2-card">
          {NAV_VIEWS.map((view, index) => {
            const label = text.t(NAV_KEY[view]);
            const selected = active === view;
            return (
              <li key={view}>
                <button
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  title={`${label} · Ctrl ${index + 1}`}
                  onClick={() => onNavigate(view)}
                  className={cx(
                    'flex h-8 items-center gap-v2-sm rounded-v2-pill px-v2-md text-v2-body',
                    selected ? 'bg-v2-primary font-semibold text-v2-on-primary' : 'text-v2-ink-2 hover:bg-v2-hover',
                  )}
                >
                  <Icon name={NAV_ICON[view]} />
                  <span>{label}</span>
                  {view === 'tasks' && needsYou ? (
                    <span
                      aria-label={text.t('islandNeedsYou', { n: needsYou })}
                      className={cx('rounded-v2-pill px-1.5 text-v2-micro font-semibold', selected ? 'bg-v2-on-primary text-v2-primary' : 'bg-v2-you text-white')}
                    >
                      {needsYou}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex shrink-0 items-center gap-v2-xs">
        <QuotaButton text={text} quotaHud={quotaHud} onClick={() => onNavigate('resources')} />
        <IconButton size="sm" variant="ghost" label={text.t('searchPlaceholder')} icon={<Icon name="filter" />} onClick={onPalette} />
        <IconButton size="sm" variant="ghost" label={themeLabel} icon={<Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} />} onClick={onTheme} />
      </div>
    </header>
  );
}

const QUOTA_DOT: Record<QuotaTitleLevel, string> = {
  ok: 'bg-v2-done',
  warn: 'bg-v2-you',
  critical: 'bg-v2-block',
  unknown: 'bg-v2-unknown',
};

function quotaPercentLabel(value: number): string {
  return Number(value.toFixed(1)).toString();
}

function QuotaButton({ text, quotaHud, onClick }: { text: WorkbenchText; quotaHud: QuotaHudData; onClick: () => void }) {
  const reading = quotaHud.reading ?? { state: 'unavailable' as const, heartbeatAgeSeconds: null, snapshot: null, readAt: null };
  const summary = quotaTitleView(deriveResources(reading, Date.now()));
  const value = summary.usedPercent === null
    ? text.t('quotaButtonUnknown')
    : text.t(summary.partial ? 'quotaButtonValuePartial' : 'quotaButtonValue', { percent: quotaPercentLabel(summary.usedPercent) });
  const label = text.t('quotaButtonAria', { value });
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid="quota-button"
      data-tone={summary.level}
      className="flex h-7 items-center gap-v2-sm rounded-v2-md px-v2-sm text-v2-meta text-v2-ink-2 hover:bg-v2-hover"
    >
      <span data-testid="quota-button-dot" aria-hidden="true" className={cx('h-1.5 w-1.5 rounded-full', QUOTA_DOT[summary.level])} />
      <span className="max-[899px]:hidden">{value}</span>
    </button>
  );
}

/** Which repositories the task tab reads, when, and what could not be read. */
function SourceBar({ text, data, locale }: { text: WorkbenchText; data: WorkbenchData; locale: Locale }) {
  const [draft, setDraft] = useState('');
  const [repoError, setRepoError] = useState<string | undefined>();
  const { prefs, github } = data;
  const current = github.reposKey === prefs.repos.join('\n') ? github.results : [];
  const notices = prefs.source === 'github' && !github.loading ? repoNotices(current) : [];
  const observed = observedAt(current);
  if (prefs.source === 'demo') {
    return (
      <div className="border-b border-v2-line bg-v2-panel px-v2-page py-v2-sm">
        <Notice tone="unknown">
          <span>{text.t('demoNotice')} </span>
          <Button size="sm" onClick={() => data.setSource('github')}>{text.t('sourceGithub')}</Button>
        </Notice>
      </div>
    );
  }
  return (
    <div className="grid gap-v2-xs border-b border-v2-line bg-v2-panel px-v2-page py-v2-sm">
      <div className="flex flex-wrap items-center gap-v2-sm text-v2-meta">
        {prefs.repos.map((repo) => (
          <Badge key={repo}>
            {repo}
            {prefs.repos.length > 1 ? (
              <button type="button" aria-label={text.t('repoRemove', { repo })} onClick={() => data.removeRepo(repo)} className="ml-1 text-v2-ink-3 hover:text-v2-ink">
                <Icon name="close" size={12} />
              </button>
            ) : null}
          </Badge>
        ))}
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            const result = data.addRepo(draft);
            setRepoError(result === 'invalid' ? text.t('repoInvalid') : result === 'full' ? text.t('repoFull', { max: MAX_REPOS }) : undefined);
            if (result === 'added' || result === 'present') setDraft('');
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={text.t('repoPlaceholder')}
            aria-label={text.t('repoPlaceholder')}
            aria-invalid={repoError ? true : undefined}
            className="h-7 w-36 rounded-v2-md border border-v2-line bg-v2-surface px-v2-sm text-v2-meta text-v2-ink placeholder:text-v2-ink-3"
          />
          <Button size="sm" type="submit">
            {text.t('repoAdd')}
          </Button>
        </form>
        <span className="ml-auto text-v2-ink-3">
          {github.loading ? text.t('githubLoading') : observed ? text.t('githubObserved', { time: new Date(observed).toLocaleTimeString(locale) }) : ''}
        </span>
        <Button size="sm" variant="ghost" loading={github.loading} onClick={data.refresh} icon={<Icon name="refresh" size={14} />}>
          {text.t('refresh')}
        </Button>
      </div>
      {repoError ? <p role="alert" className="text-v2-micro text-v2-block">{repoError}</p> : null}
      {notices.map((notice) => (
        <p key={`${notice.kind}-${notice.repo}`} className={cx('text-v2-micro', notice.kind === 'error' ? 'text-v2-block' : 'text-v2-ink-3')}>
          {notice.kind === 'error'
            ? text.t('githubError', { repo: notice.repo, message: notice.message })
            : text.t(notice.kind === 'partial' ? 'githubPartial' : 'githubMore', { repo: notice.repo })}
        </p>
      ))}
    </div>
  );
}

function subscribeSystemDark(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function useSystemDark(): boolean {
  return useSyncExternalStore(
    subscribeSystemDark,
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches),
    () => false,
  );
}
