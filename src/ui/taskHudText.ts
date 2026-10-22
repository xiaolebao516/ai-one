import type { Locale } from '../i18n/resolve';
import { hudLocale, type CiView, type EvidenceKind, type HudStage, type TaskStatus } from './taskHudModel';

/**
 * Task HUD copy (#40). Kept in its own table instead of the shared i18n dictionaries so this
 * slice adds no keys to files that PR #19 also edits. English + Simplified Chinese; ja / de read English.
 */
const EN = {
  entryLabel: 'Tasks',
  entryDemo: 'Demo',
  entryAria: 'Open the task HUD (demo data): {inProgress} in progress, {needsYou} need you, {attention} failed or unknown',
  entryInProgress: '{n} active',
  entryNeedsYou: '{n} need you',
  title: 'Task HUD',
  back: 'Back to chat',
  tabsLabel: 'Task HUD views',
  tabOverview: 'Overview',
  tabList: 'Tasks',
  mockTitle: 'Demo data · not connected to GitHub',
  mockBody: 'Every task, commit, CI result and review here is a fictional example. Nothing was read from GitHub and nothing here changes GitHub.',
  scenarioLabel: 'Demo scenario',
  scenarioSample: 'Sample tasks',
  scenarioEmpty: 'Empty list',
  headline: '{inProgress} tasks moving, {needsYou} waiting for you',
  headlineNoNeeds: '{inProgress} tasks moving, nothing waiting for you',
  headlineEmpty: 'No tasks in this view',
  subline: 'Counts come from the demo data on this page, not from GitHub.',
  counterInProgress: 'In progress',
  counterNeedsYou: 'Needs you',
  counterAttention: 'Failed / unknown',
  counterHint: 'Show these tasks in the list',
  needsYouTitle: 'Needs you',
  needsYouHint: 'Decisions first, then blockers, then acceptances',
  inProgressTitle: 'In progress',
  otherTitle: 'Done and unknown',
  allTasks: 'All tasks',
  runtimeTitle: 'Agents, quota and live progress',
  runtimeBody: 'Unknown. GitHub data cannot show whether Claude Code or Prodex is running, which round it is on, login state or quota, and this HUD does not monitor them.',
  emptyTitle: 'No tasks',
  emptyBody: 'The "Empty list" demo scenario is selected. This is not a GitHub result.',
  openDetail: 'View details',
  repoLabel: 'Repository',
  repoAll: 'All repositories',
  statusLabel: 'Status filter',
  statusAll: 'All',
  listCount: '{n} tasks',
  noMatchTitle: 'No task matches these filters',
  noMatchBody: 'Try another repository or status.',
  clearFilters: 'Clear filters',
  backToOverview: 'Back to overview',
  backToList: 'Back to tasks',
  taskMissing: 'This task is not in the current data set.',
  now: 'Now',
  next: 'Next step',
  owner: 'Next actor',
  stages: 'Stages',
  delivery: 'Delivery',
  issue: 'Issue',
  pr: 'PR',
  noPr: 'No PR yet',
  draft: 'Draft',
  readyForReview: 'Ready for review',
  head: 'HEAD',
  headMissing: 'HEAD not read',
  ci: 'CI',
  review: 'Review',
  reviewNone: 'No independent review yet',
  reviewStale: 'Review was given on another HEAD; needs a new review',
  onSha: 'on {sha}',
  evidence: 'Evidence',
  noEvidence: 'No evidence recorded.',
  observed: 'observed {age}',
  rawEvidence: 'Raw evidence',
  rawEmpty: 'No raw material attached.',
  sourceMock: 'Source: demo data (mock), not a GitHub read-back',
  sourceGithub: 'Source: GitHub read-back',
  missingData: 'Missing data',
  readOnly: 'Read-only: decisions, acceptance and merges happen in GitHub or the original flow, not in this demo.',
  noLink: 'Demo data has no links',
  updated: 'Updated {age}',
  updatedLabel: 'Updated',
  sourceLabel: 'Data source',
  sourceDemo: 'Demo',
  sourceGithubOption: 'GitHub',
  githubBadge: 'GitHub · read-only',
  refresh: 'Refresh',
  refreshing: 'Reading GitHub…',
  githubTitle: 'GitHub read-back · read-only',
  githubBody: 'Read through the locally signed-in gh CLI. Only open Issues / PRs, their HEAD and CI are included; review verdicts and agent activity are not.',
  githubSubline: 'From GitHub, read {age}. Not live agent state.',
  githubNotLoaded: 'Not read yet',
  readAt: 'read {age}',
  reposLabel: 'Repositories',
  addRepo: 'Add',
  addRepoLabel: 'Add repository',
  addRepoPlaceholder: 'owner/repo or GitHub URL',
  repoInvalid: 'Use owner/repo or a github.com repository URL.',
  repoDuplicate: 'This repository is already listed.',
  repoLimit: 'At most {n} repositories.',
  removeRepo: 'Remove {repo}',
  noRepos: 'Add a repository to read from GitHub.',
  repoComplete: 'Complete',
  repoPartial: 'Partial',
  repoError: 'Failed',
  repoTasks: '{n} tasks',
  repoMore: 'Only the first page was read; more items may exist.',
  githubErrorTitle: 'Could not read GitHub',
  githubErrorBody: 'This is not an empty task list. Check that gh is installed and signed in (gh auth status), then refresh.',
  githubEmptyTitle: 'No open Issues or PRs',
  githubEmptyBody: 'The listed repositories were read from GitHub and have no open items on the first page.',
  entryGithub: 'GitHub',
  entryNotLoaded: 'not read',
  entryLoading: 'reading',
  entryFailed: 'read failed',
  entryPartial: 'partial',
  entryAriaGithub: 'Open the task HUD (GitHub read-back): {inProgress} in progress, {needsYou} need you, {attention} failed or unknown',
  entryAriaGithubIdle: 'Open the task HUD (GitHub, not read yet)',
  entryAriaGithubLoading: 'Open the task HUD (reading GitHub)',
  entryAriaGithubFailed: 'Open the task HUD (GitHub read failed; counts unknown)',
  entryAriaGithubPartial: 'Open the task HUD (GitHub read incomplete): {inProgress} in progress, {needsYou} need you, {attention} failed or unknown',
  githubRefreshingStale: 'Refreshing GitHub… showing the last read until it finishes.',
  repoRefreshing: 'last read, refreshing',
  githubPartialBody: 'Some repositories could not be read, so this list is incomplete. This is not an empty task list.',
} as const;

type HudTextKey = keyof typeof EN;

const ZH: Record<HudTextKey, string> = {
  entryLabel: '任务',
  entryDemo: '演示',
  entryAria: '打开任务 HUD（演示数据）：{inProgress} 个进行中，{needsYou} 件需要你，{attention} 个失败或未知',
  entryInProgress: '{n} 进行中',
  entryNeedsYou: '{n} 需要你',
  title: '任务 HUD',
  back: '返回聊天',
  tabsLabel: '任务 HUD 视图',
  tabOverview: '总览',
  tabList: '任务列表',
  mockTitle: '演示数据 · 尚未连接 GitHub',
  mockBody: '这里的任务、提交、CI 与审查全是虚构示例，没有从 GitHub 读取任何数据，也不会更改 GitHub。',
  scenarioLabel: '演示场景',
  scenarioSample: '示例任务',
  scenarioEmpty: '空列表',
  headline: '{inProgress} 个任务在推进，{needsYou} 件事等你',
  headlineNoNeeds: '{inProgress} 个任务在推进，没有事等你',
  headlineEmpty: '这个视图没有任务',
  subline: '数字来自本页的演示数据，不是 GitHub。',
  counterInProgress: '进行中',
  counterNeedsYou: '需要你',
  counterAttention: '失败 / 未知',
  counterHint: '在列表中显示这些任务',
  needsYouTitle: '需要你',
  needsYouHint: '按急迫程度：决定 > 阻塞 > 验收',
  inProgressTitle: '进行中',
  otherTitle: '已完成与未知',
  allTasks: '全部任务',
  runtimeTitle: 'Agent、额度与实时进度',
  runtimeBody: '未知。GitHub 数据无法证明 Claude Code 或 Prodex 是否在运行、第几轮、登录状态或额度，本 HUD 也不监控它们。',
  emptyTitle: '没有任务',
  emptyBody: '目前选的是“空列表”演示场景，不是 GitHub 的结果。',
  openDetail: '查看详情',
  repoLabel: '仓库',
  repoAll: '全部仓库',
  statusLabel: '状态筛选',
  statusAll: '全部',
  listCount: '{n} 个任务',
  noMatchTitle: '没有符合筛选的任务',
  noMatchBody: '换一个仓库或状态试试。',
  clearFilters: '清除筛选',
  backToOverview: '返回总览',
  backToList: '返回任务列表',
  taskMissing: '目前的数据中没有这个任务。',
  now: '现在',
  next: '下一步',
  owner: '下一位执行者',
  stages: '阶段',
  delivery: '交付',
  issue: 'Issue',
  pr: 'PR',
  noPr: '尚无 PR',
  draft: '草稿',
  readyForReview: '可审查',
  head: 'HEAD',
  headMissing: '未读到 HEAD',
  ci: 'CI',
  review: '审查',
  reviewNone: '尚无独立审查',
  reviewStale: '审查针对的是其他 HEAD，需要重新审查',
  onSha: '对应 {sha}',
  evidence: '证据',
  noEvidence: '没有记录证据。',
  observed: '{age}观测',
  rawEvidence: '原始证据',
  rawEmpty: '没有附原始数据。',
  sourceMock: '来源：演示数据（Mock），不是 GitHub 回读',
  sourceGithub: '来源：GitHub 回读',
  missingData: '数据缺失',
  readOnly: '只读：决定、验收与合并在 GitHub 或原流程中进行，不在此演示中操作。',
  noLink: '演示数据没有链接',
  updated: '{age}更新',
  updatedLabel: '更新',
  sourceLabel: '数据源',
  sourceDemo: '演示数据',
  sourceGithubOption: 'GitHub',
  githubBadge: 'GitHub · 只读',
  refresh: '刷新',
  refreshing: '正在读取 GitHub…',
  githubTitle: 'GitHub 只读回读',
  githubBody: '通过本机已登录的 gh 只读读取。只包含开放的 Issue / PR、它们的 HEAD 和 CI，不包含审查结论和 Agent 运行状态。',
  githubSubline: '来自 GitHub，{age}读取；不代表 Agent 实时状态。',
  githubNotLoaded: '尚未读取',
  readAt: '{age}读取',
  reposLabel: '仓库',
  addRepo: '添加',
  addRepoLabel: '添加仓库',
  addRepoPlaceholder: 'owner/repo 或 GitHub 链接',
  repoInvalid: '请输入 owner/repo 或 github.com 仓库链接。',
  repoDuplicate: '这个仓库已在列表中。',
  repoLimit: '最多 {n} 个仓库。',
  removeRepo: '移除 {repo}',
  noRepos: '添加一个仓库后才能读取 GitHub。',
  repoComplete: '完整',
  repoPartial: '不完整',
  repoError: '读取失败',
  repoTasks: '{n} 个任务',
  repoMore: '只读取了第一页，可能还有更多条目。',
  githubErrorTitle: '未能读取 GitHub',
  githubErrorBody: '这不代表没有任务。请确认 gh 已安装并登录（gh auth status），然后刷新。',
  githubEmptyTitle: '没有开放的 Issue 或 PR',
  githubEmptyBody: '已从 GitHub 读取所列仓库，第一页没有开放的条目。',
  entryGithub: 'GitHub',
  entryNotLoaded: '未读取',
  entryLoading: '读取中',
  entryFailed: '读取失败',
  entryPartial: '不完整',
  entryAriaGithub: '打开任务 HUD（GitHub 回读）：{inProgress} 个进行中，{needsYou} 件需要你，{attention} 个失败或未知',
  entryAriaGithubIdle: '打开任务 HUD（GitHub，尚未读取）',
  entryAriaGithubLoading: '打开任务 HUD（正在读取 GitHub）',
  entryAriaGithubFailed: '打开任务 HUD（GitHub 读取失败，数量未知）',
  entryAriaGithubPartial: '打开任务 HUD（GitHub 读取不完整）：{inProgress} 个进行中，{needsYou} 件需要你，{attention} 个失败或未知',
  githubRefreshingStale: '正在刷新 GitHub… 完成前显示上次读取的结果。',
  repoRefreshing: '上次读取，正在刷新',
  githubPartialBody: '部分仓库读取失败，列表不完整。这不代表没有任务。',
};

const STATUS_EN: Record<TaskStatus, string> = {
  running: 'In progress',
  rework: 'Reworking',
  review: 'Awaiting review',
  decide: 'Needs your decision',
  accept: 'Awaiting your acceptance',
  blocked: 'Blocked',
  done: 'Done',
  unknown: 'Unknown',
};

const STATUS_ZH: Record<TaskStatus, string> = {
  running: '进行中',
  rework: '返工中',
  review: '待审',
  decide: '待你决定',
  accept: '待验收',
  blocked: '阻塞',
  done: '已完成',
  unknown: '未知',
};

/** Short kind label on "needs you" cards. */
const NEED_KIND_EN: Partial<Record<TaskStatus, string>> = { decide: 'Decide', accept: 'Accept', blocked: 'Blocked' };
const NEED_KIND_ZH: Partial<Record<TaskStatus, string>> = { decide: '决定', accept: '验收', blocked: '阻塞' };

const EVIDENCE_EN: Record<EvidenceKind, string> = {
  readback: 'Read back',
  local: 'Run locally',
  self: 'Executor claim · not evidence',
  unverified: 'Not verified',
};

const EVIDENCE_ZH: Record<EvidenceKind, string> = {
  readback: '已回读',
  local: '本机运行',
  self: '执行者自述 · 不作为证据',
  unverified: '未验证',
};

const CI_EN: Record<CiView['state'], string> = { success: 'CI passed', failure: 'CI failed', running: 'CI running', unknown: 'CI unknown' };
const CI_ZH: Record<CiView['state'], string> = { success: 'CI 通过', failure: 'CI 失败', running: 'CI 运行中', unknown: 'CI 未知' };

type CiReason = Extract<CiView, { state: 'unknown' }>['reason'];
const CI_REASON_EN: Record<CiReason, string> = {
  'no-pr': 'no PR',
  'no-head': 'HEAD missing, so no check can be bound to it',
  'no-ci': 'no checks read for this HEAD',
  'head-mismatch': 'the checks belong to an older HEAD',
};
const CI_REASON_ZH: Record<CiReason, string> = {
  'no-pr': '尚无 PR',
  'no-head': '缺少 HEAD，无法对应任何检查',
  'no-ci': '没有读到这个 HEAD 的检查',
  'head-mismatch': '检查结果属于较旧的 HEAD',
};

const STAGE_EN: Record<HudStage['state'], string> = { done: 'done', active: 'in progress', todo: 'not started', skipped: 'skipped' };
const STAGE_ZH: Record<HudStage['state'], string> = { done: '完成', active: '进行中', todo: '未开始', skipped: '跳过' };

const VERDICT: Record<'pass' | 'revise' | 'blocked', string> = { pass: 'PASS', revise: 'REVISE', blocked: 'BLOCKED' };

export interface TaskHudText {
  t: (key: HudTextKey, values?: Record<string, string | number>) => string;
  status: (status: TaskStatus) => string;
  needKind: (status: TaskStatus) => string;
  /** Mock read-backs say so: they must not pass for a GitHub read in this run. */
  evidence: (kind: EvidenceKind, dataSource: 'mock' | 'github') => string;
  ci: (state: CiView['state']) => string;
  ciReason: (reason: CiReason) => string;
  stage: (state: HudStage['state']) => string;
  verdict: (verdict: 'pass' | 'revise' | 'blocked') => string;
}

function fill(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), template);
}

export function taskHudText(locale: Locale): TaskHudText {
  const zh = hudLocale(locale) === 'zh';
  return {
    t: (key, values) => fill((zh ? ZH : EN)[key], values),
    status: (status) => (zh ? STATUS_ZH : STATUS_EN)[status],
    needKind: (status) => (zh ? NEED_KIND_ZH : NEED_KIND_EN)[status] ?? (zh ? STATUS_ZH : STATUS_EN)[status],
    evidence: (kind, dataSource) => {
      // Mock records must not pass for a real read-back or a real local run in this session.
      if (kind === 'readback' && dataSource === 'mock') return zh ? '模拟已回读（示例）' : 'Simulated read-back (example)';
      if (kind === 'local' && dataSource === 'mock') return zh ? '本机运行（示例）' : 'Run locally (example)';
      return (zh ? EVIDENCE_ZH : EVIDENCE_EN)[kind];
    },
    ci: (state) => (zh ? CI_ZH : CI_EN)[state],
    ciReason: (reason) => (zh ? CI_REASON_ZH : CI_REASON_EN)[reason],
    stage: (state) => (zh ? STAGE_ZH : STAGE_EN)[state],
    verdict: (verdict) => VERDICT[verdict],
  };
}
