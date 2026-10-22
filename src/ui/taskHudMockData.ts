import type { HudStage, HudTask, LText } from './taskHudModel';

/*
 * DEMO DATA for the first Task HUD slice (#40). Everything here is fictional: the `demo/*`
 * repositories, issue and PR numbers, SHAs, CI results and reviews do not exist. No record has a
 * URL, so nothing can point at a real GitHub object. Every task is tagged `dataSource: 'mock'`,
 * which the UI turns into "demo" wording (e.g. "simulated read-back").
 */

const text = (en: string, zh: string): LText => ({ en, zh });

const STAGE = {
  grill: text('Requirements', '想需求'),
  plan: text('Plan', '定方案'),
  split: text('Split', '拆任务'),
  build: text('Build & audit', '执行与审计'),
  ship: text('Ship', '总结交付'),
};

function stages(...entries: Array<[keyof typeof STAGE, HudStage['state']]>): HudStage[] {
  return entries.map(([id, state]) => ({ name: STAGE[id], state }));
}

/** Obviously synthetic 40-hex SHAs. */
const SHA = {
  orbitOld: 'a1c93e0b5d7f2a4c6e8b0d2f4a6c8e0b2d4f6a81',
  orbitNew: 'a1c93e1f0e2d4c6b8a0f2e4d6c8b0a2f4e6d8c92',
  report: '7be41d2c9a0f3e5b8d1c4a6f2e9b0d3c5a7f1e2d',
  csv: 'c5f0a2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6',
  backupOld: 'd00d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d',
  backupNew: 'd00d2f3e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a',
  cron: 'e0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9',
} as const;

export const TASK_HUD_MOCK_TASKS: readonly HudTask[] = [
  {
    id: 'orbit-42',
    dataSource: 'mock',
    repo: 'demo/orbit-app',
    issue: 42,
    title: text('Overview: see what needs me at a glance', '总览页：一眼看到需要我处理的事'),
    status: 'rework',
    statusNote: text('round 2/3', '第 2/3 轮'),
    stages: stages(['grill', 'done'], ['plan', 'done'], ['build', 'active'], ['ship', 'todo']),
    summary: text(
      'The execution session is reworking per the independent audit: the "needs you" count shows 1 on an empty list.',
      '执行会话正按独立审计意见返工：空列表时“需要你”计数显示为 1。',
    ),
    nextStep: text('After the push: run pnpm verify locally, then re-audit the new HEAD.', '推送后先本机跑 pnpm verify，再针对新 HEAD 重新审计。'),
    owner: text('Executor (GPT session A)', '执行者（GPT 会话 A）'),
    updatedMinutesAgo: 0,
    pr: { number: 43, draft: true, headSha: SHA.orbitNew },
    ci: { state: 'running', headSha: SHA.orbitNew },
    review: { verdict: 'revise', headSha: SHA.orbitOld, by: text('GPT audit session B', 'GPT 审计会话 B') },
    evidence: [
      { id: 'push', kind: 'readback', text: text('New commit a1c93e1 is on the PR branch', '新提交 a1c93e1 已在 PR 分支上'), observedMinutesAgo: 1, raw: 'GET /repos/demo/orbit-app/pulls/43 -> head.sha a1c93e1f0e2d… (example)' },
      { id: 'claim', kind: 'self', text: text('Executor: "all tests pass"', '执行者：“测试都通过了”'), observedMinutesAgo: 1 },
      { id: 'verify-old', kind: 'local', text: text('pnpm verify 812/812 on the previous HEAD a1c93e0', 'pnpm verify 812/812（上一个 HEAD a1c93e0）'), observedMinutesAgo: 34 },
      { id: 'webview', kind: 'unverified', text: text('Desktop WebView check not run on the new HEAD', '新 HEAD 尚未在桌面 WebView 验证') },
    ],
  },
  {
    id: 'orbit-45',
    dataSource: 'mock',
    repo: 'demo/orbit-app',
    issue: 45,
    title: text('Hand off over-long sessions automatically', '会话过长时自动交接到新会话'),
    status: 'decide',
    stages: stages(['grill', 'done'], ['plan', 'active'], ['build', 'todo'], ['ship', 'todo']),
    summary: text(
      'Two plans disagree: detect the web page\'s length warning, or hand off at a character threshold.',
      '两个方案有分歧：检测网页的长度提示，还是按字数阈值交接。',
    ),
    nextStep: text('Choose a plan. The task stays paused until you decide; nobody chooses for you.', '请选择方案。在你决定前任务保持暂停，不会替你选。'),
    owner: text('You', '你'),
    updatedMinutesAgo: 6,
    evidence: [
      { id: 'positions', kind: 'self', text: text('Both models state their position; neither is verified', '两个模型各自陈述立场，均未经验证'), observedMinutesAgo: 6, raw: 'A: page hint is authoritative but brittle\nB: threshold is predictable but early (example)' },
    ],
  },
  {
    id: 'orbit-39',
    dataSource: 'mock',
    repo: 'demo/orbit-app',
    issue: 39,
    title: text('Always produce a final report after a discussion', '讨论结束后必定生成最终报告'),
    status: 'accept',
    stages: stages(['grill', 'done'], ['plan', 'done'], ['split', 'skipped'], ['build', 'done'], ['ship', 'active']),
    summary: text('All stages are done; PR #40 waits for your acceptance.', '各阶段已完成，PR #40 等你验收。'),
    nextStep: text('Review the acceptance notes; merging is only ever your decision, in GitHub.', '查看验收说明；是否合并永远由你在 GitHub 决定。'),
    owner: text('You', '你'),
    updatedMinutesAgo: 12,
    pr: { number: 40, draft: false, headSha: SHA.report },
    ci: { state: 'success', headSha: SHA.report, detail: text('24/24 checks', '24/24 项检查') },
    review: { verdict: 'pass', headSha: SHA.report, by: text('GPT independent audit', 'GPT 独立审计') },
    evidence: [
      { id: 'ci', kind: 'readback', text: text('CI 24/24 passed for 7be41d2', 'CI 24/24 通过（7be41d2）'), observedMinutesAgo: 12, raw: 'check-runs for 7be41d2c9a0f…: 24 completed, 24 success (example)' },
      { id: 'verify', kind: 'local', text: text('pnpm verify passed on 7be41d2', 'pnpm verify 在 7be41d2 上通过'), observedMinutesAgo: 15 },
      { id: 'desktop', kind: 'unverified', text: text('Real desktop WebView run not done yet', '尚未在真实桌面 WebView 运行') },
    ],
  },
  {
    id: 'notes-12',
    dataSource: 'mock',
    repo: 'demo/notes-sync',
    issue: 12,
    title: text('Merge strategy for offline edit conflicts', '离线编辑冲突的合并策略'),
    status: 'blocked',
    stages: stages(['grill', 'done'], ['plan', 'active'], ['build', 'todo'], ['ship', 'todo']),
    summary: text('The planning discussion waits for Argon, whose web login has expired.', '定方案的讨论在等 Argon，它的网页登录已失效。'),
    nextStep: text('Sign Argon in again, or let the coordinator continue without it.', '重新登录 Argon，或让协调者在没有它的情况下继续。'),
    owner: text('You', '你'),
    updatedMinutesAgo: 18,
    evidence: [{ id: 'login', kind: 'local', text: text('Login page detected in the Argon web view', 'Argon 网页中检测到登录页'), observedMinutesAgo: 18 }],
  },
  {
    id: 'notes-15',
    dataSource: 'mock',
    repo: 'demo/notes-sync',
    issue: 15,
    title: text('Export the sync log as CSV', '同步日志导出为 CSV'),
    status: 'review',
    stages: stages(['build', 'active'], ['ship', 'todo']),
    summary: text('Waiting for an independent review; CI on the current HEAD failed (lint).', '等待独立审查；目前 HEAD 的 CI 失败（lint）。'),
    nextStep: text('Executor fixes lint on the same branch; review starts on the new HEAD.', '执行者在同一分支修正 lint；审查针对新 HEAD 进行。'),
    owner: text('Executor', '执行者'),
    updatedMinutesAgo: 25,
    pr: { number: 16, draft: false, headSha: SHA.csv },
    ci: { state: 'failure', headSha: SHA.csv, detail: text('1 of 4 checks failed', '4 项检查中 1 项失败') },
    review: { verdict: 'none' },
    evidence: [
      { id: 'ci', kind: 'readback', text: text('frontend check failed on c5f0a2e', 'frontend 检查在 c5f0a2e 上失败'), observedMinutesAgo: 25, raw: 'eslint: 1 error (no-unused-vars) in src/export.ts (example)' },
      { id: 'claim', kind: 'self', text: text('Executor: "ready for review"', '执行者：“可以审查了”'), observedMinutesAgo: 27 },
    ],
  },
  {
    id: 'home-7',
    dataSource: 'mock',
    repo: 'demo/home-lab',
    issue: 7,
    title: text('Make the backup script testable', '备份脚本重构为可测试模块'),
    status: 'running',
    statusNote: text('2 subtasks in parallel', '2 个子任务并行'),
    stages: stages(['plan', 'done'], ['split', 'done'], ['build', 'active'], ['ship', 'todo']),
    summary: text('Two executors work on separate subtasks; a new commit landed after the last CI run.', '两个执行者各做一个子任务；上次 CI 之后又有新提交。'),
    nextStep: text('Wait for CI on the new HEAD before trusting any result.', '等新 HEAD 的 CI 出结果，再采信任何结论。'),
    owner: text('Executors', '执行者'),
    updatedMinutesAgo: 3,
    pr: { number: 9, draft: true, headSha: SHA.backupNew },
    ci: { state: 'success', headSha: SHA.backupOld },
    review: { verdict: 'none' },
    evidence: [
      { id: 'ci-old', kind: 'readback', text: text('CI passed, but for the older d00d1e2', 'CI 通过，但对应的是较旧的 d00d1e2'), observedMinutesAgo: 9 },
    ],
  },
  {
    id: 'home-8',
    dataSource: 'mock',
    repo: 'demo/home-lab',
    issue: 8,
    title: text('Split the config loader', '拆分配置加载器'),
    status: 'running',
    stages: stages(['build', 'active'], ['ship', 'todo']),
    summary: text('A draft PR exists, but its HEAD was not read in this snapshot.', '已有草稿 PR，但这次快照没有读到它的 HEAD。'),
    updatedMinutesAgo: 40,
    pr: { number: 10, draft: true },
    evidence: [],
    gap: text('PR HEAD missing: CI and review cannot be tied to a commit.', '缺少 PR HEAD：CI 与审查无法对应到提交。'),
  },
  {
    id: 'home-3',
    dataSource: 'mock',
    repo: 'demo/home-lab',
    issue: 3,
    title: text('Remove the obsolete cron wrapper', '移除过时的 cron 包装脚本'),
    status: 'done',
    stages: stages(['build', 'done'], ['ship', 'done']),
    summary: text('Delivered and closed (example record).', '已交付并关闭（示例记录）。'),
    updatedMinutesAgo: 60 * 26,
    pr: { number: 4, draft: false, headSha: SHA.cron },
    ci: { state: 'success', headSha: SHA.cron },
    review: { verdict: 'pass', headSha: SHA.cron, by: text('GPT independent audit', 'GPT 独立审计') },
    evidence: [{ id: 'closed', kind: 'readback', text: text('Issue closed as completed', 'Issue 以 Completed 关闭'), observedMinutesAgo: 60 * 26 }],
  },
  {
    id: 'notes-20',
    dataSource: 'mock',
    repo: 'demo/notes-sync',
    issue: 20,
    title: text('Untriaged: conflict-free sync idea', '未分类：无冲突同步的想法'),
    status: 'unknown',
    stages: [],
    summary: text('No status could be read for this task.', '读不到这个任务的状态。'),
    evidence: [],
    gap: text('Status, stage and PR are missing from the snapshot; nothing is assumed.', '快照中缺少状态、阶段与 PR；不做任何推测。'),
  },
];
