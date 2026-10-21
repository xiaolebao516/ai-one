/* ai-one v2 原型：全部为模拟数据（MOCK）。Issue 号、提交、额度、对话内容均为虚构，仅用于演示界面。 */
'use strict';

/* 实现标注：done = 已实现（main 上游功能）· part = 部分实现（能力在、形态要改）· wip = 开发中（#18 / PR #19）· plan = 规划 */
const IMPL_LABEL = { done: '已实现', part: '部分实现', wip: '开发中', plan: '规划' };

/* ---------- 资源（参与者） ---------- */
/* quota.type: known 已知（工具提供的精确用量）· hint 网页提示（只转述网页上出现的文字）· estimate 估算 · unknown 未知 */
const RES_SEED = {
  gpt: {
    name: 'GPT', full: 'ChatGPT', kind: 'web', color: '#10A37F', letter: 'G', plan: 'Plus',
    models: ['Thinking', 'Instant'], login: 'ok', state: 'wait', now: '#42 等待 Codex 返工后复审',
    queue: 'home-lab #7 审计（排队）',
    quota: { type: 'hint', level: 'ok', text: '未见限额提示', src: '网页 · 2 分钟前' },
    cost: '订阅内', tags: ['GitHub 读写', '调度', '审计', '简单实现'],
  },
  argon: {
    name: 'Argon', full: 'Gemini Argon', kind: 'web', color: '#5B7CF7', letter: 'A', plan: 'AI Pro',
    models: ['Argon', 'Flash'], login: 'expired', state: 'block', now: '登录已失效 · notes-sync #12 在等它',
    quota: { type: 'unknown', level: 'none', text: '登录失效，无法读取', src: '—' },
    cost: '订阅内', tags: ['独立分析', '深度审计', '补充边界'],
  },
  opus: {
    name: 'Opus', full: 'Claude Opus', kind: 'web', color: '#D97757', letter: 'O', plan: 'Max',
    models: ['Opus', 'Sonnet'], login: 'ok', state: 'idle', now: '待命 · home-lab #7 终审已预约',
    quota: { type: 'hint', level: 'warn', text: '接近 5 小时上限', reset: '16:00 重置', src: '网页提示 · 10 分钟前' },
    cost: '订阅内 · 稀缺', tags: ['架构', '方案把关', '前端', '终审'],
  },
  codex: {
    name: 'Codex', full: 'Codex CLI', kind: 'agent', color: '#2B2B2B', letter: 'Cx', plan: '6.1 Sol',
    models: ['6.1 Sol'], login: 'ok', state: 'run', now: '#42 返工中', since: 192,
    quota: { type: 'known', level: 'ok', pct: 38, text: '5 小时窗口已用 38%', src: 'CLI 用量 · 实时' },
    cost: '订阅内', tags: ['本地实现', '跑测试'],
  },
  cc: {
    name: 'Claude Code', full: 'Claude Code', kind: 'agent', color: '#B4532F', letter: 'CC', plan: '本机 · Opus',
    models: ['Opus', 'Sonnet'], login: 'ok', state: 'run', now: 'home-lab #7 子任务 ②', since: 723,
    quota: { type: 'estimate', level: 'ok', pct: 55, text: '约 55%（按今日会话估算）', src: '估算 · 非官方数字' },
    cost: '订阅内', tags: ['复杂代码', '前端', '本地测试'],
  },
  grok: {
    name: 'Grok', full: 'Grok', kind: 'web', color: '#6B6B6B', letter: 'X', plan: '免费',
    models: ['Grok'], login: 'none', state: 'off', now: '未登录 · 不参与调度',
    quota: { type: 'unknown', level: 'none', text: '未登录', src: '—' },
    cost: '免费额度', tags: ['第二意见'],
  },
};

/* ---------- 阶段与流程库 ---------- */
const STAGE_LIB = [
  { id: 'grill', name: '想需求', cmd: '/grill', pattern: '讨论', team: [['gpt', '讨论'], ['argon', '讨论']], out: '需求要点 · 分歧 · 待补证据', desc: '多个 AI 先独立思考，再交换意见，最后汇总成可执行的需求。' },
  { id: 'plan', name: '定方案', cmd: '/plan', pattern: '讨论', team: [['gpt', '讨论'], ['argon', '讨论'], ['opus', '把关']], out: '推荐方案 · 取舍 · 风险', desc: '对比方案，审计后给出推荐方案；不通过就回到讨论。' },
  { id: 'split', name: '拆任务', cmd: '/split', pattern: '单人', team: [['opus', '拆分']], out: '子任务 · 依赖 · 指派建议', desc: '把方案拆成可独立验收的子任务，并建议执行者。' },
  { id: 'build', name: '执行与审计', cmd: '/build', pattern: '主写 + 审计', team: [['codex', '执行'], ['gpt', '审计']], out: '提交 · PR · 审计结论', desc: '执行者实现，审计者独立审查真实 Diff；不通过自动返工。' },
  { id: 'ship', name: '总结交付', cmd: '/ship', pattern: '单人', team: [['gpt', '汇总']], out: '验收单 · 风险 · 待你决定', desc: '汇总改动、验证、审查与风险，请你验收。合并永远由你决定。' },
];

const FLOW_LIB = [
  {
    id: 'lead', name: '交给 GPT 调度', kind: 'conductor', uses: 23,
    desc: 'GPT 读完需求后自己决定下一步：调用哪个阶段、委派给谁、何时审计和返工。',
    brief: '先和 Argon 讨论需求，然后决定实现方案。简单的事情自己完成，复杂的交给 Opus 或本地 Agent。开发结束后审计，有问题自动返工。',
  },
  {
    id: 'quick', name: '快速开发', kind: 'flow', uses: 14, desc: '需求 → 实现 → 审计 → 交付，适合小改动。',
    stages: [
      { s: 'grill', pattern: '讨论', team: [['gpt', '讨论', '标准'], ['argon', '讨论', '标准']], exit: '双方无新问题，或 2 轮', skip: true },
      { s: 'build', pattern: '主写 + 审计', team: [['gpt', '执行', '标准'], ['argon', '审计', '深度']], exit: '审计通过 · 最多返工 3 次', fail: '通知我' },
      { s: 'ship', pattern: '单人', team: [['gpt', '汇总', '快速']], exit: '你验收' },
    ],
  },
  {
    id: 'full', name: '完整开发', kind: 'flow', uses: 6, desc: '五个阶段全走一遍，适合中等以上的需求。',
    stages: [
      { s: 'grill', pattern: '讨论', team: [['gpt', '讨论', '标准'], ['argon', '讨论', '深度']], exit: '审计认为无需继续，或 3 轮' },
      { s: 'plan', pattern: '讨论', team: [['gpt', '讨论', '标准'], ['argon', '讨论', '深度'], ['opus', '把关', '深度']], exit: '方案审计 PASS' },
      { s: 'split', pattern: '单人', team: [['gpt', '拆分', '标准']], exit: '子任务均有验收标准', skip: true },
      { s: 'build', pattern: '主写 + 审计', team: [['codex', '执行', '标准'], ['gpt', '审计', '深度']], exit: '审计通过 · 最多返工 3 次', fail: '请 Opus 裁决' },
      { s: 'ship', pattern: '单人', team: [['gpt', '汇总', '快速'], ['opus', '终审', '深度']], exit: '你验收' },
    ],
  },
  {
    id: 'parallel', name: 'Opus 设计 · 并行开发', kind: 'flow', uses: 3, desc: 'Opus 设计方案，GPT 拆分，多个执行者并行，GPT 审计，Opus 终审。',
    stages: [
      { s: 'plan', pattern: '单人', team: [['opus', '设计', '深度']], exit: '你确认方案', confirm: true },
      { s: 'split', pattern: '单人', team: [['gpt', '拆分', '标准']], exit: '子任务互不冲突' },
      { s: 'build', pattern: '并行执行', team: [['codex', '执行', '标准'], ['cc', '执行', '深度'], ['gpt', '执行（简单项）', '快速'], ['gpt', '审计', '深度']], exit: '每个子任务审计通过 · 作者不审自己（自动交叉）', fail: '通知我' },
      { s: 'ship', pattern: '单人', team: [['opus', '终审', '深度'], ['gpt', '汇总', '快速']], exit: '你验收' },
    ],
  },
  {
    id: 'grillonly', name: '只想需求', kind: 'flow', uses: 31, desc: '临时讨论一个想法，不碰仓库。',
    stages: [{ s: 'grill', pattern: '讨论', team: [['gpt', '讨论', '标准'], ['argon', '讨论', '深度'], ['opus', '审计（可选）', '标准']], exit: '审计认为无需继续，或 3 轮' }],
  },
];

/* ---------- 任务（含讨论）---------- */
/* state: run 进行中 · rework 返工中 · decide 需要你决定 · accept 待验收 · block 阻塞 · paused 已暂停 · done 已完成 */
const TASK_SEED = [
  {
    id: 't42', repo: 'ai-one', issue: 42, title: '总览页：一眼看到需要我处理的事', state: 'rework', lead: 'gpt', flow: 'lead',
    stateText: '返工中 · 第 2/3 轮', updated: '刚刚',
    now: 'Codex 正在按审计意见返工：修复“需要你”计数在空列表时显示为 1 的问题。',
    nowMeta: '已用 3 分 12 秒 · 返工完成后 GPT 自动复审', team: ['gpt', 'argon', 'codex'],
    pr: { n: 43, st: 'draft' }, ci: 'run', review: { st: 'fail', text: 'GPT 审计未通过 · 2 个问题' },
    stages: [
      { id: 'grill', st: 'done', team: ['gpt', 'argon'], sum: '确认 3 条需求；“多窗口 HUD”留到下一版', dur: '9 分钟' },
      { id: 'plan', st: 'done', team: ['gpt'], sum: '改动小，GPT 自定方案：复用任务行组件，新增“需要你”分组', dur: '3 分钟' },
      { id: 'split', st: 'skip', team: [], sum: '调度判断无需拆分' },
      { id: 'build', st: 'active', team: ['codex', 'gpt'], sum: 'Codex 实现 → GPT 审计未通过 → 返工第 2 轮', round: '2/3' },
      { id: 'ship', st: 'todo', team: ['gpt'], sum: '预计：GPT 汇总并请你验收' },
    ],
    events: [
      { stage: 'grill', k: 'decide', who: ['gpt'], t: '10:02', text: '需求描述偏模糊，先和 Argon 一起想清楚范围。' },
      { stage: 'grill', k: 'step', who: ['gpt', 'argon'], t: '10:03', text: 'GPT 与 Argon 各自读取 Issue #42 和现有首页代码，独立给出需求要点。' },
      { stage: 'grill', k: 'step', who: ['gpt', 'argon'], t: '10:08', text: '交换意见 1 轮：Argon 补充“空状态”和“按仓库筛选”，GPT 同意。' },
      { stage: 'grill', k: 'result', who: ['gpt', 'argon'], t: '10:11', text: '得出 3 条需求，1 条分歧留到下一版。', detail: 'grill' },
      { stage: 'plan', k: 'decide', who: ['gpt'], t: '10:12', text: '改动集中在两个前端组件，属于小改动：自己定方案，不请 Opus。', override: true },
      { stage: 'plan', k: 'result', who: ['gpt'], t: '10:14', text: '方案：复用任务行组件；“需要你”按紧急程度排序；不新增后端接口。', detail: 'plan' },
      { stage: 'build', k: 'decide', who: ['gpt'], t: '10:15', text: '需要本地运行 pnpm verify 和组件测试，委派 Codex 实现，自己负责审计。', override: true, brief: true },
      { stage: 'build', k: 'step', who: ['codex'], t: '10:31', text: 'Codex 在独立 worktree 完成实现并推送。', chips: [['ok', '提交 a1c93e0 · 已回读'], ['claim', '本地测试 112/112 · Codex 自述']], detail: 'diff' },
      { stage: 'build', k: 'fail', who: ['gpt'], t: '10:36', text: 'GPT 审计 a1c93e0：未通过。', chips: [['bad', '空列表时计数为 1'], ['bad', '缺少按仓库筛选的测试']], detail: 'audit' },
      { stage: 'build', k: 'sys', who: [], t: '10:36', text: '已自动打回 Codex 返工（第 2 轮，上限 3 轮）。' },
      { stage: 'build', k: 'live', who: ['codex'], t: '现在', text: 'Codex 返工中：修复计数，补充筛选测试…' },
    ],
    rules: ['审计不通过自动返工，最多 3 轮', '第 3 轮仍不通过：停下来问我', '合并前需要我验收', '只在决策、阻塞、验收时通知我'],
  },
  {
    id: 't39', repo: 'ai-one', issue: 39, title: '讨论结束后必定生成最终报告', state: 'accept', lead: 'flow', flow: 'full',
    stateText: '待你验收', updated: '12 分钟前',
    now: '全部完成，等你验收并合并 PR #40。', nowMeta: '共 1 小时 48 分钟 · 返工 1 次 · 审计与终审针对同一 HEAD',
    team: ['gpt', 'argon', 'opus', 'codex'], pr: { n: 40, st: 'ready' }, ci: 'ok', review: { st: 'ok', text: 'GPT 审计 ✓ · Opus 终审 ✓' },
    stages: [
      { id: 'grill', st: 'done', team: ['gpt', 'argon'], sum: '4 条需求，无分歧', dur: '14 分钟' },
      { id: 'plan', st: 'done', team: ['gpt', 'argon', 'opus'], sum: '采用“正常结束必出报告，失败标未完成”', dur: '22 分钟' },
      { id: 'split', st: 'skip', team: [], sum: '单一 PR，已跳过' },
      { id: 'build', st: 'done', team: ['codex', 'gpt'], sum: 'Codex 实现，GPT 审计：返工 1 次后通过', dur: '58 分钟' },
      { id: 'ship', st: 'you', team: ['gpt', 'opus'], sum: 'Opus 终审通过，等你验收' },
    ],
    events: [
      { stage: 'build', k: 'step', who: ['codex'], t: '11:20', text: 'Codex 返工后推送 7be41d2。', chips: [['ok', '提交 7be41d2 · 已回读']] },
      { stage: 'build', k: 'result', who: ['gpt'], t: '11:31', text: 'GPT 复审 7be41d2：通过。', chips: [['ok', '审计 PASS @ 7be41d2']] },
      { stage: 'ship', k: 'result', who: ['opus'], t: '11:46', text: 'Opus 终审 7be41d2：通过，建议你在桌面端真机跑一次。', chips: [['ok', '终审 PASS @ 7be41d2']] },
      { stage: 'ship', k: 'you', who: ['gpt'], t: '11:48', text: 'GPT 已整理验收单，等你决定。' },
    ],
    accept: {
      did: ['讨论正常结束、提前结束、达到轮数上限时都会生成最终报告', '报告分为：共同结论 / 仍有分歧 / 证据缺口', '运行失败标记为“未完成”，不再伪装成完整报告'],
      verify: [['ok', 'CI 24/24 通过', 'GitHub 回读'], ['ok', '新增单元测试 18 个', 'CI 内运行'], ['warn', '桌面端真机 WebView 未验证', '需要你跑一次']],
      reviews: [['gpt', 'GPT 审计 PASS', '7be41d2'], ['opus', 'Opus 终审 PASS', '7be41d2']],
      risk: 'Gemini 网页偶尔改写审计格式，已加降级处理；极端情况下报告会标“格式无法解析”。',
    },
    rules: ['合并前需要我验收', '审计与终审必须针对同一 HEAD'],
  },
  {
    id: 't12', repo: 'notes-sync', issue: 12, title: '离线编辑冲突的合并策略', state: 'block', lead: 'flow', flow: 'full',
    stateText: '阻塞 · Argon 需要登录', updated: '18 分钟前',
    now: '“定方案”第 2 轮停在 Argon：它的登录已失效。', nowMeta: 'GPT 与 Opus 本轮已发言 · 其他任务不受影响',
    team: ['gpt', 'argon', 'opus'], pr: null, ci: null, review: null,
    stages: [
      { id: 'grill', st: 'done', team: ['gpt', 'argon'], sum: '需求：离线编辑、三方合并、可回滚', dur: '16 分钟' },
      { id: 'plan', st: 'block', team: ['gpt', 'argon', 'opus'], sum: '第 2 轮讨论等待 Argon', round: '2/3' },
      { id: 'split', st: 'todo', team: ['gpt'], sum: '' },
      { id: 'build', st: 'todo', team: ['codex', 'gpt'], sum: '' },
      { id: 'ship', st: 'todo', team: ['gpt', 'opus'], sum: '' },
    ],
    events: [
      { stage: 'plan', k: 'step', who: ['gpt', 'argon', 'opus'], t: '09:40', text: '三方各自给出方案：CRDT、三方合并 + 人工兜底、按字段最后写入。' },
      { stage: 'plan', k: 'step', who: ['gpt', 'argon', 'opus'], t: '09:52', text: '第 1 轮交换：放弃“最后写入”；CRDT 与三方合并仍有分歧。' },
      { stage: 'plan', k: 'block', who: ['argon'], t: '10:04', text: 'Argon 网页跳到了登录页，第 2 轮发言没有发出。' },
    ],
    need: {
      kind: 'login', title: 'Argon（Gemini）需要重新登录',
      desc: '登录后会自动把第 2 轮消息重新发给 Argon，不会重复发送给已完成的 GPT 与 Opus。',
      actions: [['primary', '打开 Argon 网页登录', 'relogin'], ['', '本轮由 Opus 代替 Argon', 'sub'], ['ghost', '暂停任务', 'pause']],
    },
    disc: {
      lanes: ['gpt', 'argon', 'opus'],
      phases: ['独立方案', '第 1 轮', '第 2 轮'],
      cells: [
        { gpt: ['done', '主张 CRDT：天然无冲突'], argon: ['done', '主张三方合并 + 人工兜底'], opus: ['done', '先列出冲突类型再选'] },
        { gpt: ['done', '承认 CRDT 存储膨胀'], argon: ['done', '补充：附件无法 CRDT'], opus: ['done', '建议混合：文本 CRDT，元数据三方合并'] },
        { gpt: ['done', '同意混合方案，追问回滚'], argon: ['block', '登录失效，未发出'], opus: ['done', '给出回滚设计草案'] },
      ],
    },
    rules: ['方案审计 PASS 才进入拆任务', '审计不通过自动返工，最多 3 轮'],
  },
  {
    id: 't7', repo: 'home-lab', issue: 7, title: '备份脚本重构为可测试模块', state: 'run', lead: 'flow', flow: 'parallel',
    stateText: '并行开发 · 2/3 进行中', updated: '1 分钟前',
    now: '3 个子任务并行：Codex 和 Claude Code 在开发，GPT 已完成简单的一项。', nowMeta: '已用 26 分钟 · 全部完成后 GPT 审计，Opus 终审',
    team: ['opus', 'gpt', 'codex', 'cc'], pr: { n: 9, st: 'ready' }, ci: 'ok', review: null,
    stages: [
      { id: 'plan', st: 'done', team: ['opus'], sum: 'Opus 设计：拆为配置、轮转、文档三块；你已确认', dur: '18 分钟' },
      { id: 'split', st: 'done', team: ['gpt'], sum: '3 个子任务，互不改同一文件', dur: '4 分钟' },
      { id: 'build', st: 'active', team: ['codex', 'cc', 'gpt'], sum: '并行执行中', round: '2 个进行中' },
      { id: 'ship', st: 'todo', team: ['opus', 'gpt'], sum: '预计：Opus 终审，GPT 汇总' },
    ],
    events: [
      { stage: 'plan', k: 'you', who: [], t: '09:15', text: '你确认了 Opus 的方案（流程要求设计后先给你看）。' },
      { stage: 'split', k: 'result', who: ['gpt'], t: '09:19', text: 'GPT 拆出 3 个子任务，各开一个 Issue 与分支。' },
    ],
    lanes: [
      { n: '①', title: '抽出配置解析模块', who: 'codex', st: 'run', meta: 'feat/7a-config · 05:40', depth: '标准' },
      { n: '②', title: '快照轮转改为纯函数 + 测试', who: 'cc', st: 'run', meta: 'feat/7b-rotate · 12:03', depth: '深度' },
      { n: '③', title: 'README 用法更新', who: 'gpt', st: 'done', meta: 'PR #9 · 等 Codex 交叉审计（作者不审自己）', depth: '快速' },
    ],
    rules: ['设计完成后先给我确认', '子任务不得修改同一文件', '作者不审自己：③ 由 Codex 交叉审计', 'Opus 只做设计与终审（额度稀缺）'],
  },
  {
    id: 't45', repo: 'ai-one', issue: 45, title: '会话过长时自动交接到新会话', state: 'decide', lead: 'gpt', flow: 'lead',
    stateText: '需要你决定', updated: '6 分钟前',
    now: '第 3 次审计仍未通过：GPT 与 Codex 对触发方式有分歧，返工已停下。', nowMeta: '3 次审计 · 共 41 分钟 · 继续返工前需要你定方向',
    team: ['gpt', 'codex'], pr: { n: 46, st: 'draft' }, ci: 'ok', review: { st: 'fail', text: '第 3 次审计未通过' },
    stages: [
      { id: 'grill', st: 'done', team: ['gpt', 'argon'], sum: '“提醒 + 一键交接”为默认', dur: '11 分钟' },
      { id: 'plan', st: 'done', team: ['gpt'], sum: 'GPT 自定方案', dur: '4 分钟' },
      { id: 'build', st: 'you', team: ['codex', 'gpt'], sum: '第 3/3 轮审计未通过，等你决定', round: '3/3' },
      { id: 'ship', st: 'todo', team: ['gpt'], sum: '' },
    ],
    events: [
      { stage: 'build', k: 'fail', who: ['gpt'], t: '10:20', text: '第 1 次审计：未通过（阈值写死）。' },
      { stage: 'build', k: 'fail', who: ['gpt'], t: '10:34', text: '第 2 次审计：未通过（仍按字数判断）。' },
      { stage: 'build', k: 'fail', who: ['gpt'], t: '10:51', text: '第 3 次审计：未通过。双方的分歧不是代码质量，而是方向。' },
    ],
    need: {
      kind: 'decide', title: '交接何时触发：检测网页提示，还是按字数阈值？',
      sides: [
        ['gpt', 'GPT（审计）', '检测网页的“对话过长”提示。字数阈值在不同模型上差别很大，不可靠。'],
        ['codex', 'Codex（执行）', '网页提示没有稳定的页面标记，检测容易失效。先用阈值 + 手动按钮更稳。'],
      ],
      actions: [['', '采用 GPT 的方向', 'pick'], ['', '采用 Codex 的方向', 'pick'], ['', '请 Opus 裁决', 'opus'], ['ghost', '我来写决定…', 'write']],
    },
    rules: ['审计不通过自动返工，最多 3 轮', '第 3 轮仍不通过：停下来问我'],
  },
  {
    id: 't15', repo: 'notes-sync', issue: 15, title: '同步日志导出为 CSV', state: 'paused', lead: 'gpt', flow: 'lead',
    stateText: '已暂停 · 你在 GPT 网页操作', updated: '25 分钟前',
    now: '你暂停了任务，正在 GPT 网页里手动调整导出字段。', nowMeta: '交还后可采用你在网页中的最新结果继续',
    team: ['gpt'], pr: { n: 16, st: 'draft' }, ci: 'ok', review: null,
    stages: [
      { id: 'plan', st: 'done', team: ['gpt'], sum: 'GPT 自定方案', dur: '2 分钟' },
      { id: 'build', st: 'paused', team: ['gpt'], sum: '你接管中' },
      { id: 'ship', st: 'todo', team: ['gpt'], sum: '' },
    ],
    events: [{ stage: 'build', k: 'you', who: [], t: '10:10', text: '你暂停了任务并接管 GPT 网页。' }],
    rules: ['合并前需要我验收'],
  },
  {
    id: 't36', repo: 'ai-one', issue: 36, title: '精简 Issue 模板', state: 'done', lead: 'gpt', flow: 'lead',
    stateText: '已合并', updated: '昨天', now: 'PR #37 已由你合并。', nowMeta: '', team: ['gpt', 'argon'],
    pr: { n: 37, st: 'merged' }, ci: 'ok', review: { st: 'ok', text: 'Argon 审计 ✓' },
    stages: [{ id: 'build', st: 'done', team: ['gpt', 'argon'], sum: '' }, { id: 'ship', st: 'done', team: ['gpt'], sum: '' }], events: [], rules: [],
  },
  {
    id: 'd1', repo: null, issue: null, kind: 'discussion', title: '本地 Agent 接入：CLI 包装还是 MCP？', state: 'done', lead: 'flow', flow: 'grillonly',
    stateText: '讨论完成', updated: '昨天', now: '3 条结论，1 项分歧。', nowMeta: '', team: ['gpt', 'argon'],
    stages: [{ id: 'grill', st: 'done', team: ['gpt', 'argon'], sum: '' }], events: [], rules: [],
  },
];

/* ---------- 想需求：模拟讨论脚本（场景 A） ---------- */
const GRILL_SCRIPT = {
  topic: '会话过长时，ai-one 应该自动交接，还是提醒我手动交接？',
  lanes: ['gpt', 'argon', 'opus'],
  phases: ['独立思考', '第 1 轮交换', '审计', '第 2 轮交换'],
  cells: [
    { gpt: '倾向自动交接：长会话质量下降，人很难察觉。', argon: '倾向提醒 + 一键交接：自动交接可能丢掉隐含上下文。' },
    { gpt: '认同丢上下文的风险；建议默认提醒，任务自动运行时再自动交接。', argon: '补充：交接前生成可编辑的交接摘要，并保留旧会话链接。' },
    { opus: '结论有依据。遗漏一点：“额度耗尽换模型”也是交接，是否同一功能？' },
    { gpt: '应分开：会话过长是同一模型换会话；额度耗尽是换模型。', argon: '同意分开；换模型时目标模型必须由你确认。' },
  ],
  result: {
    agree: [
      ['默认“提醒 + 一键交接”；任务自动运行时改为自动交接并通知你', ['gpt', 'argon'], '推理'],
      ['交接前生成可编辑的交接摘要，保留旧会话链接', ['gpt', 'argon'], '推理'],
      ['“会话过长”与“额度耗尽换模型”拆成两个功能', ['gpt', 'argon', 'opus'], '推理'],
    ],
    split: { q: '靠什么判断“会话过长”？', sides: [['gpt', '检测网页自己的“对话过长”提示'], ['argon', '字数阈值 + 手动按钮']] },
    gaps: ['各网页的“对话过长”提示是否有稳定的页面标记（需要实测）'],
    next: '转入“定方案”，建议请 Opus 评估检测方式的可行性。',
  },
};

/* ---------- 聊天（场景 F）---------- */
const CHAT_SEED = {
  convos: [
    { id: 'c1', title: 'Tauri 子 WebView 隐藏后还会继续渲染吗？', who: ['gpt', 'opus', 'argon'], mode: '自由', t: '10:42' },
    { id: 'c2', title: '给 notes-sync 起几个版本代号', who: ['gpt', 'grok'], mode: '脑暴', t: '昨天' },
    { id: 'c3', title: 'React 19 的 use() 是否适合这里', who: ['gpt', 'opus'], mode: '辩论', t: '周一' },
    { id: 'c4', title: 'WebView2 内存占用排查', who: ['gpt', 'argon'], mode: '咨询', t: '10/18' },
  ],
  q: 'Tauri v2 的子 WebView 被隐藏（hide）后，页面里的 JS 和网络请求还会继续运行吗？对长时间生成的 AI 回复有什么影响？',
  replies: {
    gpt: { model: 'Thinking', t: '12 秒', text: '会继续运行。hide 只是把原生窗口设为不可见，页面进程不会被挂起，所以 JS、定时器和 fetch 都照常工作。\n\n但要注意两点：\n1. WebView2 在不可见时可能降低定时器频率（类似浏览器后台标签），requestAnimationFrame 会暂停；\n2. 如果页面依赖 IntersectionObserver 或可见性判断来加载内容，隐藏期间可能不触发。\n\n对 AI 回复：流式生成本身由服务器推送，一般不受影响；但读取 DOM 判断“是否生成完”的逻辑最好不要依赖 rAF。' },
    opus: { model: 'Opus', t: '21 秒', text: '结论：大体会继续，但不是“完全等同前台”。\n\n- WebView2 有 “IsVisible=false” 时的节流策略，计时器可能被合并到 1 秒一次；\n- 部分网页会监听 visibilitychange，在不可见时主动暂停流式渲染（这和 Tauri 无关）；\n- 建议在宿主侧用 TrySuspend/Resume 之外的方式（例如移出可视区域而非 hide）做对照实验。\n\n这需要在真实 ChatGPT / Gemini 页面上实测，不能只看文档。' },
    argon: { model: 'Argon', t: '—', text: '', err: '登录已失效，消息未发送' },
  },
};

/* ---------- 检查器内容（逐层展开）---------- */
const DETAIL = {
  grill: {
    title: '想需求 · GPT + Argon', sum: ['需求 1：首页最上方显示“需要你”的事，按紧急程度排序', '需求 2：进行中的任务显示阶段、负责人、PR/CI 状态', '需求 3：空状态写“现在没有需要你处理的事”', '留到下一版：多窗口 HUD（Argon 提出，GPT 同意延后）'],
  },
  plan: { title: '定方案 · GPT', sum: ['复用 TaskRow 组件，新增 NeedsYouSection', '排序：决策 > 阻塞 > 验收 > 其他', '不新增后端接口，数据来自现有任务存储'] },
  diff: { title: '提交 a1c93e0 · Codex', sum: ['src/home/NeedsYouSection.tsx  +86', 'src/home/TaskRow.tsx  +12 −4', 'src/home/__tests__/needsYou.test.tsx  +54'] },
  audit: { title: 'GPT 审计 a1c93e0 · 未通过', sum: ['问题 1：items 为空数组时 count 取了 fallback 1（NeedsYouSection.tsx:41）', '问题 2：多仓库筛选没有测试覆盖', '其余：结构清晰，命名与现有组件一致'] },
};
