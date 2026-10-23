import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EXIT } from '../../issue-claim/cli.mjs';
import { briefing, buildBoard, formatBoard, loadState, main, parseMeta, pickNext, prLinks, toolOf } from '../cli.mjs';

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
  claims: [{ issue: 4, agent: 'Codex / s1', at: 't' }],
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
