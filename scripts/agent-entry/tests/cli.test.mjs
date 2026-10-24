import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EXIT } from '../../issue-claim/cli.mjs';
import { briefing, buildBoard, formatBoard, formatRecovery, loadState, main, parseMeta, pickNext, prLinks, recoveryCandidates, toolOf } from '../cli.mjs';

const issue = (number, title, body = '', labels = []) => ({ number, title, body, labels: labels.map((name) => ({ name })), url: `https://example.test/issues/${number}` });

test('parseMeta reads dispatch fields, bold markers and the Chinese priority line', () => {
  const meta = parseMeta('- Priority: **P1**（x）\n- Recommended Agent: **Codex（本机）**；理由\n- Depends on: #137\n- Ready when: 立即');
  assert.equal(meta.priority, 'P1');
  assert.equal(meta.recommended, 'Codex（本机）；理由');
  assert.equal(meta.dependsOn, '#137');
  assert.equal(parseMeta('- **优先级：P0**').priority, 'P0');
  assert.equal(parseMeta('no fields').priority, undefined);
  assert.equal(parseMeta('- Stage: PLANNED（等设计稿）').planned, true);
});

test('toolOf recognises tools by whole word', () => {
  assert.equal(toolOf('Codex / session 3'), 'codex');
  assert.equal(toolOf('Claude Code / Opus'), 'claude');
  assert.equal(toolOf('WorkBuddy 会话 x'), 'workbuddy');
  assert.equal(toolOf('Barcodex'), undefined);
});

test('prLinks links by title number and Closes/Spec in the body', () => {
  const linked = prLinks([{ number: 9, title: 'feat(#5): x', body: 'Closes #6\nSpec: #7' }]);
  assert.deepEqual([...linked.keys()].sort(), [5, 6, 7]);
});

const state = {
  issues: [
    issue(1, '[Spec] umbrella', 'no dispatch fields'),
    issue(2, '[Task] low', '- Priority: P2\n- Recommended Agent: Codex'),
    issue(3, '[Task] high', '- Priority: P0\n- Recommended Agent: Claude Code'),
    issue(4, '[Task] claimed', '- Priority: P0', []),
    issue(5, '[Task] blocked', '- Priority: P0', ['blocked']),
    issue(6, '[Spec] planned', '- Stage: PLANNED'),
    issue(7, 'test: not a spec', '- Priority: P0'),
    issue(8, '[Task] mid-flight', '- Priority: P0\n- Recommended Agent: Codex'),
  ],
  claims: [{ issue: 4, agent: 'Codex / s1', at: new Date().toISOString() }],
  prs: [{ number: 80, title: 'feat(#8): wip', body: '' }],
};

test('buildBoard marks claimed, blocked and non-pickable rows', () => {
  const board = buildBoard(state);
  assert.deepEqual(board.map((row) => row.number), [1, 2, 3, 4, 5, 6, 8]);
  const by = (n) => board.find((row) => row.number === n);
  assert.equal(by(1).pickable, false);
  assert.equal(by(4).pickable, false);
  assert.equal(by(5).pickable, false);
  assert.equal(by(6).pickable, true);
  assert.equal(by(8).pickable, false);
  assert.match(formatBoard(board), /#8 P0 \[有PR无认领锁/);
  assert.deepEqual(by(8).prs, [80]);
  assert.match(formatBoard(board), /#4 P0 \[已认领: Codex \/ s1\]/);
});

test('pickNext prefers the tool recommendation, then priority, and skips Issues that already have a PR', () => {
  const board = buildBoard(state);
  assert.equal(pickNext(board, 'Claude Code / Opus').number, 3);
  assert.equal(pickNext(board, 'Codex / s2').number, 2); // #8 is Codex-recommended but already has a PR, so it is not auto-picked
  assert.equal(pickNext(board, 'Unknown tool').number, 3); // no match: P0 first
  assert.equal(pickNext(buildBoard({ ...state, claims: [] }), 'Unknown tool').number, 3);
  assert.equal(pickNext([], 'x'), undefined);
});

function run(argv, extra = {}) {
  const lines = { out: [], err: [] };
  const code = main(argv, { state, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l), ...extra });
  return { code, out: lines.out.join('\n'), err: lines.err.join('\n') };
}

test('take claims through the lock and prints the briefing; a lost race exits held', () => {
  const claimed = [];
  const ok = run(['take', '--agent', 'Claude Code / s'], { claimIssue: (n, agent) => (claimed.push([n, agent]), { ok: true }) });
  assert.equal(ok.code, EXIT.ok);
  assert.deepEqual(claimed, [[3, 'Claude Code / s']]);
  assert.match(ok.out, /已认领 #3/);
  assert.match(ok.out, /claim\/?|issue-claim\/cli\.mjs release 3/);

  const lost = run(['take', '3', '--agent', 'Codex / s'], { claimIssue: () => ({ ok: false, holder: { agent: 'Someone', at: 't' } }) });
  assert.equal(lost.code, EXIT.held);
  assert.match(lost.err, /Someone/);
});

test('take --dry-run never calls the lock; bad input exits with an error', () => {
  let called = false;
  const dry = run(['take', '--agent', 'x', '--dry-run'], { claimIssue: () => ((called = true), { ok: true }) });
  assert.equal(dry.code, EXIT.ok);
  assert.equal(called, false);
  assert.equal(run(['take']).code, EXIT.error);
  assert.equal(run(['take', '99', '--agent', 'x']).code, EXIT.error);
  assert.equal(run(['nope']).code, EXIT.error);
  assert.equal(run(['board']).code, EXIT.ok);
});

test('briefing mentions an existing PR so the taker continues the branch', () => {
  const row = buildBoard(state).find((r) => r.number === 8);
  assert.match(briefing(row, 'a'), /已有开放 PR #80/);
});

test('toolOf ignores aliases of other tools inside the session id', () => {
  assert.equal(toolOf('Codex / cc-coordination'), 'codex');
  assert.equal(toolOf('Claude Code / codex-run'), 'claude');
  assert.equal(toolOf('Antigravity/c759747d'), 'antigravity');
});

test('an Issue with a registered coordinator but no claim ref is not auto-picked', () => {
  const issues = [
    issue(10, '[Task] owned', ['- Priority: P0', '- Current Coordinator / claim: Claude Code / Opus'].join('\n')),
    issue(11, '[Task] open', ['- Priority: P1', '- Current Coordinator / claim: 待认领（必须先 claim）'].join('\n')),
    issue(12, '[Spec] owned spec', ['- Stage: PLANNED', '- 调度 agent：Codex 会话 x'].join('\n')),
    issue(13, '[Task] template', ['- Priority: P1', '- Current Coordinator / claim: <!-- 持有认领锁者；待认领 -->'].join('\n')),
  ];
  const board = buildBoard({ issues, claims: [], prs: [] });
  assert.deepEqual(board.filter((row) => row.pickable).map((row) => row.number), [11, 13]);
  assert.match(formatBoard(board), /#10 P0 \[已登记协调者但无认领锁/);
  assert.equal(pickNext(board, 'x').number, 11);
});

test('PR links cover repo-qualified refs and GitHub Development links', () => {
  const issues = [issue(42, '[Task] a', '- Priority: P0'), issue(43, '[Task] b', '- Priority: P0'), issue(44, '[Task] c', '- Priority: P0')];
  const prs = [
    { number: 1, title: 'feat: feature', body: 'Closes xiaolebao516/ai-one#42', closingIssuesReferences: [] },
    { number: 2, title: 'feat: other', body: 'no keyword', closingIssuesReferences: [{ number: 43 }] },
  ];
  const board = buildBoard({ issues, claims: [], prs });
  assert.deepEqual(board.filter((row) => row.pickable).map((row) => row.number), [44]);
});

test('loadState fails closed when the open PR list may be truncated', () => {
  const fetchJson = (args) => (args[0] === 'pr' ? Array.from({ length: 500 }, (_, i) => ({ number: i + 1, title: 'x', body: '' })) : []);
  assert.throws(() => loadState({ cwd: '.', fetchJson, claims: () => [] }), /incomplete list/);
  const ok = loadState({ cwd: '.', fetchJson: (args) => (args[0] === 'pr' ? [] : []), claims: () => [] });
  assert.deepEqual(ok, { issues: [], prs: [], claims: [] });
});

test('a placeholder coordinator line does not hide a registered one in another line', () => {
  const body = ['- Priority: P0', '- Current Coordinator / claim: 待认领', '- 调度 agent：Codex / session-1'].join('\n');
  assert.equal(parseMeta(body).coordinator, 'Codex / session-1');
  assert.equal(buildBoard({ issues: [issue(20, '[Task] x', body)], claims: [], prs: [] })[0].pickable, false);
});

test('PR links accept colon forms such as "Closes: #42"', () => {
  assert.deepEqual([...prLinks([{ number: 1, title: 'x', body: 'Closes: #42\nFixed xiaolebao516/ai-one#43\nSpec: #44' }]).keys()].sort(), [42, 43, 44]);
});

test('board tags a silent or clock-skewed claim but leaves a healthy one plain', () => {
  const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const future = new Date(Date.now() + 3600 * 1000).toISOString();
  const issues = [issue(1, '[Task] a', '- Priority: P1'), issue(2, '[Task] b', '- Priority: P1'), issue(3, '[Task] c', '- Priority: P1')];
  const claims = [
    { issue: 1, agent: 'A', at: old },
    { issue: 2, agent: 'B', at: future },
    { issue: 3, agent: 'C', at: new Date().toISOString() },
  ];
  const text = formatBoard(buildBoard({ issues, claims, prs: [] }));
  assert.match(text, /#1 P1 \[已认领: A ⚠SUSPECT_STALE/);
  assert.match(text, /#2 P1 \[已认领: B ⚠HANDOFF_BLOCKED\(claim timestamp is in the future/);
  assert.match(text, /#3 P1 \[已认领: C\]/);
});

const silentState = () => {
  const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const future = new Date(Date.now() + 3600 * 1000).toISOString();
  const issues = [
    issue(30, '[Task] p1 silent', '- Priority: P1\n- Backup Agent: Codex / s9'),
    issue(31, '[Task] p0 silent', '- Priority: P0\n- Current Coordinator / claim: Antigravity / gone'),
    issue(32, '[Task] clock skew', '- Priority: P0'),
    issue(33, '[Task] healthy', '- Priority: P0'),
    issue(34, '[Task] free', '- Priority: P1'),
  ];
  const claims = [
    { issue: 30, agent: 'WorkBuddy / gone', at: old },
    { issue: 31, agent: 'Antigravity / gone', at: old, generation: 2 },
    { issue: 32, agent: 'Skewed / gone', at: future },
    { issue: 33, agent: 'Alive / here', at: new Date().toISOString() },
  ];
  return { issues, claims, prs: [{ number: 90, title: 'feat(#31): wip', body: '' }] };
};
const silentBoard = () => buildBoard(silentState());

test('recoveryCandidates lists only silent claims, P0 before P1, and never the blocked ones', () => {
  const board = silentBoard();
  assert.deepEqual(recoveryCandidates(board).map((row) => row.number), [31, 30]);
  assert.equal(formatRecovery(board).includes('#33'), false);
  assert.equal(formatRecovery(buildBoard({ issues: [issue(1, '[Task] free', '- Priority: P0')], claims: [], prs: [] })), '');
});

test('formatRecovery names the holder, the evidence to check and the takeover command, but never runs it', () => {
  const text = formatRecovery(silentBoard());
  assert.match(text, /疑似失联的认领（2）/);
  assert.match(text, /#31 P0 .*持锁 Antigravity \/ gone（no heartbeat for 180 min/);
  assert.match(text, /开放 PR #90/);
  assert.match(text, /node scripts\/agent-entry\/cli\.mjs handoff 31/);
  assert.match(text, /takeover 31 --agent "<你的标识>" --stopped-evidence "<怎么确认的>"/);
  assert.match(text, /确认不了停写就保持不动/);
  assert.match(text, /认领时间戳异常或不可读（1）：#32 需要人工或协调者检查，不能 takeover/);
  assert.doesNotMatch(text, /#33/);
});

test('recover is read-only and exits ok; take reports the silent claims instead of a dead end', () => {
  const board = { issues: [issue(31, '[Task] p0 silent', '- Priority: P0')], claims: [{ issue: 31, agent: 'Gone / s', at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }], prs: [] };
  const lines = { out: [], err: [] };
  let claimed = 0;
  const code = main(['recover'], { state: board, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l), claimIssue: () => ((claimed += 1), { ok: true }) });
  assert.equal(code, EXIT.ok);
  assert.equal(claimed, 0);
  assert.match(lines.out.join('\n'), /takeover 31/);

  const empty = main(['recover'], { state: { issues: [], claims: [], prs: [] }, out: () => {}, err: () => {} });
  assert.equal(empty, EXIT.ok);

  const dead = run(['take', '--agent', 'Codex / s'], { state: board, claimIssue: () => ((claimed += 1), { ok: true }) });
  assert.equal(dead.code, EXIT.error);
  assert.equal(claimed, 0);
  assert.match(dead.err, /没有可自动认领的空闲 Issue/);
  assert.match(dead.err, /疑似失联的认领（1）/);
  assert.match(dead.err, /handoff 31/);
});

test('a successful take mentions other silent claims in one line, and stays quiet when there are none', () => {
  const busy = run(['take', '--agent', 'Claude Code / s'], { state: silentState(), claimIssue: () => ({ ok: true }) });
  assert.equal(busy.code, EXIT.ok);
  assert.match(busy.out, /另有 2 条疑似失联/);
  assert.match(busy.out, /agent-entry\/cli\.mjs recover/);
  const clean = run(['take', '--agent', 'Claude Code / s'], { claimIssue: () => ({ ok: true }) });
  assert.doesNotMatch(clean.out, /疑似失联/);
});

const SHA = 'a'.repeat(40);
const handoffFixture = (extra = {}) => (args) => {
  if (args[0] === 'issue') {
    return {
      number: 7,
      title: '[Task] x',
      body: '- Priority: P0\n- Depends on: #1',
      comments: [{ createdAt: '2026-10-23T01:00:00Z', url: 'https://example.test/c1', body: 'token ghp_SECRET123 and chat text' }],
    };
  }
  return [
    { number: 70, title: 'feat(#7): x', body: 'Closes #7', state: 'OPEN', headRefName: 'ai/7-x', headRefOid: SHA, files: [{ path: 'a.mjs' }], reviewDecision: '', statusCheckRollup: [], comments: [], reviews: [], ...extra },
    { number: 71, title: 'other', body: '', state: 'OPEN', headRefName: 'z', headRefOid: 'b'.repeat(40), files: [] },
  ];
};

function handoff(fetcher, claims) {
  const lines = [];
  const code = main(['handoff', '7'], { out: (line) => lines.push(line), err: (line) => lines.push(line), handoffFetch: fetcher, state: { claims } });
  return { code, text: lines.join('\n') };
}

test('handoff rebuilds evidence from GitHub data, flags what is unverifiable, and never copies comment text', () => {
  const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const calls = [];
  const fetcher = (args, cwd) => {
    calls.push(args.join(' '));
    return handoffFixture()(args, cwd);
  };
  const { code, text } = handoff(fetcher, [{ issue: 7, agent: 'Dead / s', at: old, generation: 1 }]);
  assert.equal(code, EXIT.ok);
  assert.match(text, /PR #70（OPEN）分支 `ai\/7-x`，完整 HEAD `a{40}`/);
  assert.doesNotMatch(text, /PR #71/);
  assert.match(text, /2026-10-23T01:00:00Z https:\/\/example\.test\/c1/);
  assert.doesNotMatch(text, /ghp_SECRET123|chat text/);
  assert.match(text, /SUSPECT_STALE/);
  assert.match(text, /待核对/);
  assert.match(text, /takeover 7/);
  assert.ok(calls.every((call) => /^(issue view|pr list)/.test(call)), 'only read commands');
});

test('handoff reads the audit verdict from PR comments by HEAD, never reports "none", and never copies text', () => {
  const stale = `**REVISE**\nfull HEAD ${'c'.repeat(40)}\nsecret ghp_LEAK`;
  const current = `PASS — HEAD ${SHA}\nghp_LEAK2`;
  const mixed = handoff(handoffFixture({ comments: [{ createdAt: '2026-10-23T02:00:00Z', body: stale }, { createdAt: '2026-10-23T03:00:00Z', body: current }] }), []);
  assert.match(mixed.text, /审计：PASS 针对 a{12}，就是当前 HEAD/);
  const shaFirst = handoff(handoffFixture({ comments: [{ createdAt: '2026-10-23T04:00:00Z', body: `${SHA}
PASS — 审计通过
later prose mentions BLOCKED` }] }), []);
  assert.match(shaFirst.text, /审计：PASS 针对 a{12}，就是当前 HEAD/);
  const buried = handoff(handoffFixture({ comments: [{ createdAt: '2026-10-23T04:00:00Z', body: `thanks
ok
PASS ${SHA}` }] }), []);
  assert.match(buried.text, /审计待核对/);
  const prose = handoff(handoffFixture({ comments: [{ createdAt: '2026-10-23T05:00:00Z', body: `${SHA}
pnpm verify PASS, independent audit pending` }, { createdAt: '2026-10-23T06:00:00Z', body: `${SHA}
fix for the round-3 REVISE plus device recheck` }] }), []);
  assert.match(prose.text, /审计待核对/);
  assert.doesNotMatch(prose.text, /审计：PASS|审计：REVISE/);
  const outdated = handoff(handoffFixture({ comments: [{ createdAt: '2026-10-23T02:00:00Z', body: stale }] }), []);
  assert.match(outdated.text, /审计：REVISE 针对 c{12}，不是当前 HEAD，旧审计已失效/);
  const none = handoff(handoffFixture({ comments: [{ createdAt: 'x', body: 'looks fine to me' }] }), []);
  assert.match(none.text, /审计待核对/);
  assert.doesNotMatch(none.text, /审计：\(无\)/);
  for (const result of [mixed, outdated, none]) assert.doesNotMatch(result.text, /ghp_LEAK|looks fine/);
});
