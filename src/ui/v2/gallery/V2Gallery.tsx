import { useEffect, useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  IconButton,
  LoadingState,
  Notice,
  SectionHeader,
  Select,
  SegmentedControl,
  StatusIndicator,
  TabPanel,
  Tabs,
  V2Scope,
  V2_SKINS,
  V2_SKIN_IDS,
  V2_STATUS_TONES,
  v2CssVariables,
  type V2Mode,
  type V2SkinId,
  type V2StatusTone,
} from '..';
import { DispatchGallery } from './DispatchGallery';
import { SessionCheckpointNotice } from '../../SessionCheckpointNotice';
import { SettingsUpdateRow, type SettingsUpdateRowLabels } from '../../SettingsUpdateRow';
import { TaskHudEntry } from '../../TaskHudEntry';
import { contrastRatio } from '../contrast';
import { DiscussionMatrix } from '../../../stages/DiscussionMatrix';
import { SummaryCard } from '../../../stages/SummaryCard';
import {
  buildDiscussionViewModel,
  createDiscussionRunStateFromOutputs,
  type DiscussionNodeStatus,
  type DiscussionRunState,
} from '../../../stages/discussionViewModel';
import { readGalleryParams, tokenDifferences, writeGalleryParams, type GalleryParams } from './galleryParams';

/*
 * Development-only component gallery (#41), served by Vite at /v2-gallery.html and never part of the
 * production bundle or App routes. Both visual schemes render the same sections; only the tokens
 * differ, which is the point of the comparison view.
 */

const RADIUS_CLASS = { sm: 'rounded-v2-sm', md: 'rounded-v2-md', lg: 'rounded-v2-lg', xl: 'rounded-v2-xl' } as const;

const TONE_LABEL: Record<V2StatusTone, string> = {
  run: '进行中',
  rework: '返工中',
  you: '需要你',
  block: '阻塞',
  done: '已完成',
  paused: '已暂停',
  unknown: '未知',
};

export function V2Gallery() {
  const [params, setParams] = useState<GalleryParams>(() => readGalleryParams(window.location.search));

  useEffect(() => {
    // Mirror the app: dark themes set html.dark, and v2 scopes in `auto` mode follow it.
    document.documentElement.classList.toggle('dark', params.mode === 'dark');
    window.history.replaceState(null, '', `${window.location.pathname}${writeGalleryParams(params)}`);
  }, [params]);

  const update = (patch: Partial<GalleryParams>) => setParams((current) => ({ ...current, ...patch }));
  const skins: V2SkinId[] = params.compare ? V2_SKIN_IDS : [params.skin];

  return (
    <V2Scope skin={params.skin} className="min-h-screen bg-v2-bg">
      <header className="sticky top-0 z-10 border-b border-v2-line bg-v2-panel px-v2-page py-v2-md">
        <div className="flex flex-wrap items-center gap-v2-md">
          <div className="mr-auto">
            <h1 className="m-0 text-v2-heading text-v2-ink">ai-one v2 UI Foundation</h1>
            <p className="m-0 text-v2-meta text-v2-ink-2">组件陈列（开发态预览）。派工回执支持在桌面端手动读取本机元数据。</p>
          </div>
          <SegmentedControl
            label="视觉方案"
            idBase="gallery-skin"
            value={params.compare ? 'compare' : params.skin}
            options={[
              ...V2_SKIN_IDS.map((id) => ({ value: id, label: V2_SKINS[id].label })),
              { value: 'compare', label: '并排对比' },
            ]}
            onChange={(value) => (value === 'compare' ? update({ compare: true }) : update({ skin: value as V2SkinId, compare: false }))}
          />
          <SegmentedControl
            label="明暗"
            idBase="gallery-mode"
            value={params.mode}
            options={[
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
            onChange={(value) => update({ mode: value as V2Mode })}
          />
        </div>
      </header>

      <main className={params.compare ? 'grid grid-cols-1 gap-v2-lg p-v2-lg xl:grid-cols-2' : 'mx-auto max-w-5xl p-v2-page'}>
        {skins.map((skin) => (
          <V2Scope key={skin} skin={skin} className="min-w-0 rounded-v2-xl bg-v2-panel p-v2-xl shadow-v2-card">
            <GallerySections skin={skin} mode={params.mode} compact={params.compare} />
          </V2Scope>
        ))}
        {params.compare ? <TokenDiff mode={params.mode} /> : null}
      </main>
    </V2Scope>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-v2-md">
      <SectionHeader id={id} title={title} description={note} />
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-v2-sm">{children}</div>;
}

function GallerySections({ skin, mode, compact }: { skin: V2SkinId; mode: V2Mode; compact: boolean }) {
  const [tab, setTab] = useState('overview');
  const [status, setStatus] = useState('all');
  const [repo, setRepo] = useState('all');
  const [pinned, setPinned] = useState(false);
  const [discussionDemo, setDiscussionDemo] = useState<DiscussionDemoCase>('converged');
  const [discussionReplayInput, setDiscussionReplayInput] = useState('');
  const [discussionReplayState, setDiscussionReplayState] = useState<DiscussionRunState | null>(null);
  const [discussionReplayError, setDiscussionReplayError] = useState('');
  const discussionView = buildDiscussionViewModel(
    discussionReplayState ?? createDiscussionDemoState(discussionDemo),
  );
  const loadDiscussionReplay = () => {
    try {
      const parsed: unknown = JSON.parse(discussionReplayInput);
      if (!Array.isArray(parsed) || !parsed.every((item): item is string => typeof item === 'string')) {
        setDiscussionReplayState(null);
        setDiscussionReplayError('请粘贴有效的 JSON 字符串数组。');
        return;
      }
      setDiscussionReplayState(createDiscussionRunStateFromOutputs(parsed));
      setDiscussionReplayError('');
    } catch {
      setDiscussionReplayState(null);
      setDiscussionReplayError('读取失败：请检查 JSON 格式，并确认数组不超过 11 项。');
    }
  };
  const definition = V2_SKINS[skin];
  const ids = (name: string) => `${skin}-${name}`;

  return (
    <div className="flex flex-col gap-v2-xl">
      <div>
        <div className="text-v2-title text-v2-ink">{definition.label}</div>
        <p className="m-0 mt-1 text-v2-body text-v2-ink-2">{definition.description}</p>
      </div>

      <Section id={ids('dispatch')} title="派工通道 / 派工回执" note="演示与本机元数据；仅展示，不提供派工或恢复操作">
        <DispatchGallery />
      </Section>

      <Divider />

      <Section id={ids('discussion')} title="讨论阶段" note="D0 独立初评 → 最多 3 轮交换与审计">
        <div className="flex min-w-0 flex-col gap-v2-md">
          {discussionReplayState ? (
            <Notice tone="done" title="真实记录回放">
              当前矩阵只使用本页粘贴的输出文本，不会上传。解析不到的字段会显示“未提供”或“未能解析”。
            </Notice>
          ) : (
            <Notice tone="unknown" title="演示数据">
              以下场景均为合成数据，不代表真实讨论记录。
            </Notice>
          )}
          <SegmentedControl
            label="演示场景"
            idBase={ids('discussion-demo')}
            value={discussionDemo}
            options={[
              { value: 'converged', label: '完成且收敛' },
              { value: 'unresolved', label: '未收敛' },
              { value: 'timeout-skip', label: '超时 / 跳过' },
              { value: 'audit-missing', label: '审计缺项' },
              { value: 'running', label: '进行中' },
            ]}
            onChange={(value) => {
              setDiscussionDemo(value as DiscussionDemoCase);
              setDiscussionReplayState(null);
              setDiscussionReplayError('');
            }}
          />
          <DiscussionMatrix model={discussionView.matrix} />
          <SummaryCard model={discussionView.summary} />
          <Card variant="flat" className="flex min-w-0 flex-col gap-v2-md">
            <SectionHeader title="用真实讨论记录回放" description="本页本地解析，不上传记录。" level={3} />
            <p className="m-0 break-words text-v2-meta text-v2-ink-2">
              粘贴 JSON 字符串数组，按顺序填写 first、second，然后依次填写每轮的 roundN_first、roundN_second、auditN；最多 11 项，允许只填前几项。
            </p>
            <textarea
              aria-label="真实讨论输出 JSON 数组"
              className="min-h-28 w-full min-w-0 resize-y rounded-v2-md border border-v2-line bg-v2-surface p-v2-md font-v2-mono text-v2-meta text-v2-ink"
              rows={5}
              value={discussionReplayInput}
              onChange={(event) => setDiscussionReplayInput(event.target.value)}
              placeholder={'["first 的完整输出", "second 的完整输出", "..."]'}
            />
            {discussionReplayError ? (
              <Notice tone="block" title="无法加载回放">{discussionReplayError}</Notice>
            ) : null}
            <div className="flex flex-wrap gap-v2-sm">
              <Button
                disabled={!discussionReplayInput.trim()}
                disabledReason={discussionReplayInput.trim() ? undefined : '请先粘贴 JSON 字符串数组。'}
                onClick={loadDiscussionReplay}
              >
                加载真实输出数组
              </Button>
              <Button
                onClick={() => {
                  setDiscussionReplayState(null);
                  setDiscussionReplayError('');
                }}
              >
                恢复演示数据
              </Button>
            </div>
          </Card>
        </div>
      </Section>

      <Divider />

      <Section id={ids('tokens')} title="令牌" note="色块直接读取 --v2-* 变量；数字为 WCAG 对比度">
        <TokenSwatches skin={skin} mode={mode} compact={compact} />
      </Section>

      <Divider />

      <Section id={ids('type')} title="字号与圆角">
        <div className="flex flex-col gap-1">
          <span className="text-v2-title">页面标题 24 · 3 个任务在推进</span>
          <span className="text-v2-heading">任务标题 19 · 讨论结束后必定生成最终报告</span>
          <span className="text-v2-lead">现在 16 · 全部完成，等你验收。</span>
          <span className="text-v2-body">正文 13 · 审计针对当前完整 HEAD，HEAD 变了就重审。</span>
          <span className="text-v2-meta text-v2-ink-2">元信息 12 · ai-one #39 · 12 分钟前</span>
          <span className="font-v2-mono text-v2-meta text-v2-ink-2">等宽 · 7be41d2c9a0f3e5b8d1c4a6f2e9b0d3c5a7f1e2d</span>
        </div>
        <Row>
          {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
            <div key={size} className={`grid h-14 w-20 place-items-center bg-v2-sunken text-v2-meta text-v2-ink-2 ${RADIUS_CLASS[size]}`}>
              {size} {definition.shape.radius[size]}
            </div>
          ))}
          <div className="grid h-14 w-28 place-items-center rounded-v2-lg bg-v2-surface text-v2-meta text-v2-ink-2 shadow-v2-card">card 阴影</div>
          <div className="grid h-14 w-28 place-items-center rounded-v2-lg bg-v2-surface text-v2-meta text-v2-ink-2 shadow-v2-float">浮层阴影</div>
        </Row>
      </Section>

      <Divider />

      <Section id={ids('buttons')} title="按钮" note="悬停 / Tab 聚焦请直接操作">
        <Row>
          <Button variant="primary">开始</Button>
          <Button>查看详情</Button>
          <Button variant="ghost">取消</Button>
          <Button variant="attention">查看验收单</Button>
          <Button variant="danger">停止</Button>
        </Row>
        <Row>
          <Button size="sm" variant="primary">
            小号主按钮
          </Button>
          <Button size="sm" icon={<Icon name="external" size={14} />}>
            在 GitHub 打开
          </Button>
          <Button variant="primary" loading>
            回读中
          </Button>
          <Button variant="primary" disabled disabledReason="合并只能由你在 GitHub 确认">
            合并 PR
          </Button>
          <IconButton label="刷新" icon={<Icon name="refresh" />} />
          <IconButton label="固定" icon={<Icon name="layers" />} pressed={pinned} onClick={() => setPinned((value) => !value)} variant="secondary" />
          <IconButton label="关闭" icon={<Icon name="close" />} disabled disabledReason="示例：不可关闭" />
        </Row>
      </Section>

      <Divider />

      <Section id={ids('status')} title="状态与标签" note="颜色 + 形状 + 文字">
        <Row>
          {V2_STATUS_TONES.map((tone) => (
            <StatusIndicator key={tone} tone={tone} label={TONE_LABEL[tone]} />
          ))}
        </Row>
        <Row>
          {V2_STATUS_TONES.map((tone) => (
            <StatusIndicator key={tone} tone={tone} label={TONE_LABEL[tone]} variant="pill" />
          ))}
        </Row>
        <Row>
          <Badge>草稿</Badge>
          <Badge tone="done">CI 通过</Badge>
          <Badge tone="block">CI 失败</Badge>
          <Badge tone="run">CI 运行中</Badge>
          <Badge tone="unknown">CI 未知</Badge>
          <Badge variant="outline">执行者自述</Badge>
          <Badge variant="outline" tone="done">
            已回读
          </Badge>
          <Badge variant="outline" tone="unknown">
            未验证
          </Badge>
          <Badge size="md" tone="you">
            3 件事等你
          </Badge>
        </Row>
      </Section>

      <Divider />

      <Section id={ids('cards')} title="卡片">
        <div className={compact ? 'grid grid-cols-1 gap-v2-md' : 'grid grid-cols-3 gap-v2-md'}>
          <Card>
            <div className="font-semibold">raised</div>
            <div className="text-v2-meta text-v2-ink-2">默认卡片：表层 + 发丝阴影</div>
          </Card>
          <Card variant="flat">
            <div className="font-semibold">flat</div>
            <div className="text-v2-meta text-v2-ink-2">描边卡片，适合列表</div>
          </Card>
          <Card variant="sunken">
            <div className="font-semibold">sunken</div>
            <div className="text-v2-meta text-v2-ink-2">凹槽，适合次要信息</div>
          </Card>
        </div>
        <Card accent="you" className="flex flex-col gap-v2-sm">
          <div className="flex flex-wrap items-center gap-v2-sm">
            <Badge tone="you">验收</Badge>
            <span className="font-semibold">示意组合：PR #40 已就绪，等你验收</span>
          </div>
          <div className="text-v2-meta text-v2-ink-2">组合示例（不是 HUD）：Card accent=you + Badge + 按钮。数据为虚构。</div>
          <Row>
            <Button size="sm" variant="attention">
              查看验收单
            </Button>
            <Button size="sm" variant="ghost">
              稍后
            </Button>
          </Row>
        </Card>
      </Section>

      <Divider />

      <Section id={ids('nav')} title="导航与筛选" note="方向键 / Home / End 可切换">
        <Tabs
          label="示例标签页"
          idBase={ids('tabs')}
          value={tab}
          onChange={setTab}
          items={[
            { id: 'overview', label: '总览' },
            { id: 'list', label: '任务', count: 6 },
            { id: 'flows', label: '阶段与流程', disabled: true },
          ]}
        />
        <TabPanel idBase={ids('tabs')} id="overview" active={tab === 'overview'} className="text-v2-meta text-v2-ink-2">
          “总览”面板内容。“阶段与流程”为禁用示例。
        </TabPanel>
        <TabPanel idBase={ids('tabs')} id="list" active={tab === 'list'} className="text-v2-meta text-v2-ink-2">
          “任务”面板内容。
        </TabPanel>
        <TabPanel idBase={ids('tabs')} id="flows" active={tab === 'flows'} />
        <Row>
          <SegmentedControl
            label="状态筛选"
            idBase={ids('status-filter')}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: '全部', count: 9 },
              { value: 'run', label: '进行中', count: 3 },
              { value: 'you', label: '需要你', count: 3 },
              { value: 'done', label: '已完成', count: 0, disabled: true },
            ]}
          />
          <Select
            id={ids('repo')}
            label="仓库"
            value={repo}
            onChange={setRepo}
            options={[
              { value: 'all', label: '全部仓库' },
              { value: 'demo/orbit', label: 'demo/orbit' },
              { value: 'demo/notes', label: 'demo/notes' },
            ]}
          />
          <Select id={ids('repo-disabled')} label="禁用" hideLabel disabled value="x" onChange={() => {}} options={[{ value: 'x', label: '禁用的选择框' }]} size="sm" />
        </Row>
        <div className="text-v2-meta text-v2-ink-3">
          当前：状态 {status} · 仓库 {repo}
        </div>
      </Section>

      <Divider />

      <Section id={ids('notices')} title="提示">
        <Notice tone="you" title="演示数据 · 尚未连接 GitHub">
          这里的任务、提交和 CI 都是虚构示例。
        </Notice>
        <Notice tone="block" title="Argon 登录已失效" actions={<Button size="sm">打开登录页</Button>}>
          notes-sync #12 正在等它。
        </Notice>
        <Notice tone="done">已回读：CI 对应当前完整 HEAD。</Notice>
        <Notice tone="unknown">CI 未知：没有读到与当前 HEAD 对应的检查结果。</Notice>
        <Notice>中性提示：没有颜色语义。</Notice>
      </Section>

      <Divider />

      <Section id={ids('migrated')} title="已迁移的旧界面（#42）" note="真实组件，示例数据；随本栏方案一起变化">
        <TaskHudEntryPreview />
        <SessionCheckpointNotice
          notice={{ checkpoint: { graphId: 'debate', graphVersion: 1, mode: 'debate', questionHash: 'demo', stepIndex: 2, startedAt: '', updatedAt: '' }, replaySnapshot: { id: 'demo', graphId: 'debate' } }}
          onDismiss={() => {}}
          onReplay={() => {}}
          locale="zh-CN"
        />
        <SettingsUpdateRow state={{ status: 'idle' }} onCheck={() => {}} labels={UPDATE_LABELS} />
        <SettingsUpdateRow state={{ status: 'up-to-date', version: 'v1.9.7' }} onCheck={() => {}} labels={UPDATE_LABELS} />
        <SettingsUpdateRow state={{ status: 'error', message: '网络不可用（示例）' }} onCheck={() => {}} labels={UPDATE_LABELS} />
      </Section>

      <Divider />

      <Section id={ids('states')} title="空态与加载">
        <div className={compact ? 'grid grid-cols-1 gap-v2-md' : 'grid grid-cols-2 gap-v2-md'}>
          <EmptyState title="没有匹配的任务" description="换一个仓库或状态试试。" action={<Button size="sm">清除筛选</Button>} />
          <EmptyState tone="unknown" title="状态未知" description="未能读取数据，不把它当成“没有待办”。" />
        </div>
        <LoadingState label="正在读取任务…" />
      </Section>
    </div>
  );
}


type DiscussionDemoCase = 'converged' | 'unresolved' | 'timeout-skip' | 'audit-missing' | 'running';

function demoDecision(status: 'AGREE' | 'REVISE', proposal: string, issues: string): string {
  return 'Synthetic reply with enough context for the structured deliberation parser.\n\n'
    + '[[AI_ONE_DECISION:' + status + ']]\n'
    + '[[AI_ONE_PROPOSAL:' + proposal + ']]\n'
    + '[[AI_ONE_OPEN_ISSUES:' + issues + ']]';
}

function demoAudit(decision: 'CONTINUE' | 'FINISH', result: 'AGREED' | 'DISAGREEMENTS', question: string): string {
  return 'Synthetic audit report. This is demonstration content only, not evidence from a real run.\n\n'
    + '## Evidence-backed findings\nBoth sample participants supplied a structured decision.\n\n'
    + '## Shared conclusions\nThe example scope is clear.\n\n'
    + '## Disagreements\nThe remaining points are explicitly listed in the round outputs.\n\n'
    + '## Evidence gaps\nIndependent runtime evidence has not been attached to this synthetic example.\n\n'
    + '## Next steps\nRun verification in the target environment and preserve the result.\n\n'
    + '[[AI_ONE_AUDIT_DECISION:' + decision + ']]\n'
    + '[[AI_ONE_AUDIT_RESULT:' + result + ']]\n'
    + '[[AI_ONE_AUDIT_QUESTION:' + question + ']]';
}

function createDiscussionDemoState(kind: DiscussionDemoCase): DiscussionRunState {
  const outputs: Record<string, string> = {
    first: 'Synthetic independent initial assessment from first.',
    second: 'Synthetic independent initial assessment from second.',
  };
  const statusByNode: Record<string, DiscussionNodeStatus> = { first: 'done', second: 'done' };
  const markDone = (nodeId: string, output: string) => {
    outputs[nodeId] = output;
    statusByNode[nodeId] = 'done';
  };
  const sharedProposal = 'Use an explicit typed discussion view model';
  if (kind === 'converged') {
    for (const round of [1, 2, 3]) {
      markDone('round' + round + '_first', demoDecision('AGREE', sharedProposal, 'NONE'));
      markDone('round' + round + '_second', demoDecision('AGREE', sharedProposal, 'NONE'));
      markDone(
        'audit' + round,
        demoAudit(
          round === 3 ? 'FINISH' : 'CONTINUE',
          round === 3 ? 'AGREED' : 'DISAGREEMENTS',
          round === 3 ? 'NONE' : 'Please attach independent runtime evidence',
        ),
      );
    }
  } else if (kind === 'unresolved') {
    for (const round of [1, 2, 3]) {
      markDone('round' + round + '_first', demoDecision('AGREE', sharedProposal, 'NONE'));
      markDone('round' + round + '_second', demoDecision('REVISE', 'Keep the existing chat-only discussion view', 'Need proof of integration and usability'));
      markDone(
        'audit' + round,
        demoAudit(
          round === 3 ? 'FINISH' : 'CONTINUE',
          'DISAGREEMENTS',
          round === 3 ? 'NONE' : 'Please compare the conflicting implementation costs',
        ),
      );
    }
  } else if (kind === 'timeout-skip') {
    markDone('round1_first', demoDecision('AGREE', sharedProposal, 'NONE'));
    statusByNode.round1_second = 'timeout';
    statusByNode.audit1 = 'skipped';
    return {
      outputs,
      statusByNode,
      timedOutNodeIds: ['round1_second'],
      skippedNodeIds: ['audit1'],
    };
  } else if (kind === 'audit-missing') {
    markDone('round1_first', demoDecision('AGREE', sharedProposal, 'NONE'));
    markDone('round1_second', demoDecision('AGREE', sharedProposal, 'NONE'));
  } else {
    statusByNode.round1_first = 'running';
    return { outputs, statusByNode, activeNodeIds: ['round1_first'] };
  }
  return { outputs, statusByNode };
}

const UPDATE_LABELS: SettingsUpdateRowLabels = {
  checkForUpdates: '检查更新',
  checking: '检查中…',
  upToDate: '已是最新版本 {version}',
  newVersionAvailable: '有新版本 {version}',
  releasesUnavailable: '无法获取版本信息',
  updateCheckFailed: '检查更新失败：',
};

function TaskHudEntryPreview() {
  return (
    <div className="flex items-center gap-v2-sm text-v2-meta text-v2-ink-3">
      聊天工具栏入口：
      <TaskHudEntry locale="zh-CN" onOpen={() => {}} />
    </div>
  );
}

const COLOR_GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: '表层', keys: ['bg', 'panel', 'surface', 'sunken', 'line', 'line-strong'] },
  { title: '文字与操作', keys: ['ink', 'ink-2', 'ink-3', 'primary', 'focus', 'island'] },
];

function TokenSwatches({ skin, mode, compact }: { skin: V2SkinId; mode: V2Mode; compact: boolean }) {
  const vars = v2CssVariables(skin, mode);
  const surface = vars['--v2-surface'];
  return (
    <div className="flex flex-col gap-v2-md">
      {COLOR_GROUPS.map((group) => (
        <div key={group.title}>
          <div className="mb-1 text-v2-meta text-v2-ink-3">{group.title}</div>
          <div className={compact ? 'grid grid-cols-3 gap-v2-sm' : 'grid grid-cols-6 gap-v2-sm'}>
            {group.keys.map((key) => (
              <Swatch key={key} name={key} value={vars[`--v2-${key}`]} ratio={key.startsWith('ink') ? contrastRatio(vars[`--v2-${key}`], surface) : undefined} />
            ))}
          </div>
        </div>
      ))}
      <div>
        <div className="mb-1 text-v2-meta text-v2-ink-3">状态（前景 / 柔和底 / 描边）</div>
        <div className={compact ? 'grid grid-cols-2 gap-v2-sm' : 'grid grid-cols-4 gap-v2-sm'}>
          {V2_STATUS_TONES.map((tone) => (
            <div key={tone} className="flex items-center gap-v2-sm rounded-v2-md bg-v2-surface p-v2-sm shadow-v2-card">
              <span className="h-6 w-6 rounded-v2-sm" style={{ background: `var(--v2-${tone})` }} />
              <span className="h-6 w-6 rounded-v2-sm" style={{ background: `var(--v2-${tone}-soft)`, boxShadow: `inset 0 0 0 1px var(--v2-${tone}-line)` }} />
              <span className="min-w-0 text-v2-micro text-v2-ink-2">
                {TONE_LABEL[tone]} <span className="text-v2-ink-3">{contrastRatio(vars[`--v2-${tone}`], vars[`--v2-${tone}-soft`], surface).toFixed(1)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Swatch({ name, value, ratio }: { name: string; value: string; ratio?: number }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-v2-md bg-v2-surface shadow-v2-card">
      <div className="h-9" style={{ background: `var(--v2-${name})` }} />
      <div className="px-v2-sm py-1">
        <div className="truncate font-v2-mono text-v2-micro text-v2-ink">--v2-{name}</div>
        <div className="truncate font-v2-mono text-v2-micro text-v2-ink-3" title={value}>
          {value}
          {ratio !== undefined ? ` · ${ratio.toFixed(1)}` : ''}
        </div>
      </div>
    </div>
  );
}

function TokenDiff({ mode }: { mode: V2Mode }) {
  const [a, b] = V2_SKIN_IDS;
  const rows = tokenDifferences(v2CssVariables(a, mode), v2CssVariables(b, mode));
  return (
    <Card as="section" className="xl:col-span-2" aria-labelledby="token-diff">
      <SectionHeader id="token-diff" title="两套方案的全部差异" count={rows.length} description={`${V2_SKINS[a].label} → ${V2_SKINS[b].label}（${mode === 'dark' ? '深色' : '浅色'}）：只有令牌值不同，组件与页面结构共用`} />
      <div className="mt-v2-md max-h-96 overflow-auto">
        <table className="w-full border-collapse text-left text-v2-micro">
          <thead className="text-v2-ink-3">
            <tr>
              <th className="py-1 pr-v2-md font-semibold">令牌</th>
              <th className="py-1 pr-v2-md font-semibold">{V2_SKINS[a].label}</th>
              <th className="py-1 font-semibold">{V2_SKINS[b].label}</th>
            </tr>
          </thead>
          <tbody className="font-v2-mono text-v2-ink-2">
            {rows.map((row) => (
              <tr key={row.name} className="border-t border-v2-line">
                <td className="py-1 pr-v2-md text-v2-ink">{row.name}</td>
                <td className="max-w-xs truncate py-1 pr-v2-md" title={row.a}>
                  {row.a}
                </td>
                <td className="max-w-xs truncate py-1" title={row.b}>
                  {row.b}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
