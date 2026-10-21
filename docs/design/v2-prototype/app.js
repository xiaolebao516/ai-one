/* ai-one v2 交互原型。纯静态 HTML/CSS/JS，不是正式 React 组件；所有数据来自 data.js 的模拟数据。 */
/* 经典 <script>：界面里的 onclick 直接调用本文件的函数，文件末尾统一挂到 window。 */
/* global window, document, location, setTimeout, clearTimeout, structuredClone, URLSearchParams */
'use strict';

const { IMPL_LABEL, RES_SEED, BRIDGE, STAGE_LIB, FLOW_LIB, TASK_SEED, GRILL_SCRIPT, CHAT_SEED, DETAIL } = window.AIONE_DATA;

/* ================= 基础 ================= */
const I = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>',
  tasks: '<path d="M3 6l1.5 1.5L7 5"/><path d="M3 12l1.5 1.5L7 11"/><path d="M3 18l1.5 1.5L7 17"/><path d="M11 6h10M11 12h10M11 18h10"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  flow: '<rect x="3" y="3" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/><path d="M6.5 9v3a3 3 0 0 0 3 3H14"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1 1 17 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M7 5v14l12-7z"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4M12 17v.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pr: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7"/><path d="M18 15.5V10a3 3 0 0 0-3-3h-4"/><path d="m13 4.5-2.5 2.5L13 9.5"/>',
  branch: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="7" r="2.5"/><path d="M6 7.5v9"/><path d="M18 9.5a6 6 0 0 1-6 6H8"/>',
  issue: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  chevd: '<path d="m6 9 6 6 6-6"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  rework: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.7"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  merge: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 7.5v9"/><path d="M6 8a8 8 0 0 0 9.5 4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  fwd: '<path d="M15 6l5 5-5 5"/><path d="M20 11H9a5 5 0 0 0-5 5v2"/>',
  quote: '<path d="M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  min: '<path d="M6 12h12"/>',
  max: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  attach: '<path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3l7.5-7.5"/>',
  handoff: '<path d="M4 7h11l-3-3M20 17H9l3 3"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
};
const ico = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${I[n] || ''}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const impl = (lv, note = '', cls = '') => ` data-impl="${lv}" data-impl-label="${IMPL_LABEL[lv]}${note ? ' · ' + note : ''}"${cls ? ` class="${cls}"` : ''}`;
const STAGE = Object.fromEntries(STAGE_LIB.map((s) => [s.id, s]));
const STATE = {
  run: ['进行中', 'bolt'], rework: ['返工中', 'rework'], decide: ['需要你决定', 'flag'], accept: ['待验收', 'check'],
  block: ['阻塞', 'lock'], paused: ['已暂停', 'pause'], done: ['已完成', 'check'],
};
const NEED_STATES = ['decide', 'accept', 'block'];
const RUN_STATES = ['run', 'rework'];
const REPOS = ['ai-one', 'notes-sync', 'home-lab'];

/* 每个任务中参与者的角色与当前状态（模拟） */
const ROLE = {
  t42: { cc: ['协调 · 本机验证', '等返工结果'], gpt: ['执行（会话 A）· 审计（会话 B）', '执行会话返工中 · 03:12'], argon: ['想需求', '已完成'] },
  t39: { cc: ['协调 · 验证 · 汇总', '等你验收'], gpt: ['执行 · 独立审计', '审计 PASS'], argon: ['想需求 · 定方案', '已完成'], opus: ['终审', '终审 PASS'] },
  t12: { gpt: ['讨论', '第 2 轮已发言'], argon: ['讨论', '登录失效'], cc: ['把关', '第 2 轮已发言'] },
  t7: { cc: ['设计 · 拆分 · 执行②', '开发中 · 12:03'], gpt: ['执行③ · 审计①②', '③ 已完成'], codex: ['执行① · 审计③', '开发中 · 05:40'], opus: ['终审', '等待终审'] },
  t45: { cc: ['协调 · 执行', '已暂停返工'], gpt: ['独立审计（会话 B）', '等你决定'] },
  t15: { cc: ['协调', '等你交还'], gpt: ['执行', '你在接管'] },
  t36: { cc: ['协调', '已完成'], gpt: ['执行 · 独立审计', '已完成'] },
  d1: { gpt: ['讨论', '已完成'], argon: ['讨论', '已完成'] },
};
const ROLE_SEED = structuredClone(ROLE);

let R, TASKS, S, seq = 100;
function freshState() {
  return {
    view: 'home', task: null, theme: S?.theme || 'light', impl: S ? S.impl : true, win: S?.win || 'fit', fast: false,
    open: {}, drawer: null, palette: false, pq: '', pi: 0, menu: null, hud: false, toasts: [], web: null,
    comp: { mode: 'lead', stage: 'grill', flow: 'quick', repo: 'ai-one', text: '', sub: null },
    dock: '', chat: { conv: 'c1', tab: 'cmp', targets: ['gpt', 'opus', 'argon'], mode: '自由', full: {}, fwd: null, replies: null, q: null, text: '' },
    flow: { sel: 'parallel', pop: null, brief: null }, tasksGroup: 'state', repoFilter: null, writing: null, factsOpen: false,
  };
}
function resetAll() {
  (TASKS || []).forEach((t) => clearTimeout(t._timer));
  R = structuredClone(RES_SEED);
  TASKS = structuredClone(TASK_SEED);
  Object.keys(ROLE).forEach((k) => delete ROLE[k]);
  Object.assign(ROLE, structuredClone(ROLE_SEED));
  S = freshState();
  S.chat.replies = structuredClone(CHAT_SEED.replies);
  S.chat.q = CHAT_SEED.q;
}
const task = (id) => TASKS.find((t) => t.id === id);
const cur = () => task(S.task);
const needs = () => TASKS.filter((t) => NEED_STATES.includes(t.state)).sort((a, b) => NEED_STATES.indexOf(a.state) - NEED_STATES.indexOf(b.state));

/* ================= 小组件 ================= */
function av(id, size = '', extra = '') {
  const r = R[id];
  if (!r) return '';
  return `<span class="av ${size} ${r.kind === 'agent' ? 'agent' : ''} ${extra}" style="--c:${r.color}" title="${esc(r.full)}">${r.letter}</span>`;
}
const avs = (ids, size = 's') => `<span class="avs">${[...new Set(ids)].map((id) => av(id, size)).join('')}</span>`;
const pill = (st, text) => `<span class="pill ${st}"><span class="sg ${st}" style="width:12px;height:12px"></span>${esc(text || STATE[st]?.[0] || '')}</span>`;
const repoLabel = (t) => (t.repo ? `${t.repo} #${t.issue}` : '讨论');
function prChip(t) {
  if (!t.pr) return '';
  const m = { draft: ['', '草稿'], ready: ['', '可审查'], merged: ['ok', '已合并'] }[t.pr.st];
  return `<span class="chip ${m[0]}">${ico('pr', 'xs')}#${t.pr.n} ${m[1]}</span>`;
}
function ciChip(ci) {
  if (!ci) return '';
  return { ok: `<span class="chip ok">${ico('check', 'xs')}CI</span>`, run: `<span class="chip">${ico('clock', 'xs')}CI 运行中</span>`, fail: `<span class="chip bad">${ico('x', 'xs')}CI</span>` }[ci];
}
function quota(r, big = false) {
  const q = r.quota;
  const lv = q.level === 'warn' ? 'warn' : q.level === 'bad' ? 'bad' : q.level === 'none' ? 'none' : '';
  const typ = { known: '已知', hint: '网页提示', estimate: '估算', unknown: '未知' }[q.type];
  let vis;
  if (q.type === 'known') vis = `<span class="qbar"><b style="width:${q.pct}%"></b></span>`;
  else if (q.type === 'estimate') vis = `<span class="qbar est"><b style="width:${q.pct}%"></b></span>`;
  else if (q.type === 'unknown') vis = '<span class="qbar unk"></span>';
  else vis = `<span class="qdot ${lv}"></span>`;
  if (!big) return `<span class="q">${vis}<span>${esc(q.type === 'hint' ? q.text : q.type === 'unknown' ? '未知' : (q.type === 'estimate' ? '~' : '') + q.pct + '%')}</span></span>`;
  return `<div class="qbig"><div class="t">${q.type === 'hint' ? `<span class="qdot ${lv}"></span>` : ''}${esc(q.text)}${q.reset ? ` <span class="faint">· ${esc(q.reset)}</span>` : ''}</div>${q.type !== 'hint' ? vis : ''}<div class="s"><span class="qtype">${typ}</span> ${esc(q.src)}</div></div>`;
}
function loginPill(r) {
  if (r.login === 'ok') return '<span class="pill done" style="height:20px;font-size:11px">已登录</span>';
  if (r.login === 'expired') return '<span class="pill block" style="height:20px;font-size:11px">登录失效</span>';
  return '<span class="pill ghost" style="height:20px;font-size:11px">未登录</span>';
}
function resDot(id) {
  const r = R[id];
  const c = r.login !== 'ok' ? 'var(--block)' : r.quota.level === 'warn' ? 'var(--you)' : r.state === 'run' ? 'var(--run)' : 'var(--done)';
  return `<span class="av s" style="--c:${r.color};margin-left:3px" title="${esc(r.full)}">${r.letter}<span class="sdot" style="background:${c}"></span></span>`;
}

/* ================= 外壳 ================= */
function titlebar() {
  const nNeed = needs().length;
  const nRun = TASKS.filter((t) => RUN_STATES.includes(t.state)).length;
  return `<div class="tb">
    <div class="brand"><span class="logo"></span><span>ai-one</span></div>
    <button class="kbar" onclick="openPalette()">${ico('search', 's')}<span class="lbl">搜索任务、命令或输入 /grill</span><span style="flex:1"></span><span class="kbd">Ctrl K</span></button>
    <div class="island impl-below"${impl('plan')}>
      <button onclick="go('tasks')" title="进行中的任务"><span class="dot" style="background:#78A6FF"></span><span class="n">${nRun}</span><span class="lbl">进行中</span></button>
      <span class="div"></span>
      <button onclick="go('home')" title="需要你处理的事" class="you"><span class="dot" style="background:#F6C46E"></span><span class="n">${nNeed}</span><span class="lbl">需要你</span></button>
    </div>
    <span class="sp"></span>
    <button class="hudbtn" onclick="toggle('hud')" title="资源与额度（HUD）">${['cc', 'gpt', 'argon', 'opus', 'codex'].map(resDot).join('')}</button>
    <div class="winctl"><span>${ico('min', 's')}</span><span>${ico('max', 's')}</span><span>${ico('x', 's')}</span></div>
  </div>`;
}

function sidebar() {
  const nNeed = needs().length;
  const nav = (v, icon, label, cnt = '') => `<button class="nav ${S.view === v ? 'on' : ''}" onclick="go('${v}')" title="${label}">${ico(icon)}<span class="lbl">${label}</span>${cnt}</button>`;
  const live = TASKS.filter((t) => t.state !== 'done' && t.repo);
  const groups = REPOS.map((r) => [r, live.filter((t) => t.repo === r)]).filter((g) => g[1].length);
  const discs = TASKS.filter((t) => !t.repo).slice(0, 3);
  const item = (t) => `<button class="titem ${S.view === 'task' && S.task === t.id ? 'on' : ''}" onclick="openTask('${t.id}')" title="${esc(t.title)}"><span class="sg ${t.state}"></span><span class="tt">${esc(t.title)}</span>${t.issue ? `<span class="num">#${t.issue}</span>` : ''}</button>`;
  return `<aside class="side">
    <button class="newbtn" onclick="newTask()">${ico('plus')}<span class="lbl">新建</span><span class="kbd">Ctrl N</span></button>
    ${nav('home', 'home', '总览', nNeed ? `<span class="cnt you">${nNeed}</span>` : '')}
    ${nav('tasks', 'tasks', '任务', `<span class="cnt plain">${TASKS.filter((t) => t.repo && t.state !== 'done').length}</span>`)}
    ${nav('chat', 'chat', '聊天')}
    ${nav('flows', 'flow', '阶段与流程')}
    ${nav('res', 'gauge', '资源')}
    <div class="sidesec">进行中的任务</div>
    <div class="sidescroll">
      ${groups.map(([r, ts]) => `<div class="repo">${ico('folder', 'xs')}${r}</div>${ts.map(item).join('')}`).join('')}
      <div class="sidesec" style="margin-top:12px">讨论</div>
      ${discs.map(item).join('')}
    </div>
    <div class="sidefoot">
      <button class="nav" onclick="toast('设置沿用上游的设置页（语言、快照、快捷键、通知），本原型不展开。')" title="设置">${ico('sliders')}<span class="lbl">设置</span></button>
      <button class="nav" style="flex:none;width:36px;padding:0;justify-content:center" onclick="setTheme()" title="切换主题">${ico(S.theme === 'dark' ? 'sun' : 'moon')}</button>
    </div>
  </aside>`;
}

/* ================= 总览 ================= */
function composer() {
  const c = S.comp;
  const st = STAGE[c.stage];
  const modes = [
    ['chat', '聊天', ''],
    ['stage', st.name, st.cmd],
    ['lead', '交给 CC', '/lead'],
    ['flow', '流程：' + FLOW_LIB.find((f) => f.id === c.flow).name, ''],
  ];
  const ph = {
    chat: '直接问点什么，同时发给选中的 AI，回答并排比较…',
    stage: c.stage === 'grill' ? '说一个想法或问题。GPT 和 Argon 会先各自思考，再交换意见，最后给你一份汇总…' : `描述要${st.name}的内容…`,
    lead: '描述要做的事。CC 会自己调查、经 Prodex 派 GPT 执行或审计、安排返工复审，只在需要你时停下…',
    flow: '描述需求，按所选流程从头推进…',
  }[c.mode];
  const team = teamFor(c);
  const pre = preflight(team);
  const canStart = !pre.block;
  const slash = S.slash ? slashMenu() : '';
  const menu = S.menu === 'repo' ? `<div class="menu" style="left:14px;bottom:44px">${['无仓库（只讨论）', ...REPOS].map((r, i) => `<button onclick="setComp('repo','${i ? r : ''}')">${ico(i ? 'folder' : 'chat', 's')}${r}${c.repo === (i ? r : '') ? `<span class="d">${ico('check', 's')}</span>` : ''}</button>`).join('')}<hr><button onclick="toast('（模拟）从 GitHub 选择其他仓库')">${ico('plus', 's')}其他仓库…</button></div>`
    : S.menu === 'flow' ? `<div class="menu" style="right:120px;bottom:44px">${FLOW_LIB.filter((f) => f.kind === 'flow').map((f) => `<button onclick="setComp('flow','${f.id}')">${ico('flow', 's')}${f.name}<span class="d">${f.stages.length} 个阶段</span></button>`).join('')}<hr><button onclick="go('flows')">${ico('sliders', 's')}管理流程…</button></div>` : '';
  return `<div class="composer"${impl('plan', '“聊天”沿用已实现能力')}>
    <textarea data-k="comp" rows="2" placeholder="${esc(ph)}" oninput="compInput(this)" onkeydown="compKey(event)">${esc(c.text)}</textarea>
    <div class="crow">
      <div class="seg">${modes.map(([m, l, k]) => `<button class="${c.mode === m ? 'on' : ''}" onclick="${m === 'flow' && c.mode === 'flow' ? "toggle('menu','flow')" : `setComp('mode','${m}')`}">${l}${k ? `<span class="k">${k}</span>` : ''}${m === 'flow' ? ico('chevd', 'xs') : ''}</button>`).join('')}</div>
      <span class="sp"></span>
      ${c.mode !== 'chat' ? `<button class="sel boxed" onclick="toggle('menu','repo')">${ico(c.repo ? 'folder' : 'chat', 's')}${c.repo || '不关联仓库'}${ico('chevd', 'xs')}</button>` : ''}
      <button class="btn primary" ${canStart ? '' : 'disabled'} onclick="start()">开始 <span class="kbd" style="background:transparent;color:inherit;border-color:rgba(255,255,255,.3)">Ctrl ↵</span></button>
    </div>
    <div class="cfoot">
      <span style="display:inline-flex;align-items:center;gap:6px">${avs(team.ids)} ${esc(team.text)}</span>
      <button class="lnk" onclick="${c.mode === 'flow' || c.mode === 'stage' ? "go('flows')" : c.mode === 'lead' ? "S.flow.sel='lead';go('flows')" : "go('chat')"}">调整</button>
      <span class="faint">·</span><span class="faint">${esc(team.cost)}</span>
      ${pre.html}
    </div>
    ${slash}${menu}
  </div>`;
}
function teamFor(c) {
  const sub = (ids) => ids.map((id) => (id === 'argon' && c.sub ? c.sub : id));
  if (c.mode === 'chat') return { ids: S.chat.targets, text: S.chat.targets.map((i) => R[i].name).join(' · ') + ' · 自由聊天', cost: '每个 AI 一条消息' };
  if (c.mode === 'stage') {
    const ids = sub(STAGE[c.stage].team.map((m) => m[0]));
    const extra = c.stage === 'grill' ? ' · Opus 审计（可选）' : '';
    return { ids: c.stage === 'grill' ? [...ids, 'opus'] : ids, text: ids.map((i) => R[i].name).join(' + ') + ' ' + STAGE[c.stage].pattern + extra, cost: '订阅内资源 · 约 6–10 分钟' };
  }
  if (c.mode === 'lead') return { ids: ['cc', 'gpt', 'argon', 'opus'], text: 'CC 协调，经 Prodex 派 GPT 执行或独立审计，需要时请 Argon、Opus', cost: '优先用有余量的 ChatGPT，Opus 网页只在必要时', lead: true };
  const f = FLOW_LIB.find((x) => x.id === c.flow);
  const ids = sub([...new Set(f.stages.flatMap((s) => s.team.map((m) => m[0])))]);
  return { ids, text: f.stages.map((s) => STAGE[s.s].name).join(' → '), cost: `${f.stages.length} 个阶段` };
}
function preflight(team) {
  const bad = team.ids.filter((id) => R[id].login !== 'ok');
  if (!bad.length) return { html: `<span class="faint" style="margin-left:auto;display:inline-flex;align-items:center;gap:5px">${ico('check', 'xs')}参与者均已就绪</span>` };
  const id = bad[0];
  if (team.lead) return { html: `<span class="warn" style="margin-left:auto">${ico('alert', 's')}${R[id].name} 登录失效，CC 派工时会避开它并告诉你</span><button class="lnk" onclick="relogin('${id}')">重新登录</button>` };
  return {
    block: true,
    html: `<span class="warn" style="margin-left:auto">${ico('alert', 's')}${R[id].name} 登录已失效</span><button class="btn s" onclick="relogin('${id}')">打开网页登录</button><button class="btn s ghost" onclick="setComp('sub','opus')">本次用 Opus 代替</button>`,
  };
}
function slashMenu() {
  const q = S.comp.text.slice(1).toLowerCase();
  const items = [...STAGE_LIB.map((s) => [s.cmd, s.name, s.desc.slice(0, 18) + '…', `setComp('stage','${s.id}')`]),
    ['/lead', '交给 CC 协调', 'CC 经 Prodex 派工', "setComp('mode','lead')"],
    ['/chat', '聊天', '直接对话，不启动流程', "setComp('mode','chat')"]].filter((i) => i[0].includes(q) || i[1].includes(q));
  if (!items.length) return '';
  return `<div class="slash">${items.map((i, n) => `<button class="it ${n === 0 ? 'on' : ''}" onclick="${i[3]};S.comp.text='';S.slash=false;render()"><span class="mono">${i[0]}</span>${i[1]}<span class="d">${i[2]}</span></button>`).join('')}</div>`;
}

function needCard(t) {
  const kind = t.state === 'accept' ? ['验收', ''] : t.state === 'block' ? [t.need?.kind === 'login' ? '登录' : '阻塞', 'block'] : ['决策', ''];
  const title = t.state === 'accept' ? `PR #${t.pr.n} 已就绪，等你验收` : t.need?.title;
  const acts = t.state === 'accept'
    ? `<button class="btn s you" onclick="openTask('${t.id}')">查看验收单</button><button class="btn s ghost" onclick="toast('（模拟）在浏览器打开 PR #${t.pr.n}')">${ico('ext', 's')}在 GitHub 打开</button>`
    : t.state === 'block'
      ? `<button class="btn s you" onclick="relogin('argon')">打开 Argon 网页登录</button><button class="btn s ghost" onclick="openTask('${t.id}')">进入任务</button>`
      : `<button class="btn s you" onclick="openTask('${t.id}')">去决定</button><button class="btn s ghost" onclick="needAct('${t.id}','opus')">请 Opus 裁决</button>`;
  return `<div class="need">
    <span class="ic ${kind[1]}">${ico(STATE[t.state][1], 's')}</span>
    <div class="h"><span class="kind ${kind[1]}">${kind[0]}</span>${esc(title)}</div>
    <button class="go" onclick="openTask('${t.id}')">${ico('chev')}</button>
    <div class="meta">${repoLabel(t)} · ${esc(t.title)} · ${t.updated}</div>
    <div class="acts">${acts}</div>
  </div>`;
}
function miniCls(t, s) {
  if (s.st === 'active') return t.state === 'rework' ? 'rework' : t.state === 'paused' ? 'paused' : 'run';
  return s.st;
}
function trow(t) {
  return `<div class="trow" onclick="openTask('${t.id}')">
    <span class="sg ${t.state}"></span>
    <div style="min-width:0"><div class="tt">${esc(t.title)}</div><div class="sub">${t.repo ? `${ico('folder', 'xs')}` : ico('chat', 'xs')}${repoLabel(t)}<span>·</span><span>${esc(t.stateText)}</span></div></div>
    <div class="mini-stages" title="阶段进度">${t.stages.map((s) => `<i class="${miniCls(t, s)}" title="${STAGE[s.id].name}"></i>`).join('')}</div>
    <div class="tfacts">${avs(t.team)}${prChip(t)}${ciChip(t.ci)}</div>
    <div class="when">${t.updated}</div>
  </div>`;
}
function home() {
  const ns = needs();
  const active = TASKS.filter((t) => [...RUN_STATES, 'paused'].includes(t.state));
  const done = TASKS.filter((t) => t.state === 'done');
  const blockedRes = Object.values(R).filter((r) => r.login === 'expired');
  const warnRes = Object.values(R).filter((r) => r.quota.level === 'warn');
  const line = [
    blockedRes.length ? `${blockedRes.map((r) => r.name).join('、')} 登录失效${TASKS.some((t) => t.state === 'block') ? '，notes-sync #12 停在定方案' : ''}` : '所有 AI 都可用',
    warnRes.length ? `${warnRes.map((r) => r.name).join('、')} 接近上限（${warnRes[0].quota.reset}）` : '',
    '其他任务正常推进',
  ].filter(Boolean).join('；') + '。';
  return `<div class="scroll" data-k="home"><div class="page">
    <div class="hello"${impl('plan')}><div><h1>${active.length} 个任务在推进，${ns.length ? `<em>${ns.length} 件事等你</em>` : '没有需要你处理的事'}</h1><div class="sub">${esc(line)}</div></div></div>
    ${composer()}
    <div class="homegrid">
      <div>
        <div class="sec-h"><h3>需要你</h3><span class="cnt">${ns.length}</span><span class="sp"></span><span class="faint" style="font-size:12px">按紧急程度排序 · 其余事情 AI 自己处理</span></div>
        <div${impl('plan', '', '')}>${ns.length ? ns.map(needCard).join('') : '<div class="quiet">现在没有需要你处理的事。</div>'}</div>
        <div class="sec-h"><h3>进行中</h3><span class="cnt">${active.length}</span><span class="sp"></span><button class="lnk" style="font-size:12px" onclick="go('tasks')">全部任务</button></div>
        <div class="list">${active.map(trow).join('')}</div>
        <div class="sec-h"><h3>最近完成</h3><span class="cnt">${done.length}</span></div>
        <div class="list">${done.map(trow).join('')}</div>
      </div>
      <div>
        <div class="sec-h"><h3>资源</h3><span class="sp"></span><button class="lnk" style="font-size:12px" onclick="go('res')">详情</button></div>
        <div class="card rescard"${impl('plan', '额度')}>${Object.keys(R).map((id) => resRow(id)).join('')}</div>
        <div class="sec-h"><h3>已自动处理</h3><span class="cnt">今天 · 没有打扰你</span></div>
        <div class="card" style="padding:6px 14px"${impl('plan')}>
          ${[['rework', 'ai-one #42 独立审计 REVISE，CC 已派回 GPT 执行会话返工', '10:36'], ['refresh', 'Prodex 一次请求超时、结果不明：CC 用 request_id 恢复了回复，没有重复派工', '10:19'], ['check', 'home-lab #7 子任务 ③ 完成，进入交叉审计', '09:58'], ['handoff', 'ai-one #39 GPT 会话过长，已交接到新会话', '09:31']]
            .map(([i, tx, tm]) => `<div style="display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:12.5px" class="ar">${ico(i === 'refresh' ? 'rework' : i, 's')}<span style="flex:1;color:var(--ink-2)">${tx}</span><span class="faint">${tm}</span></div>`).join('').replace('border-top:1px solid var(--line);', '')}
        </div>
      </div>
    </div>
  </div></div>`;
}
function resRow(id, dark = false) {
  const r = R[id];
  return `<div class="resrow" onclick="${r.kind === 'agent' ? `openRes('${id}')` : `openRes('${id}')`}" style="cursor:pointer">
    ${av(id, 'l')}<div class="nm">${r.name} <span class="faint" style="font-weight:400">${r.plan}</span></div>
    ${quota(r)}
    <div class="nw">${r.login !== 'ok' ? `<span style="color:${dark ? '#FF8A80' : 'var(--block)'}">${esc(r.now)}</span>` : esc(r.now)}</div>
  </div>`;
}

/* ================= 任务列表 ================= */
function tasksView() {
  const list = TASKS.filter((t) => !S.repoFilter || t.repo === S.repoFilter);
  let groups;
  if (S.tasksGroup === 'repo') groups = [...REPOS, null].map((r) => [r ? r : '讨论（不关联仓库）', list.filter((t) => t.repo === r)]);
  else groups = [['需要你', list.filter((t) => NEED_STATES.includes(t.state))], ['进行中', list.filter((t) => RUN_STATES.includes(t.state))], ['已暂停', list.filter((t) => t.state === 'paused')], ['已完成', list.filter((t) => t.state === 'done')]];
  return `<div class="scroll" data-k="tasks"><div class="page">
    <div class="hello" style="align-items:center"${impl('plan')}><div style="flex:1"><h1>任务</h1><div class="sub">跨仓库的 Issue / PR 与讨论。点任意一行进入现场。</div></div>
      <div class="seg"><button class="${S.tasksGroup === 'state' ? 'on' : ''}" onclick="S.tasksGroup='state';render()">按状态</button><button class="${S.tasksGroup === 'repo' ? 'on' : ''}" onclick="S.tasksGroup='repo';render()">按仓库</button></div>
      <button class="btn primary" onclick="newTask()">${ico('plus', 's')}新建</button></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${[null, ...REPOS].map((r) => `<button class="tgt ${S.repoFilter === r ? 'on' : ''}" style="padding:0 12px" onclick="S.repoFilter=${r ? `'${r}'` : 'null'};render()">${r ? ico('folder', 's') + r : '全部仓库'}</button>`).join('')}</div>
    ${groups.filter((g) => g[1].length).map(([g, ts]) => `<div class="sec-h"><h3>${g}</h3><span class="cnt">${ts.length}</span></div><div class="list">${ts.map(trow).join('')}</div>`).join('')}
  </div></div>`;
}

/* ================= 任务现场 ================= */
function taskView(t) {
  if (S.web) return webView(t);
  const disc = t.kind === 'discussion';
  return `<div class="ws ${S.factsOpen ? 'factsopen' : ''}">
    <div class="ws-main">
      <div class="scroll" data-k="task-${t.id}">
        <div class="ws-head"${impl('plan')}>
          <div class="crumbs">${t.repo ? `${ico('folder', 'xs')}${t.repo}<span>/</span><span class="chip link" onclick="toast('（模拟）在浏览器打开 Issue #${t.issue}')">${ico('issue', 'xs')}#${t.issue}</span>${t.pr ? `<span class="chip link" onclick="toast('（模拟）在浏览器打开 PR #${t.pr.n}')">${ico('pr', 'xs')}PR #${t.pr.n}</span>` : ''}` : `${ico('chat', 'xs')}讨论 · 不关联仓库`}</div>
          <div class="ws-title"><h2>${esc(t.title)}</h2>${pill(t.state, t.stateText)}
            <div class="ws-ctl">
              ${!['done', 'accept'].includes(t.state) ? `<button class="btn s" onclick="togglePause('${t.id}')" title="Ctrl+.">${t.state === 'paused' ? ico('play', 's') + '继续' : ico('pause', 's') + '暂停'}</button>` : ''}
              <button class="btn s icon factsbtn" onclick="S.factsOpen=!S.factsOpen;render()" title="详情栏">${ico('panel', 's')}</button>
              <span style="position:relative"><button class="btn s icon" onclick="toggle('menu','task')">${ico('more', 's')}</button>${S.menu === 'task' ? taskMenu(t) : ''}</span>
            </div>
          </div>
          ${disc ? discRail(t) : rail(t)}
        </div>
        <div class="ws-body">
          ${nowCard(t)}
          ${needBlock(t)}
          ${disc ? discBody(t) : t.stages.map((s) => stageSection(t, s)).join('') + (t.lead === 'cc' && !['done', 'accept'].includes(t.state) ? `<div class="stsec"><div class="stsec-h" style="cursor:default"><span class="sg idle"></span><span class="faint">之后的阶段由 CC 根据结果决定</span></div></div>` : '')}
        </div>
      </div>
      ${t.state !== 'done' || disc ? dockComposer(t) : ''}
    </div>
    ${facts(t)}
  </div>`;
}
function taskMenu(t) {
  const members = [...new Set(t.team)];
  return `<div class="menu" style="right:0;top:32px">
    ${members.map((id) => `<button onclick="S.menu=null;openWeb('${id}')">${av(id, 's')}${R[id].kind === 'agent' ? '查看' : '查看 / 接管'} ${R[id].name}${R[id].kind === 'agent' ? ' 终端' : ' 网页'}</button>`).join('')}
    <hr>
    <button onclick="handoff('${t.id}')">${ico('handoff', 's')}交接到新会话<span class="d">会话过长时</span></button>
    <button onclick="S.menu=null;toast('（模拟）用 Prodex 的 request_id 恢复超时请求，不重复派工')">${ico('rework', 's')}恢复派工结果<span class="d">Prodex</span></button>
    <button onclick="S.menu=null;toast('（模拟）导出本任务的 Markdown 报告')">${ico('doc', 's')}导出报告</button>
    <hr>
    <button onclick="stopTask('${t.id}')" style="color:var(--block)">${ico('x', 's')}停止任务</button>
  </div>`;
}
function rail(t) {
  const lead = t.lead === 'cc' ? `<div class="lead">${av('cc', 's')}<span><b>CC</b> 协调<br><span class="faint">经 Prodex 派工</span></span></div>` : `<div class="lead">${ico('flow', 's')}<span><b>${FLOW_LIB.find((f) => f.id === t.flow)?.name || '流程'}</b><br><span class="faint">CC 协调</span></span></div>`;
  return `<div class="rail">${lead}${t.stages.map((s) => {
    const cls = s.st === 'active' ? `active ${t.state === 'rework' ? 'rework' : ''}` : s.st;
    const ds = s.st === 'skip' ? '已跳过' : s.st === 'todo' ? (t.lead === 'cc' ? '预计' : '未开始') : s.st === 'done' ? (s.dur || '完成') : s.round ? (/^[\d/]+$/.test(s.round) ? '第 ' + s.round + ' 轮' : s.round) : STATE[t.state]?.[0];
    return `<button class="st ${cls} ${S.open[t.id + s.id] ? 'sel' : ''}" onclick="openStage('${t.id}','${s.id}')"><div class="bar"></div><div class="nm">${STAGE[s.id].name}${s.team.length ? avs(s.team) : ''}</div><div class="ds">${s.st === 'done' ? ico('check', 'xs') : ''}${esc(ds)}</div></button>`;
  }).join('')}${t.lead === 'cc' && t.dyn ? '<button class="st dyn todo"><div class="bar"></div><div class="nm">…</div><div class="ds">由 CC 决定</div></button>' : ''}</div>`;
}
function nowCard(t) {
  return `<div class="now"><span class="ring ${t.state}">${ico(STATE[t.state][1], 'l')}</span>
    <div style="flex:1;min-width:0"><div class="lbl">现在</div><div class="txt">${esc(t.now)}</div>${t.nowMeta ? `<div class="meta">${esc(t.nowMeta)}</div>` : ''}</div></div>`;
}
function needBlock(t) {
  if (t.state === 'accept' && t.accept) return acceptCard(t);
  if (!t.need || !NEED_STATES.includes(t.state)) return '';
  const n = t.need;
  const block = t.state === 'block';
  return `<div class="ncard ${block ? 'block' : ''}">
    <div class="h">${ico(block ? 'lock' : 'flag', 's')}${esc(n.title)}</div>
    ${n.desc ? `<div class="d">${esc(n.desc)}</div>` : ''}
    ${n.sides ? `<div class="sides">${n.sides.map(([id, who, tx]) => `<div class="side-op"><div class="who">${av(id, 's')}${who}</div><div>${esc(tx)}</div></div>`).join('')}</div>` : ''}
    ${S.writing === t.id ? `<textarea data-k="write" placeholder="写下你的决定，CC 会把它同时交给执行方和审计会话，作为后续返工的依据…"></textarea>` : ''}
    <div class="acts">${S.writing === t.id
      ? `<button class="btn s you" onclick="needAct('${t.id}','writeok')">发送决定并继续</button><button class="btn s ghost" onclick="S.writing=null;render()">取消</button>`
      : n.actions.map(([k, l, a], i) => `<button class="btn s ${k === 'primary' ? 'you' : k}" onclick="needAct('${t.id}','${a}',${i})">${esc(l)}</button>`).join('')}
      <span class="faint" style="margin-left:auto;font-size:12px;align-self:center">${block ? '其他任务不受影响' : '不选也行：任务会一直停在这里'}</span></div>
  </div>`;
}
function acceptCard(t) {
  const a = t.accept;
  return `<div class="acccard">
    <div style="display:flex;align-items:center;gap:10px"><span class="kind">验收</span><b style="font-size:14px">PR #${t.pr.n} · ${esc(t.title)}</b></div>
    <div class="grid">
      <div><h4>做了什么</h4><ul>${a.did.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>
      <div><h4>验证</h4>${a.verify.map(([s, tx, src]) => `<div class="vrow"><span class="vic ${s}">${ico(s === 'ok' ? 'check' : 'alert', 'xs')}</span>${esc(tx)}<span class="src">${esc(src)}</span></div>`).join('')}
        <h4 style="margin-top:12px">审查</h4>${a.reviews.map(([id, tx, h]) => `<div class="vrow">${av(id, 's')}${esc(tx)}<span class="src mono">@ ${h}</span></div>`).join('')}
        <div class="vrow faint" style="font-size:12px">${ico('check', 'xs')} ${a.reviews.length > 1 ? '两次审查针对同一 HEAD，' : '审查针对的就是 '}PR 当前 HEAD ${a.reviews[0][2]}</div></div>
    </div>
    <div class="hint" style="margin-top:14px">${ico('alert', 's')}<span><b>风险：</b>${esc(a.risk)}</span></div>
    ${S.writing === t.id ? `<textarea data-k="write" style="width:100%;margin-top:12px;border-radius:9px;border:0;padding:10px 12px;background:var(--panel);box-shadow:0 0 0 1px var(--line-2);outline:0;min-height:64px" placeholder="要改什么？会发给 GPT，由它决定交给谁返工…"></textarea>` : ''}
    <div class="acts" style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      ${S.writing === t.id ? `<button class="btn you" onclick="needAct('${t.id}','changes')">发送修改意见</button><button class="btn ghost" onclick="S.writing=null;render()">取消</button>`
        : `<button class="btn you" onclick="needAct('${t.id}','merge')">${ico('merge', 's')}合并 PR #${t.pr.n}</button><button class="btn" onclick="S.writing='${t.id}';render()">要求修改…</button><button class="btn ghost" onclick="toast('（模拟）在浏览器打开 PR #${t.pr.n}')">${ico('ext', 's')}在 GitHub 查看</button>`}
      <span class="faint" style="margin-left:auto;font-size:12px;align-self:center">合并只能由你确认</span>
    </div>
  </div>`;
}
function stageSection(t, s) {
  const st = STAGE[s.id];
  const key = t.id + s.id;
  const evs = t.events.filter((e) => e.stage === s.id);
  const defaultOpen = ['active', 'you', 'block', 'paused'].includes(s.st);
  const open = S.open[key] ?? defaultOpen;
  if (s.st === 'todo' || s.st === 'skip') {
    return `<div class="stsec" id="sec-${key}"><div class="stsec-h" style="cursor:default"><span class="sg ${s.st === 'skip' ? 'off' : 'idle'}"></span><span class="nm faint">${st.name}</span><span class="sm faint">${s.st === 'skip' ? '已跳过 · ' + esc(s.sum) : (s.sum ? esc(s.sum) : '接下来')}</span>${s.team.length ? avs(s.team) : ''}</div></div>`;
  }
  const sg = s.st === 'done' ? 'done' : s.st === 'active' ? (t.state === 'rework' ? 'rework' : t.state === 'paused' ? 'paused' : 'run') : s.st === 'you' ? 'decide' : s.st;
  let special = '';
  if (s.id === 'plan' && t.disc) special = matrix(t.disc);
  if (s.id === 'build' && t.lanes) special = lanes(t);
  return `<div class="stsec ${open ? 'open' : ''}" id="sec-${key}">
    <button class="stsec-h" onclick="S.open['${key}']=${!open};render()">${ico('chev', 's chev')}<span class="sg ${sg}"></span><span class="nm">${st.name}</span>${avs(s.team)}<span class="sm">${esc(s.sum)}</span><span class="dur">${s.dur || ''}</span></button>
    ${open ? `<div style="padding-left:6px">${special}<div class="tl">${evs.map((e) => evRow(t, e)).join('')}</div>
      ${s.st === 'done' ? `<div style="padding:2px 0 0 54px"><button class="lnk" style="font-size:12px" onclick="openDrawer('${t.id}','${s.id === 'build' ? 'diff' : s.id}','sum')">查看完整讨论与证据 →</button></div>` : ''}</div>` : ''}
  </div>`;
}
function evRow(t, e) {
  const tag = { decide: '协调决定', fail: '审计未通过', result: '结果', block: '阻塞', you: '你', sys: '自动' }[e.k] || '';
  let who;
  if (e.k === 'you') who = `<span class="ico you">${ico('hand', 'xs')}</span>`;
  else if (e.k === 'sys') who = `<span class="ico">${ico('rework', 'xs')}</span>`;
  else if (e.k === 'fail') who = `<span class="ico fail">${ico('rework', 'xs')}</span>`;
  else if (e.k === 'block') who = `<span class="ico block">${ico('lock', 'xs')}</span>`;
  else if (e.who.length > 1) who = avs(e.who);
  else who = av(e.who[0], 's');
  const chips = e.chips ? `<div class="chips">${e.chips.map(([k, tx]) => `<span class="chip ${k}">${k === 'ok' ? ico('check', 'xs') : k === 'bad' ? ico('x', 'xs') : ''}${esc(tx)}</span>`).join('')}</div>` : '';
  const more = [
    e.detail ? `<button class="lnk" onclick="openDrawer('${t.id}','${e.detail}','sum')">展开</button>` : '',
    e.brief ? `<button class="lnk" onclick="openDrawer('${t.id}','brief','raw')">委派单</button>` : '',
    e.override ? `<button class="lnk" onclick="toast('（模拟）改派：选择其他参与者后，GPT 会收到你的覆盖指令并继续')">改派…</button>` : '',
  ].filter(Boolean).join('');
  return `<div class="ev ${e.k} ${e._new ? 'new' : ''}"><div class="who">${who}</div><div class="bd">
    <div class="line"><span class="tx">${tag ? `<span class="tag">${tag}</span>` : ''}${esc(e.text)}</span><span class="t">${e.t}</span></div>${chips}${more ? `<div class="more">${more}</div>` : ''}</div></div>`;
}
function matrix(d) {
  const cols = `92px repeat(${d.lanes.length}, minmax(0, 1fr))`;
  const role = (id) => (d.roles && d.roles[id]) || '讨论';
  let h = `<div class="matrix impl-in"${impl('wip', '#18 双 AI 讨论 + 独立审计')}><div class="mx" style="grid-template-columns:${cols}"><div class="hd ph"></div>${d.lanes.map((id) => `<div class="hd">${av(id, 's')}${R[id].name}<span class="faint" style="font-weight:400">${role(id)}</span></div>`).join('')}`;
  d.phases.forEach((p, i) => {
    const row = d.cells[i] || {};
    h += `<div class="ph">${p}</div>`;
    d.lanes.forEach((id) => {
      const c = row[id];
      const involved = !d.involve || d.involve[i].includes(id);
      if (!involved) h += '<div class="cell empty">—</div>';
      else if (!c) h += '<div class="cell wait">等待</div>';
      else if (c[0] === 'run') h += `<div class="cell run"><span class="sg run"></span>${i === 0 ? '独立思考中，看不到对方' : '思考中'}<span class="shimmer" style="flex:1"></span></div>`;
      else if (c[0] === 'block') h += `<div class="cell block">${ico('lock', 'xs')}${esc(c[1])}</div>`;
      else h += `<div class="cell">${esc(c[1])}</div>`;
    });
  });
  return h + '</div></div>';
}
function lanes(t) {
  return `<div class="lanes">${t.lanes.map((l) => `<div class="lane"><span class="n">${l.n}</span><div><div class="tt">${esc(l.title)}</div><div class="m">${esc(l.meta)} · 思考深度 ${l.depth}</div>${l.st === 'run' ? '<div class="prog"></div>' : ''}</div>
    <span style="display:flex;align-items:center;gap:8px">${av(l.who, 's')}<span class="faint" style="font-size:12px">${R[l.who].name}</span></span>${l.st === 'done' ? pill('done', '完成') : pill('run', '开发中')}</div>`).join('')}</div>`;
}

/* 讨论（想需求）专用 */
function discRail(t) {
  const d = t.disc;
  const phases = [...d.phases, '汇总'];
  const at = t.result ? phases.length : (d.cells.length ? d.cells.length - 1 : 0);
  return `<div class="rail"><div class="lead">${ico('spark', 's')}<span><b>想需求</b> /grill</span></div>${phases.map((p, i) => {
    const cls = i < at || t.result ? 'done' : i === at && !t.result ? 'active' : 'todo';
    return `<div class="st ${cls}"><div class="bar"></div><div class="nm">${p}</div><div class="ds">${cls === 'done' ? ico('check', 'xs') + '完成' : cls === 'active' ? '进行中' : ''}</div></div>`;
  }).join('')}</div>`;
}
function discBody(t) {
  let h = matrix(t.disc);
  if (t.result) {
    const r = t.result;
    h += `<div class="dresult"${impl('plan', '汇总报告由 #18 提供')}>
      <div class="blk"><h4>结论 · ${r.agree.length}</h4>${r.agree.map(([tx, who, ev], i) => `<div class="agree"><span class="n">${i + 1}</span><span>${esc(tx)}</span><span class="r">${avs(who)}<span class="chip claim" title="依据类型">${ev}</span></span></div>`).join('')}</div>
      <div class="blk"><h4>仍有分歧 · 1</h4><div style="font-weight:600;margin-bottom:8px">${esc(r.split.q)}</div><div class="sides" style="margin-top:0">${r.split.sides.map(([id, tx]) => `<div class="side-op" style="box-shadow:inset 0 0 0 1px var(--line)"><div class="who">${av(id, 's')}${R[id].name}</div>${esc(tx)}</div>`).join('')}</div></div>
      <div class="blk"><h4>待补证据</h4>${r.gaps.map((g) => `<div style="display:flex;gap:8px;align-items:center">${ico('search', 's')}${esc(g)}</div>`).join('')}</div>
      <div class="blk"><h4>建议下一步</h4>${esc(r.next)}</div>
      <div class="acts">
        <button class="btn primary" onclick="toPlan('${t.id}')">转入定方案 ${ico('arrow', 's')}</button>
        <button class="btn" onclick="document.querySelector('[data-k=dock]')?.focus()">继续追问</button>
        <button class="btn ghost" onclick="toast('讨论已保存，可在侧栏“讨论”里找到')">结束并保存</button>
        <span class="faint" style="margin-left:auto;font-size:12px">“同意”是 AI 的声明，不等于事实已验证</span>
      </div>
    </div>`;
  }
  const extra = t.events.filter((e) => e.stage === 'follow');
  if (extra.length) h += `<div class="tl" style="margin-top:14px">${extra.map((e) => evRow(t, e)).join('')}</div>`;
  return h;
}
function dockComposer(t) {
  const disc = t.kind === 'discussion';
  const to = disc ? 'GPT 和 Argon' : 'CC（协调）';
  return `<div class="composer dock"${impl('plan', '插话 · 打断')}>
    <textarea data-k="dock" rows="1" placeholder="对 ${to} 说…  插话会在下一步生效" oninput="S.dock=this.value" onkeydown="if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();sendDock('${t.id}',false)}">${esc(S.dock)}</textarea>
    <div class="crow" style="margin-top:2px"><button class="sel">${ico('send', 's')}发给：${to}${ico('chevd', 'xs')}</button><span class="sp"></span>
      <button class="btn s ghost" onclick="sendDock('${t.id}',true)" title="先停止正在生成的回复再发送">打断并发送</button>
      <button class="btn s primary" onclick="sendDock('${t.id}',false)">插话 <span class="faint" style="color:inherit;opacity:.6">Ctrl ↵</span></button></div>
  </div>`;
}
function facts(t) {
  const roles = ROLE[t.id] || {};
  const members = [...new Set(t.team)];
  const rv = t.review;
  return `<aside class="facts"${impl('plan')}>
    ${t.repo ? `<div class="fsec"><h5>交付</h5>
      <div class="frow">${ico('issue', 's')}<span class="k">Issue #${t.issue}</span><span class="v">打开</span></div>
      ${t.pr ? `<div class="frow">${ico('branch', 's')}<span class="k mono">feat/${t.issue}-…</span></div>
      <div class="frow">${ico('pr', 's')}<span class="k">PR #${t.pr.n}</span>${prChip(t)}</div>
      <div class="frow">${ico('flask', 's')}<span class="k">CI</span>${ciChip(t.ci) || '<span class="v">—</span>'}</div>` : '<div class="frow faint">尚未创建分支与 PR</div>'}
      ${rv ? `<div class="frow">${ico('eye', 's')}<span class="k">${esc(rv.text)}</span>${rv.st === 'ok' ? '<span class="chip ok">通过</span>' : '<span class="chip bad">未通过</span>'}</div>` : ''}
      <div class="faint" style="font-size:11.5px;margin-top:6px">PR、CI、审查状态由 ai-one 从 GitHub 回读，不采用 AI 自述。</div>
    </div>` : ''}
    <div class="fsec"><h5>团队<span class="sp"></span><span style="font-weight:400">点击查看网页或终端</span></h5>
      ${members.map((id) => {
        const [role, st] = roles[id] || ['参与', R[id].now];
        const sc = /返工|开发中|审计中/.test(st) ? 'run' : /失效|阻塞/.test(st) ? 'block' : /等你|接管/.test(st) ? 'you' : /完成|通过/.test(st) ? 'done' : 'idle';
        return `<div class="member" onclick="openWeb('${id}')">${av(id, 'l')}<div class="nm">${R[id].name}<span class="rl">${esc(role)}</span></div><div class="stt"><span class="sg ${sc}" style="width:10px;height:10px"></span>${esc(st)}</div></div>`;
      }).join('')}
    </div>
    ${t.repo ? `<div class="fsec impl-in"${impl('ext', 'ai-one 内接线规划')}><h5>派工通道</h5><div class="frow">${ico('fwd', 's')}<span class="k">${BRIDGE.name} → ChatGPT</span><span class="chip ok">${ico('check', 'xs')}可用</span></div><div class="faint" style="font-size:11.5px">执行会话 A · 审计会话 B · request_id 保存在本机，超时先恢复再决定是否重发</div></div>` : ''}
    ${t.lead === 'cc' ? `<div class="fsec"><h5>协调简报<span class="sp"></span><button class="lnk" style="font-weight:400" onclick="S.flow.sel='lead';go('flows')">编辑</button></h5><div class="brief">“${esc(FLOW_LIB[0].brief)}”</div></div>` : ''}
    ${t.rules?.length ? `<div class="fsec"><h5>规则</h5><ul class="rules">${t.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
    <div class="fsec"><h5>消耗<span class="sp"></span><span class="qtype">估算</span></h5><div class="faint" style="font-size:12px">${members.map((id) => `${R[id].name} ${R[id].kind === 'agent' ? Math.round(id.length * 4.5) + ' 分钟' : id.length * 3 + ' 条'}`).join(' · ')}</div></div>
  </aside>`;
}

/* 网页 / 终端视图（模拟原生图层） */
function webView(t) {
  const id = S.web.pid;
  const r = R[id];
  const agent = r.kind === 'agent';
  const take = S.web.take;
  const bar = take
    ? `<div class="webbar takeover"${impl('plan', '接管与交还')}>${ico('hand', 's')}<b>你已接管 ${r.name}</b><span class="muted">任务已暂停在当前步骤，其他参与者正在生成的回复会完整收下。</span><span class="sp"></span>
        <button class="btn s you" onclick="giveBack(true)">交还：采用网页里的最新回复</button><button class="btn s" onclick="giveBack(false)">交还：忽略我的操作</button></div>`
    : `<div class="webbar"${impl('done', '单网页切换（上游）')}><button class="btn s ghost" onclick="S.web=null;render()">${ico('chev', 's')}<span style="transform:scaleX(-1)"></span>返回汇报</button>${av(id, 's')}<b>${r.full}${agent ? ' · 终端' : ' · 网页'}</b><span class="muted">${t ? '只是查看，任务在后台继续' : ''}</span><span class="sp"></span>
        ${r.login !== 'ok' ? '' : agent ? `<button class="btn s" onclick="toast('（模拟）在 Windows Terminal 中打开该 worktree')">${ico('ext', 's')}在外部终端打开</button>` : ''}
        ${t ? `<button class="btn s you" onclick="takeOver()">${ico('hand', 's')}接管</button>` : ''}</div>`;
  let page;
  if (r.login === 'expired') page = `<div class="wp login"><div class="bx"><div style="font-size:20px;font-weight:600;margin-bottom:6px">登录 Google</div><div style="color:#777;margin-bottom:18px">（这里是 Gemini 的原生登录页，由你自己完成）</div><button class="btn primary" onclick="relogin('${id}')">模拟：我已完成登录</button></div></div>`;
  else if (agent) page = `<div class="wp" style="font-family:var(--mono);font-size:12.5px;line-height:1.75;max-width:none;padding:24px 28px;background:#0F0F0E;color:#D6D3CB;min-height:100%">
      <div style="color:#8D8A82">D:\\wt\\${t?.repo || 'ai-one'}-${t?.issue || 42} (feat/${t?.issue || 42}-home-needs-you)</div>
      ${id === 'cc' ? `<div style="color:#78A6FF">● CC：审计会话返回 REVISE（2 个问题），转给执行会话 A</div>
      <div>$ prodex ask --continue-task &lt;执行会话&gt; "按审计意见返工，推送后报告完整 HEAD"</div>
      <div style="color:#8D8A82">  request_id 已保存 · 等待回复…</div>
      <div>$ gh pr view 43 --json headRefOid</div>
      <div style="color:#8D8A82">  （推送后 CC 回读 HEAD，再本机运行 pnpm verify）</div>`
        : `<div>$ codex --resume ${t?.repo || 'ai-one'}:${t?.issue || 42}</div>
      <div style="color:#78A6FF">● 实现子任务 ①</div>
      <div>$ pnpm vitest run</div>
      <div style="color:#62D196">✓ 38 passed</div>`}
      <div style="color:#8D8A82">▍</div></div>`;
  else page = `<div class="wp"><div class="u">【经 Prodex · CC 派工】你是 ai-one#42 的 Reviewer（独立会话，不带执行上下文）。先读 Issue 验收、PR #43 当前 Diff 与 HEAD a1c93e0、CI，给出 PASS / REVISE / BLOCKED 与证据；评论以所审完整 HEAD 开头。</div>
      <div class="a">REVISE。\n\n1. NeedsYouSection.tsx 第 41 行：items 为空时 count 取了 fallback 1，空列表会显示“1 件事等你”。\n2. 按仓库筛选没有测试覆盖。\n\n其余实现与现有组件风格一致。修正后请推送新提交，我会针对新 HEAD 重新审查，不沿用本次结论。</div>
      <div class="inp">${take ? '你可以在这里直接输入…' : '询问任何问题'}</div></div>`;
  return `<div class="ws-main" style="flex:1">${bar}<div class="webpage">${page}<span class="layer">模拟 · 原生 WebView 图层，ai-one 不在网页上覆盖任何控件</span></div></div>`;
}

/* ================= 聊天 ================= */
function chatView() {
  const c = S.chat;
  const conv = CHAT_SEED.convos.find((x) => x.id === c.conv);
  const tabs = [['cmp', '对比', null], ...['gpt', 'argon', 'opus', 'grok'].map((id) => [id, R[id].name, id])];
  return `<div class="chat">
    <div class="convos"${impl('done', '上游会话列表')}>
      <button class="newbtn" style="width:100%;margin-top:0" onclick="toast('新对话：选择 AI 后直接输入')">${ico('plus')}新对话</button>
      ${CHAT_SEED.convos.map((x) => `<button class="convo ${x.id === c.conv ? 'on' : ''}" onclick="S.chat.conv='${x.id}';render()"><div class="tt">${esc(x.title)}</div><div class="mt">${avs(x.who)}<span>${x.mode}</span><span style="margin-left:auto">${x.t}</span></div></button>`).join('')}
    </div>
    <div class="chat-main">
      <div class="chat-head"><h2>${esc(conv.title)}</h2>
        <span class="chip">模式：${c.mode}</span>
        <button class="btn s" onclick="chatToTask()">${ico('arrow', 's')}转为任务…</button>
        <span style="position:relative"><button class="btn s icon" onclick="toggle('menu','chat')">${ico('more', 's')}</button>${S.menu === 'chat' ? `<div class="menu" style="right:0;top:32px"><button onclick="S.menu=null;toast('（已实现）回放：重新运行上一次快照')">${ico('rework', 's')}回放记录<span class="d">已实现</span></button><button onclick="S.menu=null;toast('（已实现）导出 Markdown')">${ico('doc', 's')}导出 .md<span class="d">已实现</span></button><button onclick="S.menu=null;toast('（规划）交接到新会话')">${ico('handoff', 's')}交接到新会话<span class="d">规划</span></button></div>` : ''}</span>
      </div>
      <div class="tabs impl-in"${impl('done', '网页切换 · “转为任务”为规划')}>${tabs.map(([k, l, id]) => `<button class="tab ${c.tab === k ? 'on' : ''}" onclick="S.chat.tab='${k}';render()">${id ? av(id, 's') : ico('layers', 's')}${l}${id ? `<span class="d" style="background:${R[id].login === 'ok' ? 'var(--done)' : R[id].login === 'expired' ? 'var(--block)' : 'var(--ink-3)'}"></span>` : ''}</button>`).join('')}
        <button class="tab" onclick="toast('（已实现）连接更多 AI：Meta 等')">${ico('plus', 's')}</button></div>
      ${c.tab === 'cmp' ? compareView() : webChatView(c.tab)}
      ${chatComposer()}
    </div>
  </div>`;
}
function compareView() {
  const c = S.chat;
  const targets = c.targets;
  return `<div class="scroll" data-k="cmp"><div class="cmp">
    <div class="faint" style="font-size:12px;text-align:center;margin-bottom:12px">更早 2 轮 · <button class="lnk">展开</button></div>
    <div class="uq">${esc(c.q)}</div>
    <div class="replies"${impl('part', '消息聚合已有，并排对比为新形态')}>${targets.map((id) => replyCard(id)).join('')}</div>
  </div></div>`;
}
function replyCard(id) {
  const r = R[id];
  const rp = S.chat.replies[id] || { pending: true };
  const err = r.login !== 'ok' ? '登录已失效，消息未发送' : rp.err && r.login !== 'ok' ? rp.err : null;
  const full = S.chat.full[id];
  if (err) return `<div class="reply err"><div class="rh">${av(id, 's')}<span class="nm">${r.name}</span><span class="faint">${r.models[0]}</span></div><div class="rb full">${err}</div><div class="rf"><button class="btn s" onclick="relogin('${id}')">打开网页登录</button><button class="btn s ghost" onclick="toast('登录后会自动重发这条消息')">登录后重发</button></div></div>`;
  if (rp.pending) return `<div class="reply"><div class="rh">${av(id, 's')}<span class="nm">${r.name}</span><span class="sg run"></span><span class="faint">生成中</span></div><div class="rb full"><span class="shimmer"></span><span class="shimmer" style="width:80%"></span><span class="shimmer" style="width:60%"></span></div></div>`;
  return `<div class="reply"><div class="rh">${av(id, 's')}<span class="nm">${r.name}</span><span class="faint">${rp.model} · ${rp.t}</span><span style="margin-left:auto" class="faint">${rp.text.length} 字</span></div>
    <div class="rb ${full ? 'full' : ''}">${esc(rp.text)}</div>
    <div class="rf"><button class="btn s ghost" onclick="S.chat.full['${id}']=${!full};render()">${full ? '收起' : '展开全文'}</button>
      <span style="position:relative"><button class="btn s ghost"${impl('plan')} onclick="S.chat.fwd=S.chat.fwd==='${id}'?null:'${id}';render()">${ico('fwd', 's')}转发给…</button>${S.chat.fwd === id ? `<div class="menu" style="left:0;bottom:30px">${Object.keys(R).filter((x) => x !== id && R[x].kind === 'web').map((x) => `<button onclick="forward('${id}','${x}')">${av(x, 's')}${R[x].name}${R[x].login !== 'ok' ? '<span class="d">未登录</span>' : ''}</button>`).join('')}<hr><button onclick="forward('${id}','all')">${ico('users', 's')}其他所有人</button></div>` : ''}</span>
      <button class="btn s ghost" onclick="S.chat.text='> ${r.name}：'+S.chat.replies['${id}'].text.slice(0,40)+'…\\n';render()">${ico('quote', 's')}引用</button>
      <button class="btn s ghost" onclick="S.chat.tab='${id}';render()">${ico('eye', 's')}在网页中查看</button></div></div>`;
}
function webChatView(id) {
  const r = R[id];
  if (r.login === 'none') return `<div class="scroll"><div class="page" style="text-align:center;padding-top:80px"><div style="font-size:15px;font-weight:600">${r.full} 还没有登录</div><div class="muted" style="margin:6px 0 16px">在原生网页里登录一次即可，ai-one 不保存密码。</div><button class="btn primary" onclick="relogin('${id}')">打开网页登录</button></div></div>`;
  const saved = S.web;
  S.web = { pid: id, take: false };
  const html = webView(null).replace('<div class="ws-main" style="flex:1">', '<div class="ws-main" style="flex:1;min-height:0">');
  S.web = saved;
  return html;
}
function chatComposer() {
  const c = S.chat;
  return `<div class="composer dock" style="margin-top:10px">
    <textarea data-k="chat" rows="2" placeholder="发给选中的 AI… 输入 / 可以直接开始一个阶段" oninput="S.chat.text=this.value" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();chatSend()}">${esc(c.text)}</textarea>
    <div class="crow"><div class="targets"${impl('done', '多选发送')}>${['gpt', 'argon', 'opus', 'grok', 'codex'].map((id) => `<button class="tgt ${c.targets.includes(id) ? 'on' : ''} ${R[id].login !== 'ok' ? 'na' : ''}" onclick="toggleTarget('${id}')">${av(id, 's')}${R[id].name}</button>`).join('')}</div>
      <span class="sp"></span>
      <span style="position:relative"><button class="sel boxed"${impl('done')} onclick="toggle('menu','mode')">${ico('flow', 's')}${c.mode}${ico('chevd', 'xs')}</button>${S.menu === 'mode' ? `<div class="menu" style="right:0;bottom:34px;width:300px">${[['自由', '各自回答，并排比较', 'done'], ['辩论', '正反方 + 裁判 + 总结', 'done'], ['咨询', '两方作答，审阅后合成', 'done'], ['双 AI 讨论', '独立作答 → 互相质疑 → 第三方审计', 'wip'], ['Coding', '计划、审查、编写、测试', 'done'], ['圆桌', '多轮慢速讨论', 'done'], ['脑暴', '12 轮 48 次发言', 'done']].map(([m, d, lv]) => `<button onclick="S.chat.mode='${m}';S.menu=null;render()"><span style="width:84px">${m}</span><span class="faint" style="font-size:12px">${d}</span><span class="d"><span class="tag-i ${lv}">${IMPL_LABEL[lv]}</span></span></button>`).join('')}</div>` : ''}</span>
      <button class="btn s icon ghost" title="附件">${ico('attach', 's')}</button>
      <button class="btn s primary" onclick="chatSend()">${ico('send', 's')}发送</button></div>
  </div>`;
}

/* ================= 阶段与流程 ================= */
function flowsView() {
  const sel = S.flow.sel;
  const flow = FLOW_LIB.find((f) => f.id === sel);
  const stage = STAGE[sel];
  return `<div class="flows">
    <div class="flist">
      <div class="sidesec" style="margin-top:2px">流程</div>
      ${FLOW_LIB.map((f) => `<button class="fitem ${sel === f.id ? 'on' : ''}" style="${f.future ? 'opacity:.6' : ''}" onclick="S.flow.sel='${f.id}';S.flow.pop=null;render()">${ico(f.kind === 'conductor' ? 'users' : 'flow', 's')}<span class="nm">${f.name}</span><span class="mt">${f.future ? '远期' : f.uses + ' 次'}</span></button>`).join('')}
      <div class="sidesec">阶段</div>
      ${STAGE_LIB.map((s) => `<button class="fitem ${sel === s.id ? 'on' : ''}" onclick="S.flow.sel='${s.id}';S.flow.pop=null;render()">${ico('spark', 's')}<span class="nm">${s.name}</span><span class="mt mono">${s.cmd}</span></button>`).join('')}
      <div class="hint" style="margin:14px 4px 0;font-size:12px">${ico('layers', 's')}<span>阶段是可复用的工作单元；流程是阶段的有序组合；协调是让 CC 根据结果动态挑选阶段。三种方式都由 CC 经 Prodex 派工。</span></div>
    </div>
    <div class="fedit scroll" data-k="flow">${flow ? (flow.kind === 'conductor' ? conductorEditor(flow) : flowEditor(flow)) : stageEditor(stage)}</div>
  </div>`;
}
function flowEditor(f) {
  const opusUses = f.stages.reduce((n, s) => n + s.team.filter((m) => m[0] === 'opus').length, 0);
  return `<div class="impl-left"${impl('plan', '阶段组合')}>
    <div class="fhead"><div style="flex:1"><h2>${f.name}</h2><div class="muted" style="margin-top:4px">${f.desc}</div></div>
      <button class="btn" onclick="toast('（模拟）已另存为新流程')">另存为…</button><button class="btn primary" onclick="S.comp.mode='flow';S.comp.flow='${f.id}';go('home')">${ico('play', 's')}用它开始</button></div>
    <div class="crow" style="margin-top:14px"><span class="faint">推进方式</span><div class="seg"><button class="on">按顺序推进</button><button onclick="S.flow.sel='lead';render()">交给 CC 动态决定</button></div>
      <span class="toggle on"><i></i>合并前需要我验收（始终开启）</span></div>
    <div class="stagecards">${f.stages.map((s, i) => stageCard(f, s, i)).join('')}</div>
    <div style="margin:14px 0 0 34px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn s" onclick="toast('（模拟）选择要加入的阶段')">${ico('plus', 's')}添加阶段</button>
      <button class="btn s"${impl('plan', '嵌套流程')} onclick="toast('规划：把一个已保存的流程作为一个阶段插入（例如“完整开发”里嵌“快速开发”）')">${ico('layers', 's')}插入已保存的流程</button>
    </div>
    ${opusUses ? `<div class="hint">${ico('gauge', 's')}<span style="flex:1">这个流程会用到 Opus ${opusUses} 次。Opus 目前<b>接近 5 小时上限</b>（网页提示，16:00 重置）。</span><button class="btn s" onclick="toast('（模拟）终审改为 GPT · 深度；Opus 只保留设计')">终审改用 GPT</button></div>` : ''}
  </div>`;
}
function stageCard(f, s, i) {
  const st = STAGE[s.s];
  return `<div class="sc" data-n="${i + 1}">
    <div class="sch">${ico('grip', 's')}<span class="nm">${st.name}</span><span class="mono faint">${st.cmd}</span><span class="sp" style="flex:1"></span>
      <div class="seg">${['单人', '讨论', '主写 + 审计', '并行执行'].map((p) => `<button class="${s.pattern === p ? 'on' : ''}">${p}</button>`).join('')}</div></div>
    <div class="scb">
      <span class="k">参与者</span><div class="memwrap" style="position:relative">${s.team.map((m, j) => `<button class="mem" onclick="S.flow.pop=S.flow.pop==='${i}:${j}'?null:'${i}:${j}';render()">${av(m[0], 's')}${R[m[0]].name}<span class="rl">${m[1]}</span><span class="dp">${m[2]}</span></button>`).join('')}<button class="mem add" onclick="toast('（模拟）添加参与者：任何网页 AI 或本地 Agent')">${ico('plus', 's')}</button>${S.flow.pop?.startsWith(i + ':') ? memPop(s.team[+S.flow.pop.split(':')[1]]) : ''}</div>
      <span class="k">结束条件</span><div>${esc(s.exit)}${s.fail ? ` <span class="faint">· 超限时：${esc(s.fail)}</span>` : ''}</div>
      <span class="k">选项</span><div style="display:flex;gap:16px;flex-wrap:wrap"><span class="toggle ${s.skip ? 'on' : ''}"><i></i>CC 可跳过</span><span class="toggle ${s.confirm ? 'on' : ''}"><i></i>完成后先给我看</span></div>
    </div>
  </div>`;
}
function memPop(m) {
  const r = R[m[0]];
  return `<div class="pop" style="left:0;top:36px">
    <div style="display:flex;align-items:center;gap:8px">${av(m[0], 'l')}<div><b>${r.full}</b><div class="faint" style="font-size:12px">${r.kind === 'agent' ? '本地 Agent' : '网页 Chat'} · ${r.cost}</div></div></div>
    <div class="row"><span class="k">角色</span><div class="seg">${['讨论', '执行', '审计', '终审'].map((x) => `<button class="${m[1].startsWith(x) ? 'on' : ''}">${x}</button>`).join('')}</div></div>
    <div class="row"><span class="k">模型</span><div class="seg">${r.models.map((x, i) => `<button class="${i === 0 ? 'on' : ''}">${x}</button>`).join('')}</div></div>
    <div class="row"><span class="k">思考</span><div class="seg">${['快速', '标准', '深度'].map((x) => `<button class="${m[2] === x ? 'on' : ''}">${x}</button>`).join('')}</div></div>
    <div class="row"><span class="k">额度</span>${quota(r)}</div>
    <div style="display:flex;justify-content:space-between;margin-top:12px"><button class="btn s ghost" style="color:var(--block)">移除</button><button class="btn s" onclick="S.flow.pop=null;render()">完成</button></div>
  </div>`;
}
function conductorEditor(f) {
  if (f.future) {
    return `<div class="impl-left"${impl('plan', '远期可选')}>
    <div class="fhead"><div style="flex:1"><h2>${f.name} <span class="pill ghost">远期 · 未启用</span></h2><div class="muted" style="margin-top:4px">${f.desc}</div></div></div>
    <div class="hint">${ico('alert', 's')}<span>当前产品方向（Spec #32 v1）：近期由 CC 担任唯一实际使用的协调者，不另造默认调度 Agent。网页 AI 担任协调者需要 Chat → ai-one → 本地 CC/Agent 的反向派工，排在 CC + Prodex 闭环做好之后。</span></div>
    <div style="margin-top:14px"><button class="btn" onclick="S.flow.sel='lead';render()">${ico('arrow', 's')}查看当前的 CC 协调设置</button></div>
  </div>`;
  }
  const brief = S.flow.brief ?? f.brief;
  return `<div class="impl-left"${impl('ext', '链路在工作台外已验证，界面为规划')}>
    <div class="fhead"><div style="flex:1"><h2>${f.name}</h2><div class="muted" style="margin-top:4px">${f.desc}</div></div>
      <button class="btn primary" onclick="S.comp.mode='lead';go('home')">${ico('play', 's')}用它开始</button></div>
    <div class="sec-h"><h3>协调者</h3></div>
    <div class="memwrap"><button class="mem">${av('cc', 's')}Claude Code<span class="rl">协调 · 架构 · 前端 · 收尾</span><span class="dp">Opus · 本机</span></button><span class="faint" style="align-self:center;font-size:12px">近期唯一实际使用的协调者（#32）。网页 AI 担任协调者是远期可选。</span></div>
    <div class="sec-h"><h3>派工通道</h3><span class="cnt">${BRIDGE.desc}</span></div>
    <div class="card" style="padding:12px 16px;display:grid;grid-template-columns:auto 1fr auto;gap:4px 12px;align-items:center">
      <span class="av l" style="--c:#3B3A36">Px</span><div><b>${BRIDGE.name} → ChatGPT</b><div class="faint" style="font-size:12px">${BRIDGE.text} · ${BRIDGE.src}</div></div><span class="chip ok">${ico('check', 'xs')}可用</span>
      <span></span><div style="grid-column:2/4;font-size:12.5px;color:var(--ink-2)"><span class="tag-i done" style="margin-right:6px">外部已验证</span>${BRIDGE.proof}<br><span class="tag-i plan" style="margin-right:6px">规划</span>${BRIDGE.gap}</div>
    </div>
    <div class="sec-h"><h3>协调简报</h3><span class="cnt">你的原话，CC 每次派工都会遵守</span></div>
    <textarea style="width:100%;min-height:86px;border:0;border-radius:12px;padding:12px 14px;background:var(--card);box-shadow:0 0 0 1px var(--line-2);outline:0;line-height:1.6" oninput="S.flow.brief=this.value">${esc(brief)}</textarea>
    <div class="sec-h"><h3>可派工的资源</h3><span class="cnt">CC 能看到它们的状态、额度和你的标注</span></div>
    <div class="memwrap">${['gpt', 'argon', 'opus', 'codex', 'grok'].map((id) => `<button class="mem" style="${R[id].login !== 'ok' ? 'opacity:.55' : ''}">${av(id, 's')}${R[id].name}<span class="rl">${R[id].tags.slice(0, 2).join(' · ')}</span><span class="dp">${R[id].login === 'ok' ? R[id].cost : R[id].login === 'expired' ? '登录失效' : '未登录'}</span></button>`).join('')}</div>
    <div class="sec-h"><h3>边界</h3><span class="cnt">CC 不能越过这些规则</span></div>
    <div class="card" style="padding:6px 16px">
      ${[['可以自行跳过或重复阶段', true], ['执行和审计使用不同会话，审计会话不带执行上下文', true], ['审计不通过自动返工，最多 3 轮；之后停下来问我', true], ['稀缺资源（Opus 网页）只用于把关、终审、裁决', true], ['Prodex 请求结果不明时先用 request_id 恢复，不重复派工或重复写 GitHub', true, true], ['审计结论必须针对当前完整 HEAD，HEAD 变了就重审', true, true], ['合并 PR、关闭 Issue 只能由我确认', true, true]].map(([l, on, lock]) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line)"><span style="flex:1">${l}</span>${lock ? `<span class="faint" style="font-size:12px;display:inline-flex;gap:4px;align-items:center">${ico('lock', 'xs')}固定</span>` : ''}<span class="toggle ${on ? 'on' : ''}"><i></i></span></div>`).join('').replace('border-top:1px solid var(--line)', '')}
    </div>
    <div class="hint">${ico('spark', 's')}<span>CC 按《协作协议 v0.2》模板 B 拼出派工首条消息，经 Prodex 发给 ChatGPT。ai-one 要做的是把这条已经在用的链路<b>看得见</b>：派工回执、会话、GitHub 回读的 HEAD / CI / 审查、CC 的本机验证、需要你的事。程序自动解析 REVISE 并派工是之后的事。</span></div>
  </div>`;
}
function stageEditor(s) {
  return `<div class="impl-left"${impl('plan', '阶段定义')}>
    <div class="fhead"><div style="flex:1"><h2>${s.name} <span class="mono faint" style="font-size:14px;font-weight:400">${s.cmd}</span></h2><div class="muted" style="margin-top:4px">${s.desc}</div></div>
      <button class="btn primary" onclick="S.comp.mode='stage';S.comp.stage='${s.id}';go('home')">${ico('play', 's')}直接启动</button></div>
    <div class="stagecards"><div class="sc" data-n="·">
      <div class="scb" style="padding-top:14px">
        <span class="k">协作方式</span><div class="seg">${['单人', '讨论', '主写 + 审计', '并行执行'].map((p) => `<button class="${s.pattern === p ? 'on' : ''}">${p}</button>`).join('')}</div>
        <span class="k">默认团队</span><div class="memwrap">${s.team.map(([id, role]) => `<button class="mem">${av(id, 's')}${R[id].name}<span class="rl">${role}</span></button>`).join('')}<button class="mem add">${ico('plus', 's')}</button></div>
        <span class="k">产出</span><div>${s.out}</div>
        ${s.id === 'grill' ? `<span class="k">讨论规则</span><div>先独立思考（互相看不到）→ 交换完整回复 → 可选第三方审计 → 最多 3 轮 → 必出汇总</div><span class="k">引擎</span><div><span class="tag-i wip">开发中</span> 复用 #18 / PR #19 的双 AI 讨论 + 独立审计</div>` : ''}
        <span class="k">提示词</span><div><button class="lnk" onclick="toast('高级：查看与编辑注入给参与者的阶段提示词')">查看模板（高级）</button></div>
      </div></div></div>
    <div class="hint">${ico('layers', 's')}<span>这里改的是默认值。每次启动时团队都能临时调整，不会改动这里。</span></div>
  </div>`;
}

/* ================= 资源 ================= */
function resView() {
  const card = (id) => {
    const r = R[id];
    return `<div class="rcard">${av(id, 'xl')}
      <div><div class="nm">${r.full}${loginPill(r)}</div><div class="pl">${r.kind === 'agent' ? '本地 Agent' : '网页 Chat'} · ${r.plan} · ${r.cost}</div><div class="now2" style="margin-top:6px">${esc(r.now)}${r.queue ? `<div class="faint" style="font-size:12px">排队：${esc(r.queue)}</div>` : ''}</div></div>
      <div${impl('plan', '额度')}>${quota(r, true)}</div>
      <div class="tags">${r.tags.map((t) => `<span>${t}</span>`).join('')}<span style="background:none;color:var(--ink-3)">你的标注</span></div>
      <div style="display:flex;flex-direction:column;gap:6px">${r.login !== 'ok' ? `<button class="btn s you" onclick="relogin('${id}')">${r.login === 'expired' ? '重新登录' : '登录'}</button>` : `<button class="btn s" onclick="${r.kind === 'agent' ? "toast('（模拟）打开终端')" : `S.chat.tab='${id}';go('chat')`}">${r.kind === 'agent' ? '查看终端' : '打开网页'}</button>`}</div>
    </div>`;
  };
  return `<div class="scroll" data-k="res"><div class="page">
    <div class="hello"${impl('plan')}><div><h1>资源</h1><div class="sub">每个 AI 现在在做什么、还能用多少。只展示能确认的信息，不编造剩余额度。</div></div></div>
    <div class="legend4">
      <div><b><span class="qbar" style="width:40px"><b style="width:60%"></b></span>已知</b>工具直接给出的用量（如 CLI 的用量命令）</div>
      <div><b><span class="qdot warn"></span>网页提示</b>只转述网页上出现的文字，例如“接近上限”</div>
      <div><b><span class="qbar est" style="width:40px"><b style="width:60%"></b></span>估算</b>按使用量推算，带“~”，可能不准</div>
      <div><b><span class="qbar unk" style="width:40px"></span>未知</b>没有任何可靠来源</div>
    </div>
    <div class="sec-h"${impl('plan')}><h3>协调者与本地 Agent</h3><span class="cnt">在本机运行，由你授权；CC 是近期唯一的协调者</span></div>
    <div class="rgrid">${['cc', 'codex'].map(card).join('')}</div>
    <div class="sec-h"${impl('ext', 'ai-one 内显示为规划')}><h3>派工通道</h3><span class="cnt">CC 经它给 ChatGPT 派工</span></div>
    <div class="rcard"><span class="av xl" style="--c:#3B3A36">Px</span>
      <div><div class="nm">${BRIDGE.name}<span class="pill done" style="height:20px;font-size:11px">可用</span></div><div class="pl">${BRIDGE.desc}</div></div>
      <div class="qbig"><div class="t"><span class="qdot"></span>${BRIDGE.text}</div><div class="s">${BRIDGE.src}</div></div>
      <div style="font-size:12px;color:var(--ink-2)">${BRIDGE.proof}<div class="faint" style="margin-top:4px">${BRIDGE.gap}</div></div>
      <div><button class="btn s" onclick="toast('（模拟）运行 prodex pro browser check')">检查</button></div>
    </div>
    <div class="sec-h"${impl('done', '登录与连接状态')}><h3>网页 Chat</h3><span class="cnt">在 ai-one 内的原生网页中登录，ai-one 不保存密码</span></div>
    <div class="rgrid">${['gpt', 'argon', 'opus', 'grok'].map(card).join('')}</div>
    <div class="sec-h"${impl('plan')}><h3>派工偏好</h3><span class="cnt">给 CC 和流程的建议，不是写死的规则</span></div>
    <div class="card" style="padding:6px 16px">
      ${[['优先使用订阅内或免费的资源', true], ['某个 AI 接近上限时，自动改派并通知我', true], ['登录失效时，不自动换人，先问我', true], ['同时运行的本地 Agent 最多 2 个', true]].map(([l, on], i) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;${i ? 'border-top:1px solid var(--line)' : ''}"><span style="flex:1">${l}</span><span class="toggle ${on ? 'on' : ''}" onclick="this.classList.toggle('on')"><i></i></span></div>`).join('')}
    </div>
  </div></div>`;
}

/* ================= 浮层 ================= */
const DRAWER_TABS = [['sum', '摘要', 'doc'], ['disc', '讨论', 'users'], ['raw', '原始记录', 'layers'], ['code', '代码', 'code'], ['test', '测试', 'flask']];
function drawer() {
  const d = S.drawer;
  const t = task(d.task);
  const det = DETAIL[d.key] || { title: '详情', sum: [] };
  let body;
  if (d.tab === 'sum') body = `<ul style="margin:0;padding-left:18px;line-height:1.9">${det.sum.map((s) => `<li>${esc(s)}</li>`).join('') || '<li>（无）</li>'}</ul>
      <div class="sec-h" style="margin-top:20px"><h3>证据</h3></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><span class="chip ok">${ico('check', 'xs')}提交 a1c93e0 · ai-one 已回读</span><span class="chip claim">“测试都通过了” · GPT 自述</span><span class="chip ok">${ico('check', 'xs')}pnpm verify · CC 本机运行</span><span class="chip">${ico('doc', 'xs')}Issue #${t.issue || '—'} 正文</span></div>`;
  else if (d.tab === 'disc') body = [['独立思考', [['gpt', 'GPT', '首页最上方放“需要你”，按紧急程度排序；进行中的任务一行一个。'], ['argon', 'Argon', '需要考虑空状态；多仓库时要能按仓库筛选；HUD 是否也要显示？']]], ['第 1 轮交换', [['gpt', 'GPT', '同意空状态与筛选。HUD 涉及多窗口，建议放下一版。'], ['argon', 'Argon', '同意延后 HUD，记录为下一版需求。']]]]
    .map(([h, ms]) => `<div class="round"><div class="rh2">${h}</div>${ms.map(([id, n, tx]) => `<div class="msg">${av(id, 's')}<div class="bd2"><div class="who2">${n}<span class="faint" style="font-weight:400">完整回复 1,2${id.length} 字 · 摘要</span><button class="lnk" style="margin-left:auto;font-weight:400" onclick="S.drawer.tab='raw';render()">原文</button></div>${esc(tx)}</div></div>`).join('')}</div>`).join('');
  else if (d.tab === 'raw' && d.key === 'brief') body = `<div class="raw">【CC → Prodex → ChatGPT · 派工首条消息（协作协议 v0.2 模板 B）】
你正在参与 ai-one 的 Issue 协作任务。执行本 Issue 的现有 AGENTS.md 及《协作协议 v0.2》；
先核对 GitHub 的当前事实，不把旧 Handoff、聊天记忆或模型自述当成最新状态。
只在授权范围内操作，不合并。当前任务：xiaolebao516/ai-one#42；本次角色：Executor。
如已有工作，继续而非重做；若信息冲突，说明差异并暂停危险写操作。
────────
（六条核心规则 + 四项补充摘要，略）
任务：按 #42 的验收实现，继续已有分支与 PR #43；完成后报告完整 HEAD 与实际验证。</div>
      <div class="faint" style="font-size:12px;margin-top:10px">期望模型：Thinking · 标准；实际档位：UNVERIFIED。request_id 保存在本机，不写入 GitHub。</div>`;
  else if (d.tab === 'raw') body = `<div class="raw">【ai-one 转发包 · 第 1 轮 · 发给 Argon】
任务：ai-one #42 总览页：一眼看到需要我处理的事
你此前的独立结论已收到。以下是 GPT 的完整回复（未删改）：
────────
首页最上方放“需要你”区域，按紧急程度排序：决策 > 阻塞 > 验收……
（完整原文 1,204 字，保存在本机）
────────
请只回应你同意、反对或需要补充的点，并在结尾用协作标记写明立场。</div>
      <div class="faint" style="font-size:12px;margin-top:10px">原始记录只保存在本机，不写入 GitHub。<button class="lnk" onclick="toast('（模拟）切到网页并定位到这条回复')">在网页中定位</button></div>`;
  else if (d.tab === 'code') body = `<div class="diff"><div class="fh">src/home/NeedsYouSection.tsx</div><div>  export function NeedsYouSection({ items }: Props) {</div><div class="r">-   const count = items.length || 1;</div><div class="a hl">+   const count = items.length;</div><div>    if (count === 0) return &lt;QuietState /&gt;;</div><div class="fh">src/home/__tests__/needsYou.repoFilter.test.tsx</div><div class="a">+ it('filters by repo', () =&gt; { … })</div></div>`;
  else body = [['ok', 'CI · pnpm verify', 'GitHub 回读 · 18/18'], ['ok', 'pnpm verify 112/112', 'CC 本机运行'], ['warn', '“组件测试都通过了”', 'GPT 自述 · 不作为证据'], ['warn', '桌面端真机', '未运行']].map(([s, tx, src]) => `<div class="vrow" style="padding:8px 0;border-top:1px solid var(--line)"><span class="vic ${s}">${ico(s === 'ok' ? 'check' : 'alert', 'xs')}</span>${tx}<span class="src">${src}</span></div>`).join('');
  return `<div class="scrim" onclick="S.drawer=null;render()"></div><div class="drawer"${impl('plan', '逐层展开')}>
    <div class="dh">${ico('layers')}<h3>${esc(det.title)}</h3><button class="btn s icon ghost" onclick="S.drawer=null;render()">${ico('x', 's')}</button></div>
    <div class="tabs">${DRAWER_TABS.map(([k, l, i]) => `<button class="tab ${d.tab === k ? 'on' : ''}" onclick="S.drawer.tab='${k}';render()">${ico(i, 's')}${l}</button>`).join('')}</div>
    <div class="db"><div class="layerhint">${ico('layers', 'xs')}现在 → 阶段结果 → <b>${DRAWER_TABS.find((x) => x[0] === d.tab)[1]}</b> · 越往右越原始</div>${body}</div>
  </div>`;
}
function palette() {
  const q = S.pq.trim().toLowerCase();
  const cmds = [...STAGE_LIB.map((s) => [ico('spark', 's'), `${s.name}`, s.cmd, `S.comp.mode='stage';S.comp.stage='${s.id}';go('home')`]),
    [ico('users', 's'), '交给 CC 协调', '/lead', "S.comp.mode='lead';go('home')"],
    [ico('chat', 's'), '新聊天', '/chat', "go('chat')"],
    [ico('gauge', 's'), '查看资源与额度', '', "go('res')"],
    [ico(S.theme === 'dark' ? 'sun' : 'moon', 's'), '切换浅色 / 深色', '', 'setTheme()']].filter((c) => !q || (c[1] + c[2]).toLowerCase().includes(q));
  const ts = TASKS.filter((t) => !q || (t.title + repoLabel(t)).toLowerCase().includes(q));
  return `<div class="scrim" style="background:rgba(20,18,14,.08)" onclick="S.palette=false;render()"></div><div class="palette"${impl('plan')}>
    <input data-k="pal" placeholder="搜索任务、命令，或输入 /grill …" value="${esc(S.pq)}" oninput="S.pq=this.value;render()" onkeydown="if(event.key==='Enter'){document.querySelector('.palette .it')?.click()}">
    <div class="pl">${cmds.length ? `<div class="grp">命令</div>${cmds.map((c) => `<button class="it" onclick="S.palette=false;${c[3]}">${c[0]}${c[1]}<span class="d mono">${c[2]}</span></button>`).join('')}` : ''}
      ${ts.length ? `<div class="grp">任务</div>${ts.map((t) => `<button class="it" onclick="S.palette=false;openTask('${t.id}')"><span class="sg ${t.state}"></span>${esc(t.title)}<span class="d">${repoLabel(t)} · ${esc(t.stateText)}</span></button>`).join('')}` : ''}</div>
  </div>`;
}
function hudPop() {
  return `<div class="scrim" style="background:transparent" onclick="S.hud=false;render()"></div><div class="hudpop"${impl('plan', 'HUD')}>
    <h6>资源<span>2 分钟前更新</span></h6>${Object.keys(R).map((id) => resRow(id, true)).join('')}
    <div class="resrow"><span class="av l" style="--c:#3B3A36">Px</span><div class="nm">${BRIDGE.name} <span style="font-weight:400;color:#9C9990">派工通道</span></div><span class="q"><span class="qdot"></span>可用</span><div class="nw">${BRIDGE.text}</div></div>
    <div class="foot"><span>额度按“已知 / 网页提示 / 估算 / 未知”区分</span><button onclick="S.hud=false;go('res')">详情 →</button></div>
  </div>`;
}

/* ================= 渲染 ================= */
function render() {
  document.documentElement.dataset.theme = S.theme;
  const keep = {};
  document.querySelectorAll('.scroll[data-k]').forEach((el) => { keep[el.dataset.k] = el.scrollTop; });
  const ae = document.activeElement;
  const focusKey = ae?.dataset?.k;
  const caret = focusKey ? ae.selectionStart : 0;

  let main = '';
  if (S.view === 'home') main = home();
  else if (S.view === 'tasks') main = tasksView();
  else if (S.view === 'task') main = cur() ? taskView(cur()) : home();
  else if (S.view === 'chat') main = chatView();
  else if (S.view === 'flows') main = flowsView();
  else if (S.view === 'res') main = resView();

  document.getElementById('ptb').innerHTML = protoBar();
  const win = document.getElementById('win');
  win.style.setProperty('--win-w', S.win === 'fit' ? '100%' : S.win + 'px');
  win.className = 'win' + (S.impl ? ' impl-on' : '');
  win.innerHTML = `${titlebar()}<div class="app">${sidebar()}<main class="main">${main}</main></div>
    ${S.drawer ? drawer() : ''}${S.palette ? palette() : ''}${S.hud ? hudPop() : ''}
    <div class="toasts">${S.toasts.map((t) => `<div class="toast">${ico('bell', 's')}<span>${esc(t.text)}</span>${t.act ? `<button class="act" onclick="${t.act[1]}">${t.act[0]}</button>` : ''}</div>`).join('')}</div>`;

  document.querySelectorAll('.scroll[data-k]').forEach((el) => { if (keep[el.dataset.k] != null) el.scrollTop = keep[el.dataset.k]; });
  if (focusKey) {
    const el = document.querySelector(`[data-k="${focusKey}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* 部分元素不支持选区 */ } }
  }
  if (S.palette && focusKey !== 'pal') document.querySelector('[data-k="pal"]')?.focus();
  if (S._scrollTo) { document.getElementById(S._scrollTo)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); S._scrollTo = null; }
}
function protoBar() {
  const sc = [['A', '想需求', 'scenarioA()'], ['B', 'CC 协调开发', 'scenarioB()'], ['C', '多模型配置', 'scenarioC()'], ['D', '多仓库', 'scenarioD()'], ['E', '故障与决策', 'scenarioE()'], ['F', '自由聊天', 'scenarioF()']];
  return `<b>ai-one v2 交互原型</b><span class="mockflag">模拟数据</span><span class="sep"></span>
    <div class="grp"><span>场景</span>${sc.map(([k, l, f]) => `<button onclick="${f}" title="${l}">${k} ${l}</button>`).join('')}</div>
    <span class="sp"></span>
    <div class="grp"><span>窗口</span>${['fit', 1920, 1440, 1280, 1024].map((w) => `<button class="${S.win == w ? 'on' : ''}" onclick="S.win='${w}';render()">${w === 'fit' ? '适应' : w}</button>`).join('')}</div>
    <span class="sep"></span>
    <button class="${S.impl ? 'on' : ''}" onclick="S.impl=!S.impl;render()" title="快捷键 I">实现标注</button>
    <button onclick="setTheme()">${S.theme === 'dark' ? '浅色' : '深色'}</button>
    <button class="${S.fast ? 'on' : ''}" onclick="S.fast=!S.fast;render()" title="模拟进度加速">快进</button>
    <button onclick="resetAll();render()">重置</button>`;
}

/* ================= 交互 ================= */
function go(v) { S.view = v; S.web = null; S.menu = null; S.hud = false; S.drawer = null; S.factsOpen = false; render(); }
function openTask(id) { S.view = 'task'; S.task = id; S.web = null; S.menu = null; S.hud = false; S.palette = false; S.writing = null; S.dock = ''; render(); }
function openStage(tid, sid) { S.open[tid + sid] = true; S._scrollTo = 'sec-' + tid + sid; render(); }
function openDrawer(tid, key, tab) { S.drawer = { task: tid, key, tab }; render(); }
function openPalette() { S.palette = true; S.pq = ''; render(); }
function openWeb(pid) { S.web = { pid, take: false }; S.menu = null; render(); }
function openRes(id) { S.hud = false; if (R[id].login !== 'ok') relogin(id); else go('res'); }
function toggle(k, v) {
  if (k === 'menu') S.menu = S.menu === v ? null : v;
  else S[k] = !S[k];
  render();
}
function setTheme() { S.theme = S.theme === 'dark' ? 'light' : 'dark'; render(); }
function toast(text, act) {
  const id = ++seq;
  S.toasts.push({ id, text, act });
  if (S.toasts.length > 3) S.toasts.shift();
  render();
  setTimeout(() => { S.toasts = S.toasts.filter((t) => t.id !== id); render(); }, 4800);
}
function newTask() { S.comp.mode = 'lead'; go('home'); setTimeout(() => document.querySelector('[data-k="comp"]')?.focus(), 30); }
function setComp(k, v) {
  if (k === 'stage') { S.comp.mode = 'stage'; S.comp.stage = v; }
  else if (k === 'flow') { S.comp.mode = 'flow'; S.comp.flow = v; S.menu = null; }
  else if (k === 'repo') {
    S.comp.repo = v; S.menu = null;
    /* 不关联仓库时切到“想需求”；再选回仓库时恢复默认的“交给 CC” */
    if (!v && ['lead', 'flow'].includes(S.comp.mode)) { S.comp.mode = 'stage'; S.comp.stage = 'grill'; S.comp.autoGrill = true; }
    else if (v && S.comp.autoGrill) { S.comp.mode = 'lead'; S.comp.autoGrill = false; }
  }
  else S.comp[k] = v;
  if (k === 'mode' && v === 'stage') S.comp.stage = S.comp.stage || 'grill';
  if (k === 'mode' || k === 'stage' || k === 'flow') S.comp.autoGrill = false;
  render();
}
function compInput(el) {
  const v = el.value;
  const was = S.slash;
  S.comp.text = v;
  S.slash = /^\/\S*$/.test(v);
  if (S.slash !== was || S.slash) render();
}
function compKey(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); start(); }
  if (e.key === 'Enter' && S.slash) { e.preventDefault(); document.querySelector('.slash .it')?.click(); }
  if (e.key === 'Escape') { S.slash = false; render(); }
}
function relogin(id) {
  const r = R[id];
  if (r.login === 'none') { toast(`（模拟）打开 ${r.full} 网页，请在里面登录`); return; }
  r.login = 'ok'; r.state = 'idle'; r.now = '待命';
  r.quota = { type: 'hint', level: 'ok', text: '未见限额提示', src: '网页 · 刚刚' };
  S.comp.sub = null;
  const t = task('t12');
  if (id === 'argon' && t && t.state === 'block') {
    t.state = 'run'; t.stateText = '定方案 · 第 2 轮'; t.need = null;
    t.now = 'Argon 已恢复，正在补发第 2 轮发言。'; t.nowMeta = '只补发给 Argon，不会重复发送给 GPT 与 Opus';
    t.stages[1].st = 'active'; t.stages[1].sum = '第 2 轮：等 Argon 补发';
    t.disc.cells[2].argon = ['run', ''];
    t.events.push({ stage: 'plan', k: 'you', who: [], t: '现在', text: '你完成了 Argon 登录，第 2 轮消息已自动重发给 Argon。', _new: true });
    ROLE.t12.argon = ['讨论', '第 2 轮补发中'];
    later(t, () => {
      t.disc.cells[2].argon = ['done', '同意混合方案；附件走三方合并'];
      t.now = '第 2 轮完成，Opus 正在做方案审计。'; t.nowMeta = '审计 PASS 后进入拆任务';
      t.events.push({ stage: 'plan', k: 'step', who: ['argon'], t: '现在', text: 'Argon 补发完成：同意“文本 CRDT + 元数据三方合并”的混合方案。', _new: true });
      ROLE.t12.argon = ['讨论', '第 2 轮已发言'];
    }, 2600);
  }
  toast(`${r.name} 已重新登录（模拟）${id === 'argon' ? '，notes-sync #12 自动继续' : ''}`);
}
function later(t, fn, ms) { t._timer = setTimeout(() => { if (t.state === 'paused') { later(t, fn, 800); return; } fn(); render(); }, S.fast ? Math.min(ms, 400) : ms); }
function needAct(id, a, i) {
  const t = task(id);
  if (a === 'relogin') return relogin('argon');
  if (a === 'pause') return togglePause(id);
  if (a === 'sub') {
    t.state = 'run'; t.stateText = '定方案 · 第 2 轮'; t.need = null; t.now = '本轮由 Opus 代替 Argon 发言。'; t.nowMeta = 'Argon 恢复后可以回到讨论';
    t.events.push({ stage: 'plan', k: 'you', who: [], t: '现在', text: '你让 Opus 本轮代替 Argon。', _new: true });
    return render();
  }
  if (a === 'write') { S.writing = id; return render(); }
  if (a === 'merge') {
    t.state = 'done'; t.stateText = '已合并'; t.pr.st = 'merged'; t.now = `你合并了 PR #${t.pr.n}。CC 会核对合并结果、关闭 Issue 并留下交接记录。`; t.nowMeta = ''; t.stages[t.stages.length - 1].st = 'done';
    S.writing = null;
    return toast(`（模拟）PR #${t.pr.n} 已合并`);
  }
  if (a === 'changes') {
    const txt = document.querySelector('[data-k="write"]')?.value || '标题文案再短一点';
    t.state = 'rework'; t.stateText = '按你的意见返工'; t.now = 'CC 收到你的修改意见，经 Prodex 交给 GPT 执行会话返工。'; t.nowMeta = '返工后针对新 HEAD 重新审计，再请你验收';
    t.events.push({ stage: 'ship', k: 'you', who: [], t: '现在', text: '你的修改意见：' + txt, _new: true });
    t.stages[t.stages.length - 1].st = 'todo'; t.stages.find((s) => s.id === 'build').st = 'active';
    S.writing = null; return render();
  }
  if (a === 'opus') {
    t.state = 'run'; t.stateText = 'Opus 裁决中'; t.need = null; t.now = 'Opus 正在阅读双方意见与 3 次审计记录，给出裁决。'; t.nowMeta = '裁决结果会作为后续返工的方向';
    t.team = [...new Set([...t.team, 'opus'])]; (ROLE[id] = ROLE[id] || {}).opus = ['裁决', '审阅中'];
    t.events.push({ stage: 'build', k: 'you', who: [], t: '现在', text: '你请 Opus 裁决。', _new: true });
    later(t, () => {
      t.state = 'rework'; t.stateText = '按裁决返工 · 第 1/3 轮'; t.now = 'Opus 裁决：先用阈值 + 手动按钮上线，同时记录网页提示作为后续增强。CC 正在返工。'; t.nowMeta = '返工计数已重置';
      t.events.push({ stage: 'build', k: 'result', who: ['opus'], t: '现在', text: 'Opus 裁决：采用 CC 的方向，并把网页提示检测记为后续 Issue。', _new: true });
      ROLE[id].opus = ['裁决', '已完成'];
    }, 2500);
    return render();
  }
  if (a === 'pick' || a === 'writeok') {
    const txt = a === 'writeok' ? (document.querySelector('[data-k="write"]')?.value || '按我的方案') : t.need.sides[i][1].replace(/（.*）/, '') + ' 的方向';
    t.state = 'rework'; t.stateText = '按你的决定返工 · 第 1/3 轮'; t.need = null; S.writing = null;
    t.now = `CC 已把你的决定交给执行方和审计会话：${txt}。CC 正在返工。`; t.nowMeta = '返工计数已重置为 0/3';
    t.events.push({ stage: 'build', k: 'you', who: [], t: '现在', text: '你的决定：' + txt, _new: true });
    return render();
  }
}
function togglePause(id) {
  const t = task(id);
  if (t.state === 'paused') {
    const p = t._prev || { state: 'run', stateText: '进行中', now: t.now };
    Object.assign(t, p);
    t.events.push({ stage: t.stages.find((s) => ['active', 'paused'].includes(s.st))?.id || 'build', k: 'you', who: [], t: '现在', text: '你继续了任务，从暂停处接着推进。', _new: true });
    t.stages.forEach((s) => { if (s.st === 'paused') s.st = 'active'; });
    toast('已继续');
  } else {
    t._prev = { state: t.state, stateText: t.stateText, now: t.now, nowMeta: t.nowMeta };
    t.state = 'paused'; t.stateText = '已暂停'; t.now = '已暂停：不再发起新的发送或转发，正在生成的回复会完整收下。'; t.nowMeta = '暂停期间可以插话、改规则、查看记录';
    toast('已暂停（Ctrl+. 继续）');
  }
  render();
}
function takeOver() {
  const t = cur();
  if (t && t.state !== 'paused') { t._prev = { state: t.state, stateText: t.stateText, now: t.now, nowMeta: t.nowMeta }; t.state = 'paused'; t.stateText = `已暂停 · 你在 ${R[S.web.pid].name} 网页操作`; t.now = `你接管了 ${R[S.web.pid].name}，任务停在当前步骤。`; }
  S.web.take = true; render();
}
function giveBack(use) {
  const t = cur();
  const name = R[S.web.pid].name;
  S.web = null;
  if (t && t._prev) { Object.assign(t, t._prev); }
  t?.events.push({ stage: t.stages.find((s) => ['active', 'you', 'block', 'paused'].includes(s.st))?.id || t.stages[0].id, k: 'you', who: [], t: '现在', text: use ? `你交还了 ${name}，采用网页里的最新回复作为这一步的结果。` : `你交还了 ${name}，忽略了你在网页里的操作。`, _new: true });
  toast('已交还，任务继续');
}
function handoff(id) {
  S.menu = null;
  const t = task(id);
  t.events.push({ stage: t.stages.find((s) => s.st === 'active')?.id || t.stages[0].id, k: 'sys', who: [], t: '现在', text: 'GPT 会话已交接到新会话：附带任务目标、已确认结论、未决问题和最近 2 轮原文。旧会话链接已保留。', _new: true });
  toast('（模拟）已交接到新会话');
}
function stopTask(id) { S.menu = null; const t = task(id); clearTimeout(t._timer); t.state = 'done'; t.stateText = '已停止'; t.now = '你停止了任务。已完成的部分和记录都保留。'; t.nowMeta = ''; render(); }
function sendDock(id, interrupt) {
  const t = task(id);
  const txt = (document.querySelector('[data-k="dock"]')?.value || '').trim();
  if (!txt) return toast('先写点什么');
  S.dock = '';
  const stage = t.kind === 'discussion' ? 'follow' : (t.stages.find((s) => ['active', 'you', 'block', 'paused'].includes(s.st))?.id || t.stages[0].id);
  t.events.push({ stage, k: 'you', who: [], t: '现在', text: (interrupt ? '（打断）' : '（插话）') + txt, _new: true });
  render();
  later(t, () => {
    t.events.push({ stage, k: t.kind === 'discussion' ? 'result' : 'decide', who: t.kind === 'discussion' ? ['gpt', 'argon'] : ['cc'], t: '现在', text: t.kind === 'discussion' ? 'GPT 与 Argon 各自回应了你的追问，并更新了汇总。' : interrupt ? 'CC 已停止当前生成，按你的话调整：' + txt.slice(0, 24) : 'CC 收到，会在当前步骤完成后一起处理。', _new: true });
  }, 1600);
}
function toPlan(id) {
  const t = task(id);
  t.kind = undefined; t.repo = 'ai-one'; t.issue = 48; t.state = 'run'; t.stateText = '定方案'; t.lead = 'flow'; t.flow = 'full';
  t.now = 'GPT、Argon 和 CC 正在基于讨论结论各自给出方案。'; t.nowMeta = 'CC 已为它创建 Task Issue #48（模拟），讨论汇总作为 Issue 正文';
  t.team = ['cc', 'gpt', 'argon'];
  t.stages = [{ id: 'grill', st: 'done', team: ['gpt', 'argon'], sum: '3 条结论，1 项分歧', dur: '刚刚' }, { id: 'plan', st: 'active', team: ['gpt', 'argon', 'cc'], sum: '三方独立给方案' }, { id: 'split', st: 'todo', team: ['cc'], sum: '' }, { id: 'build', st: 'todo', team: ['gpt', 'cc'], sum: '' }, { id: 'ship', st: 'todo', team: ['cc'], sum: '' }];
  t.disc = { lanes: ['gpt', 'argon', 'cc'], phases: ['独立方案', '第 1 轮'], roles: { cc: '把关' }, cells: [{ gpt: ['run', ''], argon: ['run', ''], cc: ['run', ''] }] };
  ROLE[id] = { cc: ['协调 · 把关', '独立给方案中'], gpt: ['讨论', '独立给方案中'], argon: ['讨论', '独立给方案中'] };
  t.events = [{ stage: 'grill', k: 'result', who: ['gpt', 'argon'], t: '刚刚', text: '想需求完成：3 条结论，1 项分歧，1 个待补证据。', detail: 'grill' }];
  t.rules = ['方案审计 PASS 才进入拆任务'];
  render();
  toast('已转入定方案，讨论汇总作为输入');
}
function forward(from, to) {
  S.chat.fwd = null;
  const names = to === 'all' ? '其他所有人' : R[to].name;
  if (to !== 'all' && R[to].login !== 'ok') return toast(`${R[to].name} 未登录，无法转发`);
  toast(`（模拟）已把 ${R[from].name} 的完整回复转发给 ${names}`);
}
function toggleTarget(id) {
  const c = S.chat;
  c.targets = c.targets.includes(id) ? c.targets.filter((x) => x !== id) : [...c.targets, id];
  render();
}
function chatSend() {
  const txt = (S.chat.text || '').trim();
  if (txt.startsWith('/')) { const st = STAGE_LIB.find((s) => s.cmd === txt.split(' ')[0]); if (st) { S.comp.mode = 'stage'; S.comp.stage = st.id; S.comp.text = txt.split(' ').slice(1).join(' '); S.chat.text = ''; return go('home'); } }
  if (!txt) return toast('先写点什么');
  S.chat.q = txt; S.chat.text = ''; S.chat.tab = 'cmp';
  const old = S.chat.replies;
  S.chat.replies = {};
  render();
  S.chat.targets.forEach((id, i) => setTimeout(() => {
    S.chat.replies[id] = old[id]?.text ? { ...old[id], t: (8 + i * 7) + ' 秒', text: `（模拟回复）关于“${txt.slice(0, 20)}”：\n\n` + (old[id].text.split('\n\n')[1] || old[id].text) } : { model: R[id].models[0], t: '9 秒', text: `（模拟回复）关于“${txt.slice(0, 20)}”，我的看法是……` };
    render();
  }, (S.fast ? 300 : 1300) + i * 700));
}
function chatToTask() {
  S.comp.mode = 'stage'; S.comp.stage = 'grill'; S.comp.text = S.chat.q; go('home');
  toast('已把这段聊天作为输入，选一个阶段或流程开始');
}

/* ================= 启动新任务（模拟） ================= */
function start() {
  const c = { ...S.comp };
  const text = c.text.trim();
  /* 开始后输入框回到默认方式：有仓库时“交给 CC”，没有时“想需求” */
  S.comp.mode = S.comp.repo ? 'lead' : 'stage'; S.comp.stage = 'grill'; S.comp.autoGrill = !S.comp.repo;
  if (c.mode === 'chat') { S.chat.text = text || CHAT_SEED.q; S.comp.text = ''; go('chat'); return chatSend(); }
  if (c.mode === 'stage' && c.stage === 'grill') return startGrill(text || GRILL_SCRIPT.topic, c.sub);
  if (c.mode === 'stage') { toast(`（模拟）启动“${STAGE[c.stage].name}”：与“想需求”同样的阶段视图`); return startGrill(text || GRILL_SCRIPT.topic, c.sub); }
  return startLead(text || '设置页增加“只在需要我时通知”的开关', c.mode === 'flow' ? c.flow : null);
}
function startGrill(topic, sub) {
  const id = 'n' + ++seq;
  const g = GRILL_SCRIPT;
  const lanes = g.lanes.map((l) => (l === 'argon' && sub ? sub : l)).filter((l, i, a) => a.indexOf(l) === i);
  const map = (o) => { const r = {}; Object.entries(o).forEach(([k, v]) => { r[k === 'argon' && sub ? sub : k] = v; }); return r; };
  const t = {
    id, repo: null, issue: null, kind: 'discussion', title: topic.length > 30 ? topic.slice(0, 30) + '…' : topic, state: 'run', lead: 'flow', flow: 'grillonly',
    stateText: '想需求 · 独立思考', updated: '刚刚', now: 'GPT 和 Argon 正在各自思考，彼此看不到对方的答案。', nowMeta: '之后会交换完整回复，最多 3 轮，Opus 做第三方审计',
    team: lanes, stages: [{ id: 'grill', st: 'active', team: lanes, sum: '' }], events: [], rules: [],
    disc: { lanes, phases: g.phases, cells: [], involve: g.cells.map((c) => Object.keys(map(c))), roles: { opus: '审计' } },
  };
  TASKS.unshift(t);
  ROLE[id] = Object.fromEntries(lanes.map((l) => [l, [l === 'opus' ? '审计（可选）' : '讨论', l === 'opus' ? '等讨论第 1 轮结束' : '独立思考中']]));
  S.comp.text = ''; S.comp.sub = null;
  openTask(id);
  const steps = [];
  g.cells.forEach((cell, pi) => {
    const m = map(cell);
    steps.push(() => { t.disc.cells[pi] = Object.fromEntries(Object.keys(m).map((k) => [k, ['run', '']])); t.stateText = '想需求 · ' + g.phases[pi]; if (pi === 1) { t.now = '独立思考完成，正在交换完整回复（第 1 轮）。'; t.nowMeta = '只传递对方尚未看到的新内容'; } if (pi === 2) { t.now = 'Opus 正在审计讨论：哪些有依据、遗漏了什么、是否值得继续。'; t.nowMeta = '审计者与讨论双方是不同的 AI'; } if (pi === 3) { t.now = '审计指出 1 个值得继续的问题，进入第 2 轮。'; t.nowMeta = '第 2 轮只围绕审计提出的问题'; } });
    steps[steps.length - 1] = ((prev) => () => { prev(); Object.keys(m).forEach((k) => { ROLE[id][k][1] = g.phases[pi] + '中'; }); })(steps[steps.length - 1]);
    Object.keys(m).forEach((k) => steps.push(() => { t.disc.cells[pi][k] = ['done', m[k]]; ROLE[id][k][1] = g.phases[pi] + ' · 已完成'; }));
  });
  steps.push(() => { t.now = '正在汇总：结论、分歧、待补证据。'; t.stateText = '想需求 · 汇总'; });
  steps.push(() => {
    t.result = g.result; t.state = 'done'; t.stateText = '讨论完成'; t.now = '讨论完成：3 条结论，1 项分歧，1 个待补证据。'; t.nowMeta = `共 ${g.phases.length} 个环节 · 用时约 7 分钟（模拟）`;
    t.stages[0].st = 'done';
    toast('想需求完成：3 条结论，1 项分歧');
  });
  runSteps(t, steps, 1300);
}
function startLead(title, flowId) {
  const id = 'n' + ++seq;
  const repo = S.comp.repo || 'ai-one';
  const viaFlow = !!flowId;
  const t = {
    id, repo, issue: 47, title: title.length > 30 ? title.slice(0, 30) + '…' : title, state: 'run', lead: viaFlow ? 'flow' : 'cc', flow: flowId || 'lead', dyn: !viaFlow,
    stateText: '进行中', updated: '刚刚', now: viaFlow ? '按“快速开发”流程开始：GPT 与讨论伙伴先各自梳理需求。' : 'CC 正在读 Issue 和相关代码，决定怎么推进。', nowMeta: '只在需要你时停下',
    team: ['cc'], pr: null, ci: null, review: null, stages: [], events: [],
    rules: ['审计不通过自动返工，最多 3 轮', '执行和审计用不同会话', 'Prodex 请求结果不明时先恢复，不重发', '合并前需要我验收'],
  };
  ROLE[id] = { cc: ['协调 · 本机验证', '阅读需求'] };
  TASKS.unshift(t);
  S.comp.text = '';
  openTask(id);
  const partner = R.argon.login === 'ok' ? 'argon' : 'opus';
  const ev = (stage, k, who, text, extra = {}) => t.events.push({ stage, k, who, t: '现在', text, _new: true, ...extra });
  const build = () => t.stages.find((s) => s.id === 'build');
  const steps = [
    () => { ev('plan', 'live', ['cc'], 'CC 正在阅读 Issue 与仓库结构'); t.stages.push({ id: 'plan', st: 'active', team: ['cc'], sum: '阅读需求' }); },
    () => {
      t.events.pop();
      ev('plan', 'decide', ['cc'], '需求清楚、改动集中在 1 个文件：跳过“想需求”。方案我定，实现交给 GPT。', { override: true });
      t.now = 'CC 判断这是小改动，自己定方案。';
    },
    () => { ev('plan', 'result', ['cc'], '方案：设置模型新增 notifyOnlyWhenNeeded（默认开），通知入口统一判断。'); t.stages[0].st = 'done'; t.stages[0].sum = '小改动，CC 自定方案'; t.stages[0].dur = '1 分钟'; t.stages.push({ id: 'build', st: 'active', team: ['gpt', 'cc'], sum: 'GPT 实现中' }); },
    () => {
      ev('build', 'decide', ['cc'], '经 Prodex 派 GPT 执行（会话 A）。', { brief: true, chips: [['ok', 'Prodex 回执 · request_id 已保存']] });
      t.team.push('gpt'); ROLE[id].gpt = ['执行（会话 A）', '实现中']; t.now = 'GPT 执行会话正在实现并推送。';
    },
    () => { ev('build', 'sys', [], 'Prodex 请求超时、结果不明：CC 先用 request_id 恢复，拿到了回复，没有重复派工。'); },
    () => { ev('build', 'step', ['gpt'], 'GPT 在新分支推送提交并开 PR。', { chips: [['ok', '提交 5d2e8f1 · 已回读'], ['ok', 'PR #48 · 已回读']] }); t.pr = { n: 48, st: 'draft' }; t.ci = 'run'; },
    () => {
      ev('build', 'step', ['cc'], 'CC 本机运行 pnpm verify：通过。', { chips: [['ok', '本机运行 · 通过']] });
      ev('build', 'decide', ['cc'], '经 Prodex 开独立会话（会话 B），请 GPT 审计 5d2e8f1；不带执行上下文。');
      ev('build', 'live', ['gpt'], 'GPT 审计会话审查中'); ROLE[id].gpt = ['执行（会话 A）· 审计（会话 B）', '审计中']; t.now = 'GPT 审计会话正在独立审查真实 Diff 与 HEAD。';
    },
    () => { t.events.pop(); ev('build', 'fail', ['gpt'], 'GPT 独立审计 5d2e8f1：REVISE。', { chips: [['bad', '旧设置迁移时默认值丢失']] }); ev('build', 'sys', [], 'CC 把审计意见原文转给执行会话 A，返工第 1 轮（上限 3 轮）。'); t.state = 'rework'; t.stateText = '返工中 · 第 1/3 轮'; t.now = 'GPT 执行会话正在按审计意见补上设置迁移。'; t.review = { st: 'fail', text: 'GPT 独立审计 REVISE' }; },
    () => { ev('build', 'step', ['gpt'], 'GPT 返工后推送新提交。', { chips: [['ok', '提交 9a0b7c3 · 已回读'], ['claim', '“新增迁移测试” · GPT 自述']] }); ev('build', 'step', ['cc'], 'CC 本机重跑 pnpm verify：通过，新增 2 个测试确实存在。', { chips: [['ok', '本机运行 · 通过']] }); t.state = 'run'; t.stateText = '复审中'; t.now = 'GPT 审计会话正在针对新 HEAD 9a0b7c3 复审（不沿用旧结论）。'; },
    () => { ev('build', 'result', ['gpt'], 'GPT 审计会话复审 9a0b7c3：PASS。', { chips: [['ok', 'PASS @ 9a0b7c3'], ['ok', 'CI 18/18 · 已回读']] }); t.ci = 'ok'; t.review = { st: 'ok', text: 'GPT 独立审计 PASS' }; build().st = 'done'; build().sum = '返工 1 次后 PASS'; build().dur = '7 分钟'; },
    () => {
      t.stages = t.stages.filter((s) => s.id !== 'ship');
      t.stages.push({ id: 'ship', st: 'you', team: ['cc'], sum: '等你验收' }); t.dyn = false;
      t.state = 'accept'; t.stateText = '待你验收'; t.pr.st = 'ready'; t.now = `完成，等你验收并合并 PR #48。`; t.nowMeta = '共 9 分钟（模拟）· 返工 1 次 · 审计针对当前 HEAD';
      ROLE[id].cc = ['协调 · 本机验证 · 汇总', '等你验收']; ROLE[id].gpt = ['执行（会话 A）· 审计（会话 B）', '审计 PASS'];
      t.accept = { did: ['设置页新增“只在需要我时通知”开关，默认开启', '旧设置迁移时保留用户原有的通知偏好'], verify: [['ok', 'CI 18/18 通过', 'GitHub 回读'], ['ok', 'pnpm verify 通过', 'CC 本机运行'], ['warn', '桌面通知真机未验证', '需要你看一眼']], reviews: [['gpt', 'GPT 独立审计 PASS（会话 B）', '9a0b7c3']], risk: '仅影响通知判断入口；关闭开关后行为与旧版一致。' };
      toast(`${repo} #47 完成，等你验收`, ['查看', `openTask('${id}')`]);
    },
  ];
  if (viaFlow) {
    steps.splice(0, 3,
      () => { t.stages = [{ id: 'grill', st: 'active', team: ['gpt', partner], sum: '讨论需求' }, { id: 'build', st: 'todo', team: ['gpt', 'cc'], sum: '' }, { id: 'ship', st: 'todo', team: ['cc'], sum: '' }]; t.team = ['cc', 'gpt', partner]; ROLE[id].gpt = ['讨论', '讨论中']; ROLE[id][partner] = ['讨论', '讨论中']; ev('grill', 'step', ['gpt', partner], `GPT 与 ${R[partner].name} 各自梳理需求，彼此看不到对方。`); },
      () => { ev('grill', 'result', ['gpt', partner], '1 轮交换后无新问题：需求 2 条。', { detail: 'grill' }); t.stages[0].st = 'done'; t.stages[0].dur = '3 分钟'; t.stages[0].sum = '需求 2 条'; build().st = 'active'; build().sum = 'GPT 实现中'; ROLE[id][partner][1] = '已完成'; },
    );
  }
  runSteps(t, steps, 1500);
}
function runSteps(t, steps, ms) {
  let i = 0;
  const tick = () => {
    if (!TASKS.includes(t) || t.stateText === '已停止') return;
    if (t.state === 'paused') { t._timer = setTimeout(tick, 600); return; }
    const f = steps[i++];
    if (!f) return;
    f(); t.updated = '刚刚'; render();
    if (i < steps.length) t._timer = setTimeout(tick, S.fast ? 280 : ms);
  };
  t._timer = setTimeout(tick, S.fast ? 280 : 700);
}

/* ================= 场景入口 ================= */
function scenarioA() {
  if (R.argon.login !== 'ok') relogin('argon');
  S.comp.mode = 'stage'; S.comp.stage = 'grill'; S.comp.text = GRILL_SCRIPT.topic; go('home');
  toast('场景 A：问题已填好，点“开始”。也可以在输入框打 /grill');
}
function scenarioB() { openTask('t42'); toast('场景 B：CC 协调、经 Prodex 派 GPT 执行与审计。想从头看，到总览选“交给 CC”后点开始'); }
function scenarioC() { S.flow.sel = 'parallel'; S.flow.pop = null; go('flows'); toast('场景 C：点参与者可改角色、模型、思考深度。运行中的例子见 home-lab #7'); }
function scenarioD() { S.tasksGroup = 'repo'; S.repoFilter = null; go('tasks'); }
/* 把某个任务恢复成初始模拟状态，让场景跳转可以重复演示 */
function restoreSeed(id) {
  const i = TASKS.findIndex((t) => t.id === id);
  const seed = TASK_SEED.find((t) => t.id === id);
  if (i < 0 || !seed) return;
  clearTimeout(TASKS[i]._timer);
  TASKS[i] = structuredClone(seed);
  ROLE[id] = structuredClone(ROLE_SEED[id]);
}
function scenarioE() {
  restoreSeed('t12'); restoreSeed('t45');
  R.argon = structuredClone(RES_SEED.argon);
  openTask('t12');
  toast('场景 E：登录失效。另见 ai-one #45（审计 3 次不通过，需要你决定）');
}
function scenarioF() { S.chat.tab = 'cmp'; go('chat'); }

document.addEventListener('keydown', (e) => {
  const typing = /TEXTAREA|INPUT/.test(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (S.palette) { S.palette = false; render(); } else openPalette();
  }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newTask(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === '.') { e.preventDefault(); if (S.view === 'task' && cur()) togglePause(S.task); }
  else if (e.key === 'Escape') { S.palette = false; S.drawer = null; S.menu = null; S.hud = false; S.slash = false; S.flow.pop = null; render(); }
  else if (!typing && e.key.toLowerCase() === 'i') { S.impl = !S.impl; render(); }
});

/* 深链接：#task/t42、#chat、#flows/parallel、#res、#tasks；可加 ?dark、?w=1280、?noimpl，便于分享与截图 */
function fromHash() {
  const [path, query = ''] = location.hash.slice(1).split('?');
  const [v, arg] = path.split('/');
  const q = new URLSearchParams(query);
  if (q.has('dark')) S.theme = 'dark';
  if (q.has('w')) S.win = q.get('w');
  if (q.has('noimpl')) S.impl = false;
  if (q.has('noproto')) document.body.classList.add('noproto');
  if (v === 'task' && task(arg)) { S.view = 'task'; S.task = arg; if (q.has('web')) S.web = { pid: q.get('web'), take: q.has('take') }; if (q.has('drawer')) S.drawer = { task: arg, key: q.get('drawer'), tab: q.get('tab') || 'sum' }; }
  else if (v === 'flows') { S.view = 'flows'; if (arg) S.flow.sel = arg; if (q.has('pop')) S.flow.pop = q.get('pop'); }
  else if (v === 'chat') { S.view = 'chat'; if (arg) S.chat.tab = arg; }
  else if (['home', 'tasks', 'res'].includes(v)) S.view = v;
  if (q.has('palette')) S.palette = true;
  if (q.has('hud')) S.hud = true;
  if (q.has('grill')) { relogin('argon'); S.toasts = []; startGrill(GRILL_SCRIPT.topic); S.fast = true; }
  if (q.has('lead')) { startLead('设置页增加“只在需要我时通知”的开关', null); S.fast = true; }
  if (q.has('open') && cur()) S.open[cur().id + q.get('open')] = true;
}

/* 界面里的 onclick / oninput 直接调用这些函数 */
Object.assign(window, {
  go, openTask, openStage, openDrawer, openPalette, openWeb, openRes, toggle, setTheme, toast, newTask, setComp, compInput, compKey,
  relogin, needAct, togglePause, takeOver, giveBack, handoff, stopTask, sendDock, toPlan, forward, toggleTarget, chatSend, chatToTask,
  start, resetAll, render, scenarioA, scenarioB, scenarioC, scenarioD, scenarioE, scenarioF,
});

resetAll();
fromHash();
render();
