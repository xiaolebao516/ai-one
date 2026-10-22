import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ALL_AI_PROVIDERS } from '../../shared/constants';
import { host } from '../host';
import type { Locale } from '../i18n/resolve';
import { STATUS_TONE, pickText, summarize, type HudTask } from '../ui/taskHudModel';
import { taskHudText } from '../ui/taskHudText';
import { Badge, Button, Icon, IconButton, Notice, SegmentedControl, StatusIndicator, V2Scope, cx, type V2IconName } from '../ui/v2';
import { CommandPalette } from './CommandPalette';
import { NAV_KEY, paletteCommands } from './paletteCommands';
import { useWorkbenchData, observedAt, repoNotices, type WorkbenchData } from './useWorkbenchData';
import {
  HOME_ROUTE,
  NAV_VIEWS,
  activeTasks,
  groupByRepo,
  navViewFor,
  nextTheme,
  resolveRoute,
  resolveTheme,
  shortcutFor,
  type NavView,
  type PaletteCommand,
  type WorkbenchRoute,
} from './workbenchModel';
import { workbenchText, type WorkbenchText } from './workbenchText';
import { HomeView } from './views/HomeView';
import { PlannedView } from './views/PlannedView';
import { TaskView } from './views/TaskView';
import { TasksView } from './views/TasksView';

const NAV_ICON: Record<NavView, V2IconName> = { home: 'home', tasks: 'list', chat: 'message', flows: 'flow', resources: 'users' };

export interface WorkbenchProps {
  locale: Locale;
  /** Leaves the workbench for the classic multi-AI chat UI. */
  onOpenClassic: () => void;
}

/** The new ai-one front end (Spec #79 v2). The classic chat UI is only a capability library now. */
export function Workbench({ locale, onOpenClassic }: WorkbenchProps) {
  const text = workbenchText(locale);
  const data = useWorkbenchData();
  const [route, setRoute] = useState<WorkbenchRoute>(HOME_ROUTE);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const mode = resolveTheme(data.prefs.theme, useSystemDark());
  const current = resolveRoute(route, data.tasks);
  const go = (next: WorkbenchRoute) => setRoute(next);
  const openTask = (task: HudTask) => go({ view: 'task', taskId: task.id });

  useHideProviderWebviews();

  // Each page starts at its top; the scroll position of the previous page means nothing here.
  const routeKey = `${current.view}:${current.taskId ?? ''}`;
  useEffect(() => {
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [routeKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event);
      if (!shortcut) return;
      if (shortcut.kind === 'palette') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (shortcut.kind === 'view') {
        event.preventDefault();
        setPaletteOpen(false);
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
    else if (action.kind === 'theme') data.setTheme(nextTheme(data.prefs.theme));
    else onOpenClassic();
  };

  const task = current.view === 'task' ? data.tasks.find((item) => item.id === current.taskId) : undefined;
  let view: ReactNode;
  if (current.view === 'home') {
    view = <HomeView locale={locale} tasks={data.tasks} health={data.health} onOpenTask={openTask} onShowTasks={() => go({ view: 'tasks' })} />;
  } else if (current.view === 'tasks') {
    view = <TasksView locale={locale} tasks={data.tasks} health={data.health} onOpenTask={openTask} />;
  } else if (current.view === 'task' && task) {
    view = <TaskView key={task.id} locale={locale} task={task} onBack={() => go({ view: 'tasks' })} />;
  } else if (current.view === 'chat') {
    view = (
      <PlannedView
        title={text.t('chatTitle')}
        body={text.t('chatBody')}
        badge={text.t('plannedBadge')}
        action={
          <Button onClick={onOpenClassic} icon={<Icon name="external" size={14} />}>
            {text.t('chatOpenClassic')}
          </Button>
        }
      />
    );
  } else if (current.view === 'flows') {
    view = <PlannedView title={text.t('flowsTitle')} body={text.t('flowsBody')} badge={text.t('plannedBadge')} />;
  } else {
    view = <PlannedView title={text.t('resourcesTitle')} body={text.t('resourcesBody')} badge={text.t('plannedBadge')} />;
  }

  return (
    <V2Scope mode={mode} className="fixed inset-0 flex flex-col overflow-hidden bg-v2-bg" data-testid="workbench">
      <TitleBar text={text} tasks={data.tasks} known={data.health === 'demo' || data.health === 'ok'} onPalette={() => setPaletteOpen(true)} onShowTasks={() => go({ view: 'tasks' })} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          text={text}
          locale={locale}
          tasks={data.tasks}
          known={data.health === 'demo' || data.health === 'ok'}
          active={navViewFor(current)}
          activeTaskId={current.taskId}
          theme={data.prefs.theme}
          onNavigate={(next) => go({ view: next })}
          onOpenTask={openTask}
          onTheme={() => data.setTheme(nextTheme(data.prefs.theme))}
          onOpenClassic={onOpenClassic}
        />
        <main ref={mainRef} className="min-w-0 flex-1 overflow-auto rounded-tl-v2-xl border-l border-t border-v2-line bg-v2-panel">
          <SourceBar text={text} data={data} locale={locale} />
          {view}
        </main>
      </div>
      {paletteOpen ? (
        <CommandPalette
          title={text.t('paletteTitle')}
          placeholder={text.t('palettePlaceholder')}
          emptyText={text.t('paletteEmpty')}
          commands={commands}
          onRun={runCommand}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
    </V2Scope>
  );
}

interface TitleBarProps {
  text: WorkbenchText;
  tasks: readonly HudTask[];
  /** False while loading or after a failed read: counts would read as "nothing to do". */
  known: boolean;
  onPalette: () => void;
  onShowTasks: () => void;
}

function TitleBar({ text, tasks, known, onPalette, onShowTasks }: TitleBarProps) {
  const summary = summarize(tasks);
  const count = (n: number) => (known ? n : '?');
  const islandLabel = known ? text.t('islandAria', { inProgress: summary.inProgress, needsYou: summary.needsYou }) : text.t('islandUnknown');
  return (
    <header className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-v2-md px-v2-md">
      <div className="flex min-w-0 items-center gap-v2-md">
        <span className="flex items-center gap-v2-sm font-semibold text-v2-ink">
          <span aria-hidden="true" className="inline-block h-4 w-4 rounded-v2-sm bg-v2-primary" />
          {text.t('brand')}
        </span>
        <button
          type="button"
          onClick={onPalette}
          className="hidden h-7 min-w-[220px] items-center justify-between gap-v2-sm rounded-v2-md border border-v2-line bg-v2-surface px-v2-sm text-v2-meta text-v2-ink-3 hover:bg-v2-hover min-[900px]:flex"
        >
          <span>{text.t('searchPlaceholder')}</span>
          <kbd className="rounded-v2-sm border border-v2-line px-1 font-v2-mono text-v2-micro">Ctrl K</kbd>
        </button>
      </div>
      <button
        type="button"
        onClick={onShowTasks}
        aria-label={islandLabel}
        title={islandLabel}
        className="flex h-7 items-center gap-v2-md rounded-v2-pill bg-v2-island px-v2-md text-v2-meta font-semibold text-v2-on-island"
      >
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-v2-run" />
          {text.t('islandInProgress', { n: count(summary.inProgress) })}
        </span>
        <span aria-hidden="true" className="h-3 w-px bg-v2-on-island opacity-30" />
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-v2-you" />
          {text.t('islandNeedsYou', { n: count(summary.needsYou) })}
        </span>
      </button>
      <div />
    </header>
  );
}

interface SidebarProps {
  text: WorkbenchText;
  locale: Locale;
  tasks: readonly HudTask[];
  known: boolean;
  active: NavView;
  activeTaskId?: string;
  theme: WorkbenchData['prefs']['theme'];
  onNavigate: (view: NavView) => void;
  onOpenTask: (task: HudTask) => void;
  onTheme: () => void;
  onOpenClassic: () => void;
}

function Sidebar({ text, locale, tasks, known, active, activeTaskId, theme, onNavigate, onOpenTask, onTheme, onOpenClassic }: SidebarProps) {
  const summary = summarize(tasks);
  const hud = taskHudText(locale);
  const groups = groupByRepo(activeTasks(tasks));
  const themeLabel = text.t(theme === 'system' ? 'themeSystem' : theme === 'light' ? 'themeLight' : 'themeDark');
  return (
    <nav aria-label={text.t('navAria')} className="flex min-h-0 w-[236px] shrink-0 flex-col gap-v2-md overflow-y-auto overflow-x-hidden px-v2-sm pb-v2-sm max-[1099px]:w-[60px]">
      <ul className="grid gap-0.5">
        {NAV_VIEWS.map((view, index) => {
          const label = text.t(NAV_KEY[view]);
          const count = view === 'home' ? summary.needsYou : view === 'tasks' ? summary.total : undefined;
          return (
            <li key={view}>
              <button
                type="button"
                aria-current={active === view ? 'page' : undefined}
                title={`${label} · Ctrl ${index + 1}`}
                onClick={() => onNavigate(view)}
                className={cx(
                  'flex h-8 w-full items-center gap-v2-sm rounded-v2-md px-v2-sm text-left',
                  active === view ? 'bg-v2-surface font-semibold text-v2-ink shadow-v2-card' : 'text-v2-ink-2 hover:bg-v2-hover',
                )}
              >
                <Icon name={NAV_ICON[view]} />
                <span className="min-w-0 flex-1 truncate max-[1099px]:sr-only">{label}</span>
                {count ? (
                  <span className={cx('text-v2-micro max-[1099px]:hidden', view === 'home' ? 'font-semibold text-v2-you' : 'text-v2-ink-3')}>{count}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <section aria-label={text.t('activeTasks')} className="grid grid-cols-[minmax(0,1fr)] gap-v2-xs max-[1099px]:hidden">
        <h2 className="px-v2-sm text-v2-micro font-semibold text-v2-ink-3">{text.t('activeTasks')}</h2>
        {groups.length === 0 ? <p className="px-v2-sm text-v2-micro text-v2-ink-3">{text.t(known ? 'noActiveTasks' : 'islandUnknown')}</p> : null}
        {groups.map((group) => (
          <div key={group.repo}>
            <div className="truncate px-v2-sm text-v2-micro text-v2-ink-3">{group.repo}</div>
            <ul>
              {group.tasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTask(task)}
                    aria-current={activeTaskId === task.id ? 'page' : undefined}
                    className={cx(
                      'flex h-7 w-full items-center gap-v2-sm rounded-v2-md px-v2-sm text-left text-v2-meta',
                      activeTaskId === task.id ? 'bg-v2-surface text-v2-ink shadow-v2-card' : 'text-v2-ink-2 hover:bg-v2-hover',
                    )}
                  >
                    <StatusIndicator tone={STATUS_TONE[task.status]} label={hud.status(task.status)} hideLabel />
                    <span className="min-w-0 flex-1 truncate">{pickText(task.title, locale)}</span>
                    {task.issue ? <span className="text-v2-micro text-v2-ink-3">#{task.issue}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <div className="mt-auto grid gap-0.5 border-t border-v2-line pt-v2-sm">
        <button
          type="button"
          onClick={onOpenClassic}
          title={text.t('classicUiHint')}
          className="flex h-8 items-center gap-v2-sm rounded-v2-md px-v2-sm text-left text-v2-meta text-v2-ink-2 hover:bg-v2-hover"
        >
          <Icon name="external" />
          <span className="truncate max-[1099px]:sr-only">{text.t('classicUi')}</span>
        </button>
        <IconButton size="sm" variant="ghost" label={themeLabel} icon={<Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} />} onClick={onTheme} />
      </div>
    </nav>
  );
}

function SourceBar({ text, data, locale }: { text: WorkbenchText; data: WorkbenchData; locale: Locale }) {
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const { prefs, github } = data;
  const notices = prefs.source === 'github' ? repoNotices(github.results) : [];
  const observed = observedAt(github.results);
  return (
    <div className="sticky top-0 z-10 grid gap-v2-xs border-b border-v2-line bg-v2-panel px-v2-page py-v2-sm">
      <div className="flex flex-wrap items-center gap-v2-sm text-v2-meta">
        <SegmentedControl
          idBase="workbench-source"
          label={text.t('sourceLabel')}
          value={prefs.source}
          onChange={(value) => data.setSource(value === 'github' ? 'github' : 'demo')}
          options={[
            { value: 'demo', label: text.t('sourceDemo') },
            { value: 'github', label: text.t('sourceGithub') },
          ]}
        />
        {prefs.source === 'demo' ? <span className="text-v2-ink-3">{text.t('demoNotice')}</span> : null}
        {prefs.source === 'github' ? (
          <>
            <span className="text-v2-ink-3">
              {github.loading ? text.t('githubLoading') : observed ? text.t('githubObserved', { time: new Date(observed).toLocaleTimeString(locale) }) : ''}
            </span>
            <Button size="sm" variant="ghost" loading={github.loading} onClick={data.refresh} icon={<Icon name="refresh" size={14} />}>
              {text.t('refresh')}
            </Button>
            <span className="text-v2-ink-3">{text.t('repos')}:</span>
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
                const ok = data.addRepo(draft);
                setInvalid(!ok);
                if (ok) setDraft('');
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={text.t('repoPlaceholder')}
                aria-label={text.t('repoPlaceholder')}
                aria-invalid={invalid || undefined}
                className="h-7 w-40 rounded-v2-md border border-v2-line bg-v2-surface px-v2-sm text-v2-meta text-v2-ink placeholder:text-v2-ink-3"
              />
              <Button size="sm" type="submit">
                {text.t('repoAdd')}
              </Button>
            </form>
          </>
        ) : null}
      </div>
      {invalid ? <p className="text-v2-micro text-v2-block">{text.t('repoInvalid')}</p> : null}
      {notices.map((notice) => (
        <Notice key={`${notice.kind}-${notice.repo}`} tone={notice.kind === 'error' ? 'block' : 'unknown'}>
          {notice.kind === 'error'
            ? text.t('githubError', { repo: notice.repo, message: notice.message })
            : text.t(notice.kind === 'partial' ? 'githubPartial' : 'githubMore', { repo: notice.repo })}
        </Notice>
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

/**
 * Provider webviews are native children of the window and paint over the DOM. The workbench does
 * not use them yet, so any left over from the classic UI (same window, before a reload) are hidden.
 */
function useHideProviderWebviews(): void {
  useEffect(() => {
    for (const provider of ALL_AI_PROVIDERS) {
      try {
        void host.provider.hide(provider).catch(() => undefined);
      } catch {
        // Not running inside Tauri (browser preview, tests): there is nothing to hide.
      }
    }
  }, []);
}
