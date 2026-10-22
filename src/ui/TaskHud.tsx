import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import type { Locale } from '../i18n/resolve';
import {
  ALL,
  STATUS_TONE,
  effectiveCi,
  escapeAction,
  filterTasks,
  formatAge,
  hudReducer,
  initialHudState,
  inProgressTasks,
  isNeedsYou,
  needsYouTasks,
  otherTasks,
  pickText,
  repoList,
  reviewIsCurrent,
  selectedTask,
  shortSha,
  statusFilterCount,
  summarize,
  type CiView,
  type EvidenceKind,
  type HudAction,
  type HudState,
  type HudTask,
  type StatusFilter,
} from './taskHudModel';
import { TASK_HUD_MOCK_TASKS } from './taskHudMockData';
import type { GitHubRepoTasks } from './taskHudGithub';
import { loadGitHubTasksFromHost } from './taskHudGithubLoader';
import {
  MAX_HUD_REPOS,
  errorMessages,
  githubEmptyHeadline,
  githubOverall,
  githubTasks,
  mayHaveMore,
  parseRepoInput,
  refreshGitHubData,
  setHudPrefs,
  useGitHubData,
  useHudPrefs,
  type GitHubDataState,
  type GitHubLoader,
  type HudPrefs,
  type HudSource,
} from './taskHudSource';
import { taskHudText, type TaskHudText } from './taskHudText';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  IconButton,
  LoadingState,
  Notice,
  SectionHeader,
  SegmentedControl,
  Select,
  StatusIndicator,
  Tabs,
  V2Scope,
  V2_SKINS,
  V2_SKIN_IDS,
  isV2SkinId,
  setV2Skin,
  useV2Skin,
  type V2BadgeTone,
} from './v2';

export interface TaskHudProps {
  locale: Locale;
  onClose: () => void;
  /** Fixed task list (tests / previews). When given, the HUD shows it as demo data and hides the source switch. */
  tasks?: readonly HudTask[];
  initialState?: Partial<HudState>;
  /** GitHub loader; defaults to #52's adapter over #51's read-only bridge. */
  githubLoader?: GitHubLoader;
}

const ID = 'task-hud';
const LIST_FILTERS: StatusFilter[] = [ALL, 'inProgress', 'needsYou', 'attention', 'done'];

const CI_TONE: Record<CiView['state'], V2BadgeTone> = { success: 'done', failure: 'block', running: 'run', unknown: 'unknown' };

/**
 * True while focus is on one of the HUD's own tabs: arrow keys, Home/End and clicking a tab all
 * move focus there, and the view effect must leave it alone so view switching stays continuous.
 */
function hudTabHasFocus(): boolean {
  const active = typeof document === 'undefined' || typeof HTMLElement === 'undefined' ? null : document.activeElement;
  return active instanceof HTMLElement && active.getAttribute('role') === 'tab' && active.id.startsWith(`${ID}-tabs-tab-`);
}

/**
 * Task HUD (#40): a full-window v2 view over the chat. The chat stays mounted underneath (made
 * inert by App), so leaving the HUD returns to exactly the same conversation, draft and provider.
 */
export function TaskHud({ locale, onClose, tasks, initialState, githubLoader = loadGitHubTasksFromHost }: TaskHudProps) {
  const [state, dispatch] = useReducer(hudReducer, initialState, (overrides) => initialHudState(overrides));
  const text = taskHudText(locale);
  const skin = useV2Skin();
  const prefs = useHudPrefs();
  const gh = useGitHubData();
  const source: HudSource = tasks ? 'demo' : prefs.source;
  const data = source === 'github' ? githubTasks(gh) : state.scenario === 'empty' ? [] : (tasks ?? TASK_HUD_MOCK_TASKS);
  const refresh = useCallback((repos: readonly string[]) => void refreshGitHubData(repos, githubLoader), [githubLoader]);

  // Read GitHub once when its source is shown with nothing read yet. No polling: later reads are user-initiated.
  useEffect(() => {
    if (source === 'github' && gh.phase === 'idle' && prefs.repos.length > 0) refresh(prefs.repos);
  }, [source, gh.phase, prefs.repos, refresh]);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Remember what opened the HUD (the chat entry button) during the first render: by the time an
  // effect runs, App has made the chat inert and the browser has already moved focus to <body>.
  const [opener] = useState(() => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(() => () => opener?.focus(), [opener]);

  // Each view change scrolls to the top. Focus goes to the view heading only when the change did
  // not come from the HUD's own tab list: Tabs already moves focus to the activated tab, and taking
  // it away here would make the next arrow key land on the heading instead of the tab list.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
    if (hudTabHasFocus()) return;
    headingRef.current?.focus({ preventScroll: true });
  }, [state.view, state.selectedId, state.scenario]);

  // Listen on the document, not the HUD root: when the focused control disappears (e.g. a removed
  // repository row) focus falls back to <body> and a root listener would never see Escape.
  const escapeRef = useRef<() => void>(() => {});
  escapeRef.current = () => {
    if (escapeAction(state) === 'back') dispatch({ type: 'back' });
    else onClose();
  };
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      escapeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const task = state.view === 'detail' ? selectedTask(state, data) : undefined;
  const tabValue = state.view === 'detail' ? state.backTo : state.view;

  return (
    <V2Scope
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${ID}-title`}
      className="fixed inset-0 z-40 flex flex-col bg-v2-bg"
      data-testid="task-hud"
    >
      <header className="flex flex-wrap items-center gap-x-v2-lg gap-y-v2-sm border-b border-v2-line bg-v2-bg px-v2-lg py-v2-sm">
        <Button variant="ghost" icon={<Icon name="arrowLeft" />} onClick={onClose}>
          {text.t('back')}
        </Button>
        <span id={`${ID}-title`} className="flex items-center gap-v2-sm text-v2-lead font-semibold text-v2-ink">
          <Icon name="layers" />
          {text.t('title')}
        </span>
        <Tabs
          label={text.t('tabsLabel')}
          idBase={`${ID}-tabs`}
          value={tabValue}
          onChange={(view) => dispatch(view === 'list' ? { type: 'list' } : { type: 'overview' })}
          items={[
            { id: 'overview', label: text.t('tabOverview') },
            { id: 'list', label: text.t('tabList'), count: data.length },
          ]}
          className="border-b-0"
        />
        <span className="flex-1" />
        {tasks ? null : (
          <SegmentedControl
            label={text.t('sourceLabel')}
            idBase={`${ID}-source`}
            value={source}
            onChange={(value) => {
              setHudPrefs({ source: value === 'github' ? 'github' : 'demo' });
              dispatch({ type: 'overview' });
            }}
            options={[
              { value: 'demo', label: text.t('sourceDemo') },
              { value: 'github', label: text.t('sourceGithubOption') },
            ]}
          />
        )}
        {source === 'demo' ? (
          <>
            <Badge tone="you" variant="outline" size="md" title={text.t('mockBody')}>
              {text.t('mockTitle')}
            </Badge>
            <Select
              id={`${ID}-scenario`}
              label={text.t('scenarioLabel')}
              size="sm"
              value={state.scenario}
              onChange={(scenario) => dispatch({ type: 'scenario', scenario: scenario === 'empty' ? 'empty' : 'sample' })}
              options={[
                { value: 'sample', label: text.t('scenarioSample') },
                { value: 'empty', label: text.t('scenarioEmpty') },
              ]}
            />
          </>
        ) : (
          <>
            <Badge tone="run" variant="outline" size="md" title={text.t('githubBody')}>
              {text.t('githubBadge')}
            </Badge>
            <Button
              size="sm"
              icon={<Icon name="refresh" size={14} />}
              loading={gh.phase === 'loading'}
              disabled={prefs.repos.length === 0}
              disabledReason={text.t('noRepos')}
              onClick={() => refresh(prefs.repos)}
            >
              {gh.phase === 'loading' ? text.t('refreshing') : text.t('refresh')}
            </Button>
          </>
        )}
        {/* #42 demo: one switch re-skins every v2 surface (this HUD and the migrated chat / settings areas). */}
        <Select
          id={`${ID}-skin`}
          label={text.t('skinLabel')}
          size="sm"
          value={skin}
          onChange={(value) => {
            if (isV2SkinId(value)) setV2Skin(value);
          }}
          options={V2_SKIN_IDS.map((id) => ({ value: id, label: V2_SKINS[id].label }))}
        />
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-v2-panel">
        <div
          id={`${ID}-tabs-panel-${tabValue}`}
          role="tabpanel"
          aria-labelledby={`${ID}-tabs-tab-${tabValue}`}
          className="mx-auto flex max-w-[1120px] flex-col gap-v2-xl px-v2-page py-v2-xl"
        >
          {state.view === 'overview' ? (
            <Overview
              tasks={data}
              locale={locale}
              text={text}
              dispatch={dispatch}
              headingRef={headingRef}
              source={source === 'github' ? <GitHubPanel prefs={prefs} gh={gh} locale={locale} text={text} onRefresh={refresh} /> : <DemoNotice text={text} />}
              subline={source === 'github' ? githubSubline(gh, locale, text) : text.t('subline')}
              emptyHeadline={githubEmptyHeadline(source, gh, text)}
              empty={source === 'github' ? <GitHubEmpty prefs={prefs} gh={gh} text={text} onRefresh={refresh} /> : <DemoEmpty text={text} />}
            />
          ) : state.view === 'list' ? (
            <TaskList
              tasks={data}
              state={state}
              locale={locale}
              text={text}
              dispatch={dispatch}
              headingRef={headingRef}
              source={source === 'github' ? <GitHubPanel prefs={prefs} gh={gh} locale={locale} text={text} onRefresh={refresh} /> : null}
              empty={source === 'github' ? <GitHubEmpty prefs={prefs} gh={gh} text={text} onRefresh={refresh} /> : <DemoEmpty text={text} />}
            />
          ) : (
            <TaskDetail task={task} backTo={state.backTo} locale={locale} text={text} dispatch={dispatch} headingRef={headingRef} />
          )}
        </div>
      </div>
    </V2Scope>
  );
}

interface ViewProps {
  locale: Locale;
  text: TaskHudText;
  dispatch: (action: HudAction) => void;
  headingRef: RefObject<HTMLHeadingElement>;
}

interface SourceSlots {
  /** Data-source banner: demo notice or the GitHub panel. */
  source: ReactNode;
  /** Shown instead of the task sections when there are no tasks. */
  empty: ReactNode;
}

function Overview({
  tasks,
  locale,
  text,
  dispatch,
  headingRef,
  source,
  subline,
  emptyHeadline,
  empty,
}: ViewProps & SourceSlots & { tasks: readonly HudTask[]; subline: string; emptyHeadline: string }) {
  const summary = summarize(tasks);
  const needs = needsYouTasks(tasks);
  const active = inProgressTasks(tasks);
  const others = otherTasks(tasks);
  const headline =
    tasks.length === 0
      ? emptyHeadline
      : text.t(summary.needsYou > 0 ? 'headline' : 'headlineNoNeeds', { inProgress: summary.inProgress, needsYou: summary.needsYou });

  return (
    <>
      {source}
      <div className="flex flex-col gap-v2-sm">
        <h1 ref={headingRef} tabIndex={-1} className="m-0 text-v2-ink">
          <span className="text-v2-title">{headline}</span>
        </h1>
        <p className="m-0 text-v2-meta text-v2-ink-2">{subline}</p>
        {tasks.length > 0 ? (
          <div className="mt-v2-xs flex flex-wrap gap-v2-sm" role="group" aria-label={text.t('counterHint')}>
            <CounterButton tone="run" count={summary.inProgress} label={text.t('counterInProgress')} hint={text.t('counterHint')} onClick={() => dispatch({ type: 'list', status: 'inProgress' })} />
            <CounterButton tone="you" count={summary.needsYou} label={text.t('counterNeedsYou')} hint={text.t('counterHint')} onClick={() => dispatch({ type: 'list', status: 'needsYou' })} />
            <CounterButton tone="unknown" count={summary.attention} label={text.t('counterAttention')} hint={text.t('counterHint')} onClick={() => dispatch({ type: 'list', status: 'attention' })} />
          </div>
        ) : null}
      </div>

      {tasks.length === 0 ? (
        empty
      ) : (
        <>
          {needs.length > 0 ? (
            <section aria-labelledby={`${ID}-needs`} className="flex flex-col gap-v2-md">
              <SectionHeader id={`${ID}-needs`} title={text.t('needsYouTitle')} count={needs.length} description={text.t('needsYouHint')} />
              {needs.map((task) => (
                <NeedsYouCard key={task.id} task={task} locale={locale} text={text} onOpen={() => dispatch({ type: 'open', id: task.id })} />
              ))}
            </section>
          ) : null}
          {active.length > 0 ? (
            <section aria-labelledby={`${ID}-active`} className="flex flex-col gap-v2-md">
              <SectionHeader
                id={`${ID}-active`}
                title={text.t('inProgressTitle')}
                count={active.length}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'list', status: ALL })}>
                    {text.t('allTasks')}
                  </Button>
                }
              />
              <TaskRows tasks={active} locale={locale} text={text} onOpen={(id) => dispatch({ type: 'open', id })} />
            </section>
          ) : null}
          {others.length > 0 ? (
            <section aria-labelledby={`${ID}-others`} className="flex flex-col gap-v2-md">
              <SectionHeader id={`${ID}-others`} title={text.t('otherTitle')} count={others.length} />
              <TaskRows tasks={others} locale={locale} text={text} onOpen={(id) => dispatch({ type: 'open', id })} />
            </section>
          ) : null}
        </>
      )}

      <Notice tone="unknown" title={text.t('runtimeTitle')}>
        {text.t('runtimeBody')}
      </Notice>
    </>
  );
}

function CounterButton({ tone, count, label, hint, onClick }: { tone: 'run' | 'you' | 'unknown'; count: number; label: string; hint: string; onClick: () => void }) {
  return (
    <Button onClick={onClick} title={hint}>
      <span className="inline-flex items-center gap-v2-sm">
        <StatusIndicator tone={tone} label={label} />
        <span className="tabular-nums">{count}</span>
      </span>
    </Button>
  );
}

function NeedsYouCard({ task, locale, text, onOpen }: { task: HudTask; locale: Locale; text: TaskHudText; onOpen: () => void }) {
  const tone = STATUS_TONE[task.status];
  return (
    <Card accent={tone} className="flex flex-col gap-v2-sm" as="article" aria-labelledby={`${ID}-need-${task.id}`}>
      <div className="flex flex-wrap items-center gap-v2-sm">
        <Badge tone={tone}>{text.needKind(task.status)}</Badge>
        <h3 id={`${ID}-need-${task.id}`} className="m-0 min-w-0 flex-1 text-v2-body font-semibold text-v2-ink">
          {pickText(task.title, locale)}
        </h3>
      </div>
      <div className="text-v2-meta text-v2-ink-3">
        {task.repo}
        {task.issue !== undefined ? ` #${task.issue}` : ''}
        {task.updatedMinutesAgo === undefined ? null : ` · ${text.t('updated', { age: formatAge(task.updatedMinutesAgo, locale) })}`}
      </div>
      <p className="m-0 text-v2-body text-v2-ink-2">{pickText(task.summary, locale)}</p>
      <div>
        <Button size="sm" icon={<Icon name="chevronRight" size={14} />} onClick={onOpen}>
          {text.t('openDetail')}
        </Button>
      </div>
    </Card>
  );
}

function TaskRows({ tasks, locale, text, onOpen }: { tasks: readonly HudTask[]; locale: Locale; text: TaskHudText; onOpen: (id: string) => void }) {
  return (
    <Card padding="none" className="overflow-hidden">
      <ul className="m-0 list-none divide-y divide-v2-line p-0">
        {tasks.map((task) => (
          <li key={task.id}>
            <TaskRow task={task} locale={locale} text={text} onOpen={() => onOpen(task.id)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TaskRow({ task, locale, text, onOpen }: { task: HudTask; locale: Locale; text: TaskHudText; onOpen: () => void }) {
  const ci = effectiveCi(task);
  const activeStage = task.stages.find((stage) => stage.state === 'active');
  const statusLabel = task.statusNote ? `${text.status(task.status)} · ${pickText(task.statusNote, locale)}` : text.status(task.status);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-wrap items-center gap-x-v2-md gap-y-v2-xs px-v2-card py-v2-md text-left transition-colors hover:bg-v2-hover"
    >
      <span className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
        <span className="truncate font-semibold text-v2-ink">{pickText(task.title, locale)}</span>
        <span className="truncate text-v2-meta text-v2-ink-3">
          {task.repo}
          {task.issue !== undefined ? ` #${task.issue}` : ''}
          {activeStage ? ` · ${pickText(activeStage.name, locale)}` : ''}
        </span>
      </span>
      <StatusIndicator tone={STATUS_TONE[task.status]} label={statusLabel} className="w-48 shrink-0" />
      <span className="flex w-56 shrink-0 flex-wrap items-center gap-v2-xs">
        {task.pr ? <Badge>{`PR #${task.pr.number}${task.pr.draft ? ` · ${text.t('draft')}` : ''}`}</Badge> : <Badge variant="outline">{text.t('noPr')}</Badge>}
        {task.pr ? <Badge tone={CI_TONE[ci.state]}>{text.ci(ci.state)}</Badge> : null}
      </span>
      {/* GitHub snapshots carry no update time: leave the cell empty rather than repeat "time unknown" on every row. */}
      <span className="w-24 shrink-0 text-right text-v2-meta text-v2-ink-3">
        {task.updatedMinutesAgo === undefined ? null : formatAge(task.updatedMinutesAgo, locale)}
      </span>
      <Icon name="chevronRight" size={14} className="text-v2-ink-3" />
    </button>
  );
}

function TaskList({ tasks, state, locale, text, dispatch, headingRef, source, empty }: ViewProps & SourceSlots & { tasks: readonly HudTask[]; state: HudState }) {
  const repos = useMemo(() => repoList(tasks), [tasks]);
  const visible = filterTasks(tasks, state.repo, state.status);
  const filterLabel = (filter: StatusFilter) =>
    filter === ALL
      ? text.t('statusAll')
      : filter === 'inProgress'
        ? text.t('counterInProgress')
        : filter === 'needsYou'
          ? text.t('counterNeedsYou')
          : filter === 'attention'
            ? text.t('counterAttention')
            : text.status('done');

  return (
    <>
      {source}
      <div className="flex flex-col gap-v2-md">
        <h1 ref={headingRef} tabIndex={-1} className="m-0 text-v2-ink">
          <span className="text-v2-heading">{text.t('tabList')}</span>
          <span className="ml-v2-sm text-v2-meta text-v2-ink-3">{text.t('listCount', { n: visible.length })}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-v2-md">
          <Select
            id={`${ID}-repo`}
            label={text.t('repoLabel')}
            value={state.repo}
            onChange={(repo) => dispatch({ type: 'repo', repo })}
            options={[{ value: ALL, label: text.t('repoAll') }, ...repos.map((repo) => ({ value: repo, label: repo }))]}
            disabled={tasks.length === 0}
          />
          <SegmentedControl
            label={text.t('statusLabel')}
            idBase={`${ID}-status`}
            value={state.status}
            onChange={(status) => dispatch({ type: 'status', status: status as StatusFilter })}
            options={LIST_FILTERS.map((filter) => ({ value: filter, label: filterLabel(filter), count: statusFilterCount(tasks, state.repo, filter) }))}
          />
        </div>
      </div>
      {tasks.length === 0 ? (
        empty
      ) : visible.length === 0 ? (
        <EmptyState
          title={text.t('noMatchTitle')}
          description={text.t('noMatchBody')}
          action={
            <Button size="sm" onClick={() => dispatch({ type: 'clearFilters' })}>
              {text.t('clearFilters')}
            </Button>
          }
        />
      ) : (
        <TaskRows tasks={visible} locale={locale} text={text} onOpen={(id) => dispatch({ type: 'open', id })} />
      )}
    </>
  );
}

function evidenceTone(kind: EvidenceKind, dataSource: HudTask['dataSource']): V2BadgeTone {
  if (kind === 'unverified') return 'unknown';
  if (kind === 'self' || dataSource === 'mock') return 'neutral';
  return 'done';
}

function TaskDetail({ task, backTo, locale, text, dispatch, headingRef }: ViewProps & { task: HudTask | undefined; backTo: HudState['backTo'] }) {
  const back = (
    <div>
      <Button variant="ghost" size="sm" icon={<Icon name="arrowLeft" size={14} />} onClick={() => dispatch({ type: 'back' })}>
        {text.t(backTo === 'list' ? 'backToList' : 'backToOverview')}
      </Button>
    </div>
  );
  if (!task) {
    return (
      <>
        {back}
        <h1 ref={headingRef} tabIndex={-1} className="sr-only">
          {text.t('taskMissing')}
        </h1>
        <EmptyState tone="unknown" title={text.t('taskMissing')} />
      </>
    );
  }

  const tone = STATUS_TONE[task.status];
  const ci = effectiveCi(task);
  const statusLabel = task.statusNote ? `${text.status(task.status)} · ${pickText(task.statusNote, locale)}` : text.status(task.status);

  return (
    <>
      {back}
      <div className="flex flex-col gap-v2-sm">
        <div className="text-v2-meta text-v2-ink-3" title={text.t('noLink')}>
          {task.repo}
          {task.issue !== undefined ? ` / Issue #${task.issue}` : ''}
          {task.pr ? ` / PR #${task.pr.number}` : ''}
        </div>
        <div className="flex flex-wrap items-center gap-v2-md">
          <h1 ref={headingRef} tabIndex={-1} className="m-0 min-w-0 flex-1 text-v2-ink">
            <span className="text-v2-heading">{pickText(task.title, locale)}</span>
          </h1>
          <StatusIndicator tone={tone} label={statusLabel} variant="pill" />
        </div>
        {task.stages.length > 0 ? (
          <ol aria-label={text.t('stages')} className="m-0 flex list-none flex-wrap gap-v2-sm p-0">
            {task.stages.map((stage, index) => (
              <li key={index}>
                <Badge
                  variant="outline"
                  tone={stage.state === 'done' ? 'done' : stage.state === 'active' ? tone : stage.state === 'skipped' ? 'unknown' : 'neutral'}
                >
                  {`${pickText(stage.name, locale)} · ${text.stage(stage.state)}`}
                </Badge>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      {isNeedsYou(task.status) ? (
        <Notice tone={tone} title={text.status(task.status)}>
          <div>{task.nextStep ? pickText(task.nextStep, locale) : null}</div>
          <div className="mt-1 text-v2-meta">{text.t('readOnly')}</div>
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-v2-lg min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-v2-lg">
          <Card as="section" aria-labelledby={`${ID}-now`} className="flex flex-col gap-v2-sm">
            <h2 id={`${ID}-now`} className="m-0 text-v2-meta font-semibold text-v2-ink-3">
              {text.t('now')}
            </h2>
            <p className="m-0 text-v2-lead text-v2-ink">{pickText(task.summary, locale)}</p>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-v2-md gap-y-1 text-v2-meta">
              {task.nextStep ? (
                <>
                  <dt className="text-v2-ink-3">{text.t('next')}</dt>
                  <dd className="m-0 text-v2-ink-2">{pickText(task.nextStep, locale)}</dd>
                </>
              ) : null}
              {task.owner ? (
                <>
                  <dt className="text-v2-ink-3">{text.t('owner')}</dt>
                  <dd className="m-0 text-v2-ink-2">{pickText(task.owner, locale)}</dd>
                </>
              ) : null}
              {task.updatedMinutesAgo === undefined ? null : (
                <>
                  <dt className="text-v2-ink-3">{text.t('updatedLabel')}</dt>
                  <dd className="m-0 text-v2-ink-2">{formatAge(task.updatedMinutesAgo, locale)}</dd>
                </>
              )}
            </dl>
          </Card>

          <Card as="section" aria-labelledby={`${ID}-evidence`} className="flex flex-col gap-v2-md">
            <SectionHeader id={`${ID}-evidence`} level={2} title={text.t('evidence')} count={task.evidence.length} />
            {task.evidence.length === 0 ? (
              <p className="m-0 text-v2-meta text-v2-ink-3">{text.t('noEvidence')}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-v2-sm p-0">
                {task.evidence.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-baseline gap-x-v2-sm gap-y-1">
                    <Badge variant="outline" tone={evidenceTone(item.kind, task.dataSource)}>
                      {text.evidence(item.kind, task.dataSource)}
                    </Badge>
                    <span className="min-w-0 flex-1 text-v2-body text-v2-ink">{pickText(item.text, locale)}</span>
                    {item.observedMinutesAgo !== undefined ? (
                      <span className="text-v2-micro text-v2-ink-3">{text.t('observed', { age: formatAge(item.observedMinutesAgo, locale) })}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <details className="rounded-v2-md bg-v2-sunken px-v2-md py-v2-sm">
              <summary className="cursor-pointer text-v2-meta font-semibold text-v2-ink-2">{text.t('rawEvidence')}</summary>
              {task.evidence.some((item) => item.raw) ? (
                <pre className="m-0 mt-v2-sm whitespace-pre-wrap break-words font-v2-mono text-v2-micro text-v2-ink-2">
                  {task.evidence
                    .filter((item) => item.raw)
                    .map((item) => `[${text.evidence(item.kind, task.dataSource)}] ${item.raw}`)
                    .join('\n\n')}
                </pre>
              ) : (
                <p className="m-0 mt-v2-sm text-v2-meta text-v2-ink-3">{text.t('rawEmpty')}</p>
              )}
            </details>
          </Card>
        </div>

        <Card as="section" aria-labelledby={`${ID}-delivery`} className="flex flex-col gap-v2-md self-start">
          <h2 id={`${ID}-delivery`} className="m-0 text-v2-meta font-semibold text-v2-ink-3">
            {text.t('delivery')}
          </h2>
          <dl className="m-0 flex flex-col gap-v2-md text-v2-body">
            <DeliveryRow label={text.t('issue')}>{task.issue !== undefined ? `#${task.issue}` : <Badge tone="unknown">{text.status('unknown')}</Badge>}</DeliveryRow>
            <DeliveryRow label={text.t('pr')}>
              {task.pr ? (
                <span className="flex flex-wrap items-center gap-v2-xs">
                  <span>#{task.pr.number}</span>
                  <Badge>{task.pr.draft ? text.t('draft') : text.t('readyForReview')}</Badge>
                </span>
              ) : (
                <span className="text-v2-ink-3">{text.t('noPr')}</span>
              )}
            </DeliveryRow>
            {task.pr ? (
              <DeliveryRow label={text.t('head')}>
                {task.pr.headSha ? (
                  <code className="break-all font-v2-mono text-v2-micro text-v2-ink">{task.pr.headSha}</code>
                ) : (
                  <Badge tone="unknown">{text.t('headMissing')}</Badge>
                )}
              </DeliveryRow>
            ) : null}
            {task.pr ? (
              <DeliveryRow label={text.t('ci')}>
                <span className="flex flex-col items-start gap-1">
                  <Badge tone={CI_TONE[ci.state]}>{text.ci(ci.state)}</Badge>
                  <span className="text-v2-micro text-v2-ink-3">
                    {ci.state === 'unknown'
                      ? text.ciReason(ci.reason)
                      : `${text.t('onSha', { sha: shortSha(ci.headSha) })}${task.ci?.detail ? ` · ${pickText(task.ci.detail, locale)}` : ''}`}
                  </span>
                </span>
              </DeliveryRow>
            ) : null}
            {task.pr ? (
              <DeliveryRow label={text.t('review')}>
                <ReviewValue task={task} locale={locale} text={text} />
              </DeliveryRow>
            ) : null}
          </dl>
          {task.gap ? (
            <Notice tone="unknown" title={text.t('missingData')}>
              {pickText(task.gap, locale)}
            </Notice>
          ) : null}
          <p className="m-0 border-t border-v2-line pt-v2-sm text-v2-micro text-v2-ink-3">
            {task.dataSource === 'mock' ? text.t('sourceMock') : text.t('sourceGithub')}
          </p>
        </Card>
      </div>
    </>
  );
}

function DeliveryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-v2-micro text-v2-ink-3">{label}</dt>
      <dd className="m-0 text-v2-ink">{children}</dd>
    </div>
  );
}

function ReviewValue({ task, locale, text }: { task: HudTask; locale: Locale; text: TaskHudText }) {
  const review = task.review;
  if (!review || review.verdict === 'none') return <span className="text-v2-ink-3">{text.t('reviewNone')}</span>;
  const current = reviewIsCurrent(task);
  const verdictTone: V2BadgeTone = !current ? 'unknown' : review.verdict === 'pass' ? 'done' : review.verdict === 'revise' ? 'rework' : 'block';
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex flex-wrap items-center gap-v2-xs">
        <Badge tone={verdictTone}>{text.verdict(review.verdict)}</Badge>
        {review.by ? <span className="text-v2-meta text-v2-ink-2">{pickText(review.by, locale)}</span> : null}
      </span>
      {review.headSha ? <span className="text-v2-micro text-v2-ink-3">{text.t('onSha', { sha: shortSha(review.headSha) })}</span> : null}
      {!current ? <span className="text-v2-micro text-v2-ink-2">{text.t('reviewStale')}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Data source (#53)

function DemoNotice({ text }: { text: TaskHudText }) {
  return (
    <Notice tone="you" title={text.t('mockTitle')}>
      {text.t('mockBody')}
    </Notice>
  );
}

function DemoEmpty({ text }: { text: TaskHudText }) {
  return <EmptyState title={text.t('emptyTitle')} description={text.t('emptyBody')} />;
}

function minutesSince(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const elapsed = Date.now() - Date.parse(iso);
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 60000)) : undefined;
}

function githubSubline(gh: GitHubDataState, locale: Locale, text: TaskHudText): string {
  if (gh.phase === 'loading') return gh.results.length > 0 ? text.t('githubRefreshingStale') : text.t('refreshing');
  return gh.finishedAt ? text.t('githubSubline', { age: formatAge(minutesSince(gh.finishedAt), locale) }) : text.t('githubNotLoaded');
}

/** Nothing to list: say whether that is a failure, a load in progress or genuinely no open items. */
export function GitHubEmpty({ prefs, gh, text, onRefresh }: { prefs: HudPrefs; gh: GitHubDataState; text: TaskHudText; onRefresh: (repos: readonly string[]) => void }) {
  const retry = (
    <Button size="sm" icon={<Icon name="refresh" size={14} />} onClick={() => onRefresh(prefs.repos)}>
      {text.t('refresh')}
    </Button>
  );
  if (prefs.repos.length === 0) return <EmptyState tone="unknown" title={text.t('noRepos')} />;
  if (gh.phase === 'loading') return <LoadingState label={text.t('refreshing')} />;
  if (gh.phase === 'idle') return <EmptyState tone="unknown" title={text.t('githubNotLoaded')} action={retry} />;
  const overall = githubOverall(gh);
  if (overall === 'error') return <EmptyState tone="unknown" title={text.t('githubErrorTitle')} description={text.t('githubErrorBody')} action={retry} />;
  // A partial read with no tasks is not "nothing open": keep the unknown tone.
  if (overall === 'partial') {
    // Only claim "first page only" when pagination actually says so; otherwise a repository failed.
    const description = gh.results.some(mayHaveMore) ? text.t('repoMore') : text.t('githubPartialBody');
    return <EmptyState tone="unknown" title={text.t('githubErrorTitle')} description={description} action={retry} />;
  }
  return <EmptyState title={text.t('githubEmptyTitle')} description={text.t('githubEmptyBody')} />;
}

const REPO_STATUS_TONE: Record<GitHubRepoTasks['status'], V2BadgeTone> = { complete: 'done', partial: 'you', error: 'block' };

export function GitHubPanel({
  prefs,
  gh,
  locale,
  text,
  onRefresh,
}: {
  prefs: HudPrefs;
  gh: GitHubDataState;
  locale: Locale;
  text: TaskHudText;
  onRefresh: (repos: readonly string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const byRepo = new Map(gh.results.map((result) => [result.repo, result]));

  const updateRepos = (repos: string[]) => {
    setHudPrefs({ repos });
    onRefresh(repos);
  };
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const repo = parseRepoInput(draft);
    if (!repo) return setProblem(text.t('repoInvalid'));
    if (prefs.repos.some((existing) => existing.toLowerCase() === repo.toLowerCase())) return setProblem(text.t('repoDuplicate'));
    if (prefs.repos.length >= MAX_HUD_REPOS) return setProblem(text.t('repoLimit', { n: MAX_HUD_REPOS }));
    setProblem(undefined);
    setDraft('');
    updateRepos([...prefs.repos, repo]);
  };

  return (
    <Card as="section" aria-labelledby={`${ID}-github`} className="flex flex-col gap-v2-md">
      <SectionHeader
        id={`${ID}-github`}
        title={text.t('githubTitle')}
        description={
          gh.finishedAt ? text.t('readAt', { age: formatAge(minutesSince(gh.finishedAt), locale) }) : gh.phase === 'loading' ? text.t('refreshing') : text.t('githubNotLoaded')
        }
      />
      <p className="m-0 text-v2-meta text-v2-ink-2">{text.t('githubBody')}</p>
      <ul aria-label={text.t('reposLabel')} className="m-0 flex list-none flex-col gap-v2-xs p-0">
        {prefs.repos.map((repo) => {
          const result = byRepo.get(repo);
          return (
            <li key={repo} className="flex flex-wrap items-center gap-x-v2-sm gap-y-1 rounded-v2-md bg-v2-sunken px-v2-sm py-1">
              <span className="font-v2-mono text-v2-meta text-v2-ink">{repo}</span>
              {result ? (
                <>
                  <Badge tone={REPO_STATUS_TONE[result.status]}>
                    {text.t(result.status === 'complete' ? 'repoComplete' : result.status === 'partial' ? 'repoPartial' : 'repoError')}
                  </Badge>
                  <span className="text-v2-micro text-v2-ink-3">{text.t('repoTasks', { n: result.tasks.length })}</span>
                  <span className="text-v2-micro text-v2-ink-3" title={result.observedAt}>
                    {text.t('readAt', { age: formatAge(minutesSince(result.observedAt), locale) })}
                  </span>
                  {gh.phase === 'loading' ? <span className="text-v2-micro text-v2-ink-2">{text.t('repoRefreshing')}</span> : null}
                  {mayHaveMore(result) ? <span className="text-v2-micro text-v2-ink-2">{text.t('repoMore')}</span> : null}
                  {errorMessages(result).map((message) => (
                    <span key={message} className="w-full text-v2-micro text-v2-ink-2">
                      {message}
                    </span>
                  ))}
                </>
              ) : (
                <span className="text-v2-micro text-v2-ink-3">{gh.phase === 'loading' ? text.t('refreshing') : text.t('githubNotLoaded')}</span>
              )}
              <span className="flex-1" />
              <IconButton
                size="sm"
                label={text.t('removeRepo', { repo })}
                icon={<Icon name="close" size={14} />}
                disabled={gh.phase === 'loading'}
                onClick={() => {
                  updateRepos(prefs.repos.filter((existing) => existing !== repo));
                  // The row (and this button) is about to disappear; keep keyboard focus inside the HUD.
                  document.getElementById(`${ID}-add-repo`)?.focus();
                }}
              />
            </li>
          );
        })}
      </ul>
      <form onSubmit={add} className="flex flex-wrap items-center gap-v2-sm">
        <label htmlFor={`${ID}-add-repo`} className="sr-only">
          {text.t('addRepoLabel')}
        </label>
        <input
          id={`${ID}-add-repo`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={text.t('addRepoPlaceholder')}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${ID}-add-repo-problem` : undefined}
          className="h-v2-control-sm w-64 rounded-v2-sm bg-v2-surface px-2.5 text-v2-meta text-v2-ink ring-1 ring-inset ring-v2-line-strong placeholder:text-v2-ink-3"
        />
        <Button size="sm" type="submit" disabled={gh.phase === 'loading'}>
          {text.t('addRepo')}
        </Button>
        {problem ? (
          <span id={`${ID}-add-repo-problem`} role="alert" className="text-v2-micro text-v2-ink-2">
            {problem}
          </span>
        ) : null}
      </form>
    </Card>
  );
}
