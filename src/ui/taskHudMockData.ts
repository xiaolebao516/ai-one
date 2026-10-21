import type { HudStage, HudTask, LText } from './taskHudModel';

/*
 * DEMO DATA for the first Task HUD slice (#40). Everything here is fictional: the `demo/*`
 * repositories, issue and PR numbers, SHAs, CI results and reviews do not exist. No record has a
 * URL, so nothing can point at a real GitHub object. Every task is tagged `dataSource: 'mock'`,
 * which the UI turns into "demo" wording (e.g. "simulated read-back").
 */

const text = (en: string, zh: string): LText => ({ en, 'zh-TW': zh });

const STAGE = {
  grill: text('Requirements', '想需求'),
  plan: text('Plan', '定方案'),
  split: text('Split', '拆任務'),
  build: text('Build & audit', '執行與審計'),
  ship: text('Ship', '總結交付'),
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
    title: text('Overview: see what needs me at a glance', '總覽頁：一眼看到需要我處理的事'),
    status: 'rework',
    statusNote: text('round 2/3', '第 2/3 輪'),
    stages: stages(['grill', 'done'], ['plan', 'done'], ['build', 'active'], ['ship', 'todo']),
    summary: text(
      'The execution session is reworking per the independent audit: the "needs you" count shows 1 on an empty list.',
      '執行會話正按獨立審計意見返工：空清單時「需要你」計數顯示為 1。',
    ),
    nextStep: text('After the push: run pnpm verify locally, then re-audit the new HEAD.', '推送後先本機跑 pnpm verify，再針對新 HEAD 重新審計。'),
    owner: text('Executor (GPT session A)', '執行者（GPT 會話 A）'),
    updatedMinutesAgo: 0,
    pr: { number: 43, draft: true, headSha: SHA.orbitNew },
    ci: { state: 'running', headSha: SHA.orbitNew },
    review: { verdict: 'revise', headSha: SHA.orbitOld, by: text('GPT audit session B', 'GPT 審計會話 B') },
    evidence: [
      { id: 'push', kind: 'readback', text: text('New commit a1c93e1 is on the PR branch', '新提交 a1c93e1 已在 PR 分支上'), observedMinutesAgo: 1, raw: 'GET /repos/demo/orbit-app/pulls/43 -> head.sha a1c93e1f0e2d… (example)' },
      { id: 'claim', kind: 'self', text: text('Executor: "all tests pass"', '執行者：「測試都通過了」'), observedMinutesAgo: 1 },
      { id: 'verify-old', kind: 'local', text: text('pnpm verify 812/812 on the previous HEAD a1c93e0', 'pnpm verify 812/812（上一個 HEAD a1c93e0）'), observedMinutesAgo: 34 },
      { id: 'webview', kind: 'unverified', text: text('Desktop WebView check not run on the new HEAD', '新 HEAD 尚未在桌面 WebView 驗證') },
    ],
  },
  {
    id: 'orbit-45',
    dataSource: 'mock',
    repo: 'demo/orbit-app',
    issue: 45,
    title: text('Hand off over-long sessions automatically', '會話過長時自動交接到新會話'),
    status: 'decide',
    stages: stages(['grill', 'done'], ['plan', 'active'], ['build', 'todo'], ['ship', 'todo']),
    summary: text(
      'Two plans disagree: detect the web page\'s length warning, or hand off at a character threshold.',
      '兩個方案有分歧：偵測網頁的長度提示，還是按字數閾值交接。',
    ),
    nextStep: text('Choose a plan. The task stays paused until you decide; nobody chooses for you.', '請選擇方案。在你決定前任務保持暫停，不會替你選。'),
    owner: text('You', '你'),
    updatedMinutesAgo: 6,
    evidence: [
      { id: 'positions', kind: 'self', text: text('Both models state their position; neither is verified', '兩個模型各自陳述立場，均未經驗證'), observedMinutesAgo: 6, raw: 'A: page hint is authoritative but brittle\nB: threshold is predictable but early (example)' },
    ],
  },
  {
    id: 'orbit-39',
    dataSource: 'mock',
    repo: 'demo/orbit-app',
    issue: 39,
    title: text('Always produce a final report after a discussion', '討論結束後必定生成最終報告'),
    status: 'accept',
    stages: stages(['grill', 'done'], ['plan', 'done'], ['split', 'skipped'], ['build', 'done'], ['ship', 'active']),
    summary: text('All stages are done; PR #40 waits for your acceptance.', '各階段已完成，PR #40 等你驗收。'),
    nextStep: text('Review the acceptance notes; merging is only ever your decision, in GitHub.', '查看驗收說明；是否合併永遠由你在 GitHub 決定。'),
    owner: text('You', '你'),
    updatedMinutesAgo: 12,
    pr: { number: 40, draft: false, headSha: SHA.report },
    ci: { state: 'success', headSha: SHA.report, detail: text('24/24 checks', '24/24 項檢查') },
    review: { verdict: 'pass', headSha: SHA.report, by: text('GPT independent audit', 'GPT 獨立審計') },
    evidence: [
      { id: 'ci', kind: 'readback', text: text('CI 24/24 passed for 7be41d2', 'CI 24/24 通過（7be41d2）'), observedMinutesAgo: 12, raw: 'check-runs for 7be41d2c9a0f…: 24 completed, 24 success (example)' },
      { id: 'verify', kind: 'local', text: text('pnpm verify passed on 7be41d2', 'pnpm verify 在 7be41d2 上通過'), observedMinutesAgo: 15 },
      { id: 'desktop', kind: 'unverified', text: text('Real desktop WebView run not done yet', '尚未在真實桌面 WebView 執行') },
    ],
  },
  {
    id: 'notes-12',
    dataSource: 'mock',
    repo: 'demo/notes-sync',
    issue: 12,
    title: text('Merge strategy for offline edit conflicts', '離線編輯衝突的合併策略'),
    status: 'blocked',
    stages: stages(['grill', 'done'], ['plan', 'active'], ['build', 'todo'], ['ship', 'todo']),
    summary: text('The planning discussion waits for Argon, whose web login has expired.', '定方案的討論在等 Argon，它的網頁登入已失效。'),
    nextStep: text('Sign Argon in again, or let the coordinator continue without it.', '重新登入 Argon，或讓協調者在沒有它的情況下繼續。'),
    owner: text('You', '你'),
    updatedMinutesAgo: 18,
    evidence: [{ id: 'login', kind: 'local', text: text('Login page detected in the Argon web view', 'Argon 網頁中偵測到登入頁'), observedMinutesAgo: 18 }],
  },
  {
    id: 'notes-15',
    dataSource: 'mock',
    repo: 'demo/notes-sync',
    issue: 15,
    title: text('Export the sync log as CSV', '同步日誌匯出為 CSV'),
    status: 'review',
    stages: stages(['build', 'active'], ['ship', 'todo']),
    summary: text('Waiting for an independent review; CI on the current HEAD failed (lint).', '等待獨立審查；目前 HEAD 的 CI 失敗（lint）。'),
    nextStep: text('Executor fixes lint on the same branch; review starts on the new HEAD.', '執行者在同一分支修正 lint；審查針對新 HEAD 進行。'),
    owner: text('Executor', '執行者'),
    updatedMinutesAgo: 25,
    pr: { number: 16, draft: false, headSha: SHA.csv },
    ci: { state: 'failure', headSha: SHA.csv, detail: text('1 of 4 checks failed', '4 項檢查中 1 項失敗') },
    review: { verdict: 'none' },
    evidence: [
      { id: 'ci', kind: 'readback', text: text('frontend check failed on c5f0a2e', 'frontend 檢查在 c5f0a2e 上失敗'), observedMinutesAgo: 25, raw: 'eslint: 1 error (no-unused-vars) in src/export.ts (example)' },
      { id: 'claim', kind: 'self', text: text('Executor: "ready for review"', '執行者：「可以審查了」'), observedMinutesAgo: 27 },
    ],
  },
  {
    id: 'home-7',
    dataSource: 'mock',
    repo: 'demo/home-lab',
    issue: 7,
    title: text('Make the backup script testable', '備份腳本重構為可測試模組'),
    status: 'running',
    statusNote: text('2 subtasks in parallel', '2 個子任務並行'),
    stages: stages(['plan', 'done'], ['split', 'done'], ['build', 'active'], ['ship', 'todo']),
    summary: text('Two executors work on separate subtasks; a new commit landed after the last CI run.', '兩個執行者各做一個子任務；上次 CI 之後又有新提交。'),
    nextStep: text('Wait for CI on the new HEAD before trusting any result.', '等新 HEAD 的 CI 出結果，再採信任何結論。'),
    owner: text('Executors', '執行者'),
    updatedMinutesAgo: 3,
    pr: { number: 9, draft: true, headSha: SHA.backupNew },
    ci: { state: 'success', headSha: SHA.backupOld },
    review: { verdict: 'none' },
    evidence: [
      { id: 'ci-old', kind: 'readback', text: text('CI passed, but for the older d00d1e2', 'CI 通過，但對應的是較舊的 d00d1e2'), observedMinutesAgo: 9 },
    ],
  },
  {
    id: 'home-8',
    dataSource: 'mock',
    repo: 'demo/home-lab',
    issue: 8,
    title: text('Split the config loader', '拆分設定載入器'),
    status: 'running',
    stages: stages(['build', 'active'], ['ship', 'todo']),
    summary: text('A draft PR exists, but its HEAD was not read in this snapshot.', '已有草稿 PR，但這次快照沒有讀到它的 HEAD。'),
    updatedMinutesAgo: 40,
    pr: { number: 10, draft: true },
    evidence: [],
    gap: text('PR HEAD missing: CI and review cannot be tied to a commit.', '缺少 PR HEAD：CI 與審查無法對應到提交。'),
  },
  {
    id: 'home-3',
    dataSource: 'mock',
    repo: 'demo/home-lab',
    issue: 3,
    title: text('Remove the obsolete cron wrapper', '移除過時的 cron 包裝腳本'),
    status: 'done',
    stages: stages(['build', 'done'], ['ship', 'done']),
    summary: text('Delivered and closed (example record).', '已交付並關閉（示例紀錄）。'),
    updatedMinutesAgo: 60 * 26,
    pr: { number: 4, draft: false, headSha: SHA.cron },
    ci: { state: 'success', headSha: SHA.cron },
    review: { verdict: 'pass', headSha: SHA.cron, by: text('GPT independent audit', 'GPT 獨立審計') },
    evidence: [{ id: 'closed', kind: 'readback', text: text('Issue closed as completed', 'Issue 以 Completed 關閉'), observedMinutesAgo: 60 * 26 }],
  },
  {
    id: 'notes-20',
    dataSource: 'mock',
    repo: 'demo/notes-sync',
    issue: 20,
    title: text('Untriaged: conflict-free sync idea', '未分類：無衝突同步的想法'),
    status: 'unknown',
    stages: [],
    summary: text('No status could be read for this task.', '讀不到這個任務的狀態。'),
    evidence: [],
    gap: text('Status, stage and PR are missing from the snapshot; nothing is assumed.', '快照中缺少狀態、階段與 PR；不做任何推測。'),
  },
];
