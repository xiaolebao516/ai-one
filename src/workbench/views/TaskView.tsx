import { useMemo, useState, type ReactNode } from 'react';
import type { DispatchSnapshot } from '../../dispatch/types';
import type { Locale } from '../../i18n/resolve';
import {
  effectiveCi,
  formatAge,
  isNeedsYou,
  pickText,
  reviewIsCurrent,
  shortSha,
  type HudTask,
  type HudEvidence,
} from '../../ui/taskHudModel';
import { taskHudText } from '../../ui/taskHudText';
import { Badge, Button, Card, Icon, Notice, SectionHeader } from '../../ui/v2';
import { TaskAcceptanceActions } from '../drawer/TaskAcceptanceActions';
import { TaskCommentBox } from '../drawer/TaskCommentBox';
import { TaskDrawer, type DrawerTabKey } from '../drawer/TaskDrawer';
import { TaskNotificationIsland } from '../drawer/TaskNotificationIsland';
import { TaskPauseControl, type PauseState } from '../drawer/TaskPauseControl';
import { TaskTakeoverBanner } from '../drawer/TaskTakeoverBanner';
import { derivePauseState, formatCommentBody, formatPauseBody } from '../../host/githubWrite';
import { getTakeoverAi, setStoredTakeoverAi } from '../workbenchStorage';
import { StageStrip, TaskStatus } from '../TaskBits';
import { workbenchText } from '../workbenchText';

export interface TaskViewProps {
  locale: Locale;
  task: HudTask;
  onBack: () => void;
  dispatchSnapshot?: DispatchSnapshot | null;
  onOpenClassic?: () => void;
  onTakeoverAi?: (aiName: string) => void;
  onRefreshData?: () => Promise<void> | void;
  onNavigateTask?: (task: HudTask) => void;
}

const EVIDENCE_TONE = { readback: 'done', local: 'run', self: 'neutral', unverified: 'unknown' } as const;

interface TeamMember {
  name: string;
  role: string;
  type: 'local' | 'web';
}

/** Task page (design §5, §6): now → needs you → stages and evidence, inspector drawer, pause, comment, accept/reject & takeover. */
export function TaskView({
  locale,
  task,
  onBack,
  dispatchSnapshot,
  onOpenClassic: _onOpenClassic,
  onTakeoverAi,
  onRefreshData,
  onNavigateTask,
}: TaskViewProps) {
  const isZh = locale.startsWith('zh');
  const text = workbenchText(locale);
  const hud = taskHudText(locale);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTabKey>('dispatch');
  const [takeoverAi, setTakeoverAi] = useState<string | null>(() => getTakeoverAi());
  const [extraEvidence, setExtraEvidence] = useState<HudEvidence[]>([]);
  const [reviewedHead, setReviewedHead] = useState<string>(() => task.pr?.headSha || '');

  const allEvidence = useMemo(() => [...task.evidence, ...extraEvidence], [task.evidence, extraEvidence]);

  const openDrawer = (tab: DrawerTabKey) => {
    setActiveDrawerTab(tab);
    setDrawerOpen(true);
  };

  const handleTakeover = (name: string) => {
    setTakeoverAi(name);
    setStoredTakeoverAi(name);
    onTakeoverAi?.(name);
  };

  const initialPauseState: PauseState = useMemo(() => {
    type PauseEntry = { body: string; time: number };
    const pauseComments: PauseEntry[] = [];
    for (const item of allEvidence) {
      if (item.raw && item.raw.includes('ai-one:set_pause:v1')) {
        let time = 0;
        if (item.observedMinutesAgo !== undefined) {
          time = Date.now() - (item.observedMinutesAgo * 60000);
        }
        if (!time) {
          const match = String(item.id).match(/\d{10,}/);
          if (match) time = parseInt(match[0], 10);
        }
        pauseComments.push({ body: item.raw, time: time || 0 });
      }
    }
    if (pauseComments.length === 0) return 'none';
    pauseComments.sort((a, b) => a.time - b.time);
    const derived = derivePauseState(pauseComments);
    return derived.paused ? 'paused' : 'running';
  }, [allEvidence]);

  // Team members derived from task or standard multi-AI workflow
  const teamMembers: TeamMember[] = [
    {
      name: task.owner ? pickText(task.owner, locale) : 'Claude Code',
      role: isZh ? '主协调 / 执行' : 'Coordinator / Executor',
      type: 'local',
    },
    {
      name: 'ChatGPT (Pro)',
      role: isZh ? '独立审计' : 'Independent Reviewer',
      type: 'web',
    },
    {
      name: 'Argon',
      role: isZh ? '需求讨论' : 'Deliberation',
      type: 'web',
    },
  ];

  return (
    <div className="relative flex min-h-full flex-col min-[1320px]:flex-row">
      <div className="flex-1 min-w-0">
        {takeoverAi ? (
          <TaskTakeoverBanner
            participantName={takeoverAi}
            locale={locale}
            onExit={() => {
              setTakeoverAi(null);
              setStoredTakeoverAi(null);
            }}
          />
        ) : null}

        <div className="mx-auto grid w-full max-w-[920px] content-start gap-v2-section p-v2-page-narrow min-[1100px]:p-v2-page-mid min-[1320px]:p-v2-page">
          <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-v2-sm text-v2-meta text-v2-ink-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setStoredTakeoverAi(null);
                onBack();
              }}
              icon={<Icon name="arrowLeft" size={14} />}
            >
              {text.t('backToTasks')}
            </Button>
            <span>{task.repo}</span>
            {task.issue ? <Badge>#{task.issue}</Badge> : null}
            {task.pr ? <Badge icon={<Icon name="gitPr" size={12} />}>PR #{task.pr.number}</Badge> : null}
          </nav>

          <header className="flex flex-wrap items-start justify-between gap-v2-md">
            <h1 className="min-w-0 font-v2-serif text-v2-heading text-v2-ink">{pickText(task.title, locale)}</h1>
            <div className="flex flex-wrap items-center gap-v2-sm">
              <TaskStatus task={task} locale={locale} />
              <TaskPauseControl
                task={{ ...task, evidence: allEvidence }}
                locale={locale}
                initialPauseState={initialPauseState}
                onStateChange={(next) => {
                  const ev: HudEvidence = {
                    id: `user-pause-${Date.now()}`,
                    kind: 'readback',
                    text: {
                      zh: next === 'paused' ? '你 · 已暂停任务' : '你 · 已恢复任务',
                      en: next === 'paused' ? 'You · Paused task' : 'You · Resumed task',
                    },
                    raw: formatPauseBody(next === 'paused' ? 'paused' : 'running'),
                    observedMinutesAgo: 0,
                  };
                  setExtraEvidence((prev) => [...prev, ev]);
                }}
              />
            </div>
          </header>

          {task.stages.length ? <StageStrip stages={task.stages} locale={locale} /> : null}

          <Card accent={isNeedsYou(task.status) ? 'you' : undefined} className="grid gap-v2-xs">
            <span className="text-v2-meta text-v2-ink-3">{text.t('now')}</span>
            <p className="font-v2-serif text-v2-lead font-medium leading-snug text-v2-ink">{pickText(task.summary, locale)}</p>
            {task.nextStep ? (
              <p className="text-v2-meta text-v2-ink-2">
                {text.t('nextStep')}: {pickText(task.nextStep, locale)}
                {task.owner ? ` · ${text.t('owner')}: ${pickText(task.owner, locale)}` : ''}
              </p>
            ) : null}
            <p className="text-v2-micro text-v2-ink-3">{text.t('updated', { age: formatAge(task.updatedMinutesAgo, locale) })}</p>
          </Card>

          {isNeedsYou(task.status) ? (
            <section aria-labelledby="task-needs-you">
              <Card accent="you" className="grid gap-v2-xs">
                <div className="flex flex-wrap items-center gap-v2-sm">
                  <h2 id="task-needs-you" className="font-semibold text-v2-ink">
                    {text.t('taskNeedsYou')}
                  </h2>
                  <Badge tone={task.status === 'blocked' ? 'block' : 'you'}>{hud.needKind(task.status)}</Badge>
                </div>
                <p className="text-v2-body text-v2-ink">{task.nextStep ? pickText(task.nextStep, locale) : text.t('taskNeedsYouNone')}</p>
                {task.owner ? (
                  <p className="text-v2-meta text-v2-ink-2">
                    {text.t('owner')}: {pickText(task.owner, locale)}
                  </p>
                ) : null}
                <p className="text-v2-meta text-v2-ink-3">{text.t('taskNeedsYouWhere')}</p>

                {/* Acceptance actions on acceptance card */}
                {task.status === 'accept' ? (
                  <TaskAcceptanceActions
                    task={{ ...task, evidence: allEvidence }}
                    locale={locale}
                    expectedHeadSha={reviewedHead}
                    currentHeadSha={task.pr?.headSha || ''}
                    onRefreshHead={async () => {
                      await onRefreshData?.();
                      if (task.pr?.headSha) setReviewedHead(task.pr.headSha);
                    }}
                  />
                ) : null}
              </Card>
            </section>
          ) : null}

          {task.gap ? (
            <Notice tone="unknown" title={text.t('gap')}>
              {pickText(task.gap, locale)}
            </Notice>
          ) : null}

          <section aria-labelledby="task-evidence">
            <div className="flex flex-wrap items-center justify-between gap-v2-sm">
              <SectionHeader id="task-evidence" level={2} title={text.t('evidence')} />
              <div className="flex flex-wrap items-center gap-v2-xs text-v2-micro text-v2-ink-3">
                <span>{isZh ? '直跳检查器：' : 'Inspector jump:'}</span>
                <button
                  type="button"
                  onClick={() => openDrawer('dispatch')}
                  className="hover:text-v2-ink hover:underline"
                >
                  {isZh ? '派工单 ›' : 'Dispatch ›'}
                </button>
                <button
                  type="button"
                  onClick={() => openDrawer('response')}
                  className="hover:text-v2-ink hover:underline"
                >
                  {isZh ? '原始回复 ›' : 'Response ›'}
                </button>
                <button
                  type="button"
                  onClick={() => openDrawer('diff')}
                  className="hover:text-v2-ink hover:underline"
                >
                  Diff ›
                </button>
                <button
                  type="button"
                  onClick={() => openDrawer('tests')}
                  className="hover:text-v2-ink hover:underline"
                >
                  {isZh ? '测试 ›' : 'Tests ›'}
                </button>
              </div>
            </div>

            {allEvidence.length ? (
              <ul className="mt-v2-sm grid gap-v2-sm">
                {allEvidence.map((item) => (
                  <li key={item.id}>
                    <Card padding="sm" className="grid content-start gap-v2-xs">
                      <div className="flex flex-wrap items-center justify-between gap-v2-sm">
                        <span className="text-v2-body text-v2-ink">{pickText(item.text, locale)}</span>
                        <div className="flex items-center gap-v2-xs">
                          <Badge tone={EVIDENCE_TONE[item.kind as keyof typeof EVIDENCE_TONE]}>{hud.evidence(item.kind, task.dataSource)}</Badge>
                          <span className="text-v2-micro text-v2-ink-3">
                            {formatAge(item.observedMinutesAgo, locale)}
                          </span>
                        </div>
                      </div>
                      {item.raw ? (
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-v2-sm bg-v2-sunken p-v2-sm font-v2-mono text-v2-micro text-v2-ink-2">
                          {item.raw}
                        </pre>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-v2-sm text-v2-meta text-v2-ink-3">{isZh ? '暂无证据' : 'No evidence'}</p>
            )}
          </section>

          {/* Comment section (Design §6.4) */}
          <section aria-labelledby="task-comments">
            <TaskCommentBox
              task={{ ...task, evidence: allEvidence }}
              locale={locale}
              onCommentSent={(sentText) => {
                const ev: HudEvidence = {
                  id: `user-comment-${Date.now()}`,
                  kind: 'readback',
                  text: { zh: '你 · 留言已发出并回读', en: 'You · Message sent and read back' },
                  raw: formatCommentBody(sentText),
                  observedMinutesAgo: 0,
                };
                setExtraEvidence((prev) => [ev, ...prev]);
              }}
            />
          </section>
        </div>
      </div>

      <aside
        aria-label={text.t('delivery')}
        className="w-full shrink-0 border-t border-v2-line bg-v2-sunken/40 p-v2-page-narrow min-[1100px]:p-v2-page-mid min-[1320px]:w-[280px] min-[1320px]:border-l min-[1320px]:border-t-0 min-[1320px]:p-v2-page"
      >
        <div className="flex items-center justify-between">
          <SectionHeader level={2} title={text.t('delivery')} />
          <Button
            data-testid="inspector-button"
            size="sm"
            variant="secondary"
            onClick={() => setDrawerOpen(true)}
            icon={<Icon name="search" size={14} />}
          >
            {isZh ? '检查器' : 'Inspector'}
          </Button>
        </div>

        <dl className="mt-v2-sm grid gap-v2-sm text-v2-meta">
          <Fact label={text.t('issue')}>{task.issue ? `#${task.issue}` : text.t('unknownValue')}</Fact>
          <Fact label={text.t('pr')}>
            {task.pr ? `#${task.pr.number}${task.pr.draft ? ` · ${text.t('prDraft')}` : ''}` : text.t('unknownValue')}
          </Fact>
          <Fact label={text.t('head')}>
            {task.pr?.headSha ? <code className="font-v2-mono">{shortSha(task.pr.headSha)}</code> : text.t('unknownValue')}
          </Fact>
          <Fact label={text.t('ci')}>
            <CiFact task={task} locale={locale} />
          </Fact>
          <Fact label={text.t('review')}>
            {task.review && task.review.verdict !== 'none'
              ? `${hud.verdict(task.review.verdict)}${reviewIsCurrent(task) ? '' : ` · ${text.t('reviewStale')}`}`
              : text.t('reviewNone')}
          </Fact>
        </dl>

        {/* Team section with takeover buttons for web AI (Design §6.2) */}
        <div className="mt-v2-md border-t border-v2-line/60 pt-v2-sm">
          <SectionHeader level={3} title={isZh ? '团队' : 'Team'} />
          <ul className="mt-v2-xs grid gap-v2-xs text-v2-meta">
            {teamMembers.map((member) => (
              <li
                key={member.name}
                className="flex items-center justify-between rounded-v2-sm bg-v2-sunken/40 px-2 py-1.5"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-v2-ink">{member.name}</span>
                  <span className="text-v2-micro text-v2-ink-3">{member.role}</span>
                </div>
                {member.type === 'web' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleTakeover(member.name)}
                  >
                    {isZh ? '接管' : 'Take over'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Inspector Drawer (Design §6.1) */}
      <TaskDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeTab={activeDrawerTab}
        onTabChange={setActiveDrawerTab}
        task={{ ...task, evidence: allEvidence }}
        locale={locale}
        snapshot={dispatchSnapshot ?? undefined}
      />

      {/* Notification Island (Design §6.7) */}
      <TaskNotificationIsland
        task={task}
        locale={locale}
        onNavigate={() => {
          if (onNavigateTask) {
            onNavigateTask(task);
          } else if (typeof window !== 'undefined') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }}
      />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-v2-xs">
      <dt className="text-v2-ink-3">{label}</dt>
      <dd className="font-medium text-v2-ink">{children}</dd>
    </div>
  );
}

function CiFact({ task, locale }: { task: HudTask; locale: Locale }) {
  const hud = taskHudText(locale);
  const ci = effectiveCi(task);
  if (ci.state === 'unknown') {
    return <span className="text-v2-ink-3">{hud.ci(ci.state)}</span>;
  }
  const tone = ci.state === 'success' ? 'done' : ci.state === 'failure' ? 'block' : 'run';
  return <Badge tone={tone}>{hud.ci(ci.state)}</Badge>;
}
