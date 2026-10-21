import type { Locale } from '../i18n/resolve';
import { hudLocale, type CiView, type EvidenceKind, type HudStage, type TaskStatus } from './taskHudModel';

/**
 * Task HUD copy (#40). Kept in its own table instead of the shared i18n dictionaries so this
 * slice adds no keys to files that PR #19 also edits. en + zh-TW; ja / de read English.
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
} as const;

type HudTextKey = keyof typeof EN;

const ZH: Record<HudTextKey, string> = {
  entryLabel: '任務',
  entryDemo: '示範',
  entryAria: '開啟任務 HUD（示範資料）：{inProgress} 個進行中，{needsYou} 件需要你，{attention} 個失敗或未知',
  entryInProgress: '{n} 進行中',
  entryNeedsYou: '{n} 需要你',
  title: '任務 HUD',
  back: '返回聊天',
  tabsLabel: '任務 HUD 檢視',
  tabOverview: '總覽',
  tabList: '任務列表',
  mockTitle: '示範資料 · 尚未連接 GitHub',
  mockBody: '這裡的任務、提交、CI 與審查全是虛構示例，沒有從 GitHub 讀取任何資料，也不會更改 GitHub。',
  scenarioLabel: '示範情境',
  scenarioSample: '示例任務',
  scenarioEmpty: '空清單',
  headline: '{inProgress} 個任務在推進，{needsYou} 件事等你',
  headlineNoNeeds: '{inProgress} 個任務在推進，沒有事等你',
  headlineEmpty: '這個檢視沒有任務',
  subline: '數字來自本頁的示範資料，不是 GitHub。',
  counterInProgress: '進行中',
  counterNeedsYou: '需要你',
  counterAttention: '失敗 / 未知',
  counterHint: '在列表中顯示這些任務',
  needsYouTitle: '需要你',
  needsYouHint: '按急迫程度：決定 > 阻塞 > 驗收',
  inProgressTitle: '進行中',
  otherTitle: '已完成與未知',
  allTasks: '全部任務',
  runtimeTitle: 'Agent、額度與即時進度',
  runtimeBody: '未知。GitHub 資料無法證明 Claude Code 或 Prodex 是否在執行、第幾輪、登入狀態或額度，本 HUD 也不監看它們。',
  emptyTitle: '沒有任務',
  emptyBody: '目前選的是「空清單」示範情境，不是 GitHub 的結果。',
  openDetail: '查看詳情',
  repoLabel: '倉庫',
  repoAll: '全部倉庫',
  statusLabel: '狀態篩選',
  statusAll: '全部',
  listCount: '{n} 個任務',
  noMatchTitle: '沒有符合篩選的任務',
  noMatchBody: '換一個倉庫或狀態試試。',
  clearFilters: '清除篩選',
  backToOverview: '返回總覽',
  backToList: '返回任務列表',
  taskMissing: '目前的資料中沒有這個任務。',
  now: '現在',
  next: '下一步',
  owner: '下一位執行者',
  stages: '階段',
  delivery: '交付',
  issue: 'Issue',
  pr: 'PR',
  noPr: '尚無 PR',
  draft: '草稿',
  readyForReview: '可審查',
  head: 'HEAD',
  headMissing: '未讀到 HEAD',
  ci: 'CI',
  review: '審查',
  reviewNone: '尚無獨立審查',
  reviewStale: '審查針對的是其他 HEAD，需要重新審查',
  onSha: '對應 {sha}',
  evidence: '證據',
  noEvidence: '沒有記錄證據。',
  observed: '{age}觀察',
  rawEvidence: '原始證據',
  rawEmpty: '沒有附原始資料。',
  sourceMock: '來源：示範資料（Mock），不是 GitHub 回讀',
  sourceGithub: '來源：GitHub 回讀',
  missingData: '資料缺失',
  readOnly: '唯讀：決定、驗收與合併在 GitHub 或原流程中進行，不在此示範中操作。',
  noLink: '示範資料沒有連結',
  updated: '{age}更新',
  updatedLabel: '更新',
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
  running: '進行中',
  rework: '返工中',
  review: '待審',
  decide: '待你決定',
  accept: '待驗收',
  blocked: '阻塞',
  done: '已完成',
  unknown: '未知',
};

/** Short kind label on "needs you" cards. */
const NEED_KIND_EN: Partial<Record<TaskStatus, string>> = { decide: 'Decide', accept: 'Accept', blocked: 'Blocked' };
const NEED_KIND_ZH: Partial<Record<TaskStatus, string>> = { decide: '決定', accept: '驗收', blocked: '阻塞' };

const EVIDENCE_EN: Record<EvidenceKind, string> = {
  readback: 'Read back',
  local: 'Run locally',
  self: 'Executor claim · not evidence',
  unverified: 'Not verified',
};

const EVIDENCE_ZH: Record<EvidenceKind, string> = {
  readback: '已回讀',
  local: '本機執行',
  self: '執行者自述 · 不作為證據',
  unverified: '未驗證',
};

const CI_EN: Record<CiView['state'], string> = { success: 'CI passed', failure: 'CI failed', running: 'CI running', unknown: 'CI unknown' };
const CI_ZH: Record<CiView['state'], string> = { success: 'CI 通過', failure: 'CI 失敗', running: 'CI 執行中', unknown: 'CI 未知' };

type CiReason = Extract<CiView, { state: 'unknown' }>['reason'];
const CI_REASON_EN: Record<CiReason, string> = {
  'no-pr': 'no PR',
  'no-head': 'HEAD missing, so no check can be bound to it',
  'no-ci': 'no checks read for this HEAD',
  'head-mismatch': 'the checks belong to an older HEAD',
};
const CI_REASON_ZH: Record<CiReason, string> = {
  'no-pr': '尚無 PR',
  'no-head': '缺少 HEAD，無法對應任何檢查',
  'no-ci': '沒有讀到這個 HEAD 的檢查',
  'head-mismatch': '檢查結果屬於較舊的 HEAD',
};

const STAGE_EN: Record<HudStage['state'], string> = { done: 'done', active: 'in progress', todo: 'not started', skipped: 'skipped' };
const STAGE_ZH: Record<HudStage['state'], string> = { done: '完成', active: '進行中', todo: '未開始', skipped: '跳過' };

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
  const zh = hudLocale(locale) === 'zh-TW';
  return {
    t: (key, values) => fill((zh ? ZH : EN)[key], values),
    status: (status) => (zh ? STATUS_ZH : STATUS_EN)[status],
    needKind: (status) => (zh ? NEED_KIND_ZH : NEED_KIND_EN)[status] ?? (zh ? STATUS_ZH : STATUS_EN)[status],
    evidence: (kind, dataSource) => {
      // Mock records must not pass for a real read-back or a real local run in this session.
      if (kind === 'readback' && dataSource === 'mock') return zh ? '模擬已回讀（示例）' : 'Simulated read-back (example)';
      if (kind === 'local' && dataSource === 'mock') return zh ? '本機執行（示例）' : 'Run locally (example)';
      return (zh ? EVIDENCE_ZH : EVIDENCE_EN)[kind];
    },
    ci: (state) => (zh ? CI_ZH : CI_EN)[state],
    ciReason: (reason) => (zh ? CI_REASON_ZH : CI_REASON_EN)[reason],
    stage: (state) => (zh ? STAGE_ZH : STAGE_EN)[state],
    verdict: (verdict) => VERDICT[verdict],
  };
}
