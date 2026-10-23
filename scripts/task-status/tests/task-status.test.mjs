import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSnapshot, renderText } from '../snapshot.mjs';
import { createGitHubClient } from '../github.mjs';
import { main, parseArgs } from '../cli.mjs';

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const issue = { number: 1, title: 'Task', state: 'open', labels: [] };
const pr = { number: 2, title: 'Closes #1 PASS', state: 'open', draft: false, head: { sha } };
const check = { name: 'test', head_sha: sha, status: 'completed', conclusion: 'success' };
function fixture({ issues = [issue], prs = [pr], checks = [check], statuses = [], fail = '', refs = [], graph, checkCount = checks.length, statusCount = statuses.length, statusSha = sha, comments = [], reviews = [] } = {}) {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      if (fail && path.includes(fail)) throw new Error('Simulated authorization/API failure');
      if (path.includes('/issues?')) return issues;
      if (path.includes('/pulls?')) return prs;
      if (path.includes('/check-runs?')) return { total_count: checkCount, check_runs: checks };
      if (path.includes('/status?')) return { sha: statusSha, total_count: statusCount, statuses };
      if (path.includes('/comments')) return typeof comments === 'function' ? comments(path) : comments;
      if (path.includes('/reviews')) return typeof reviews === 'function' ? reviews(path) : reviews;
      throw new Error(`Unexpected endpoint ${path}`);
    },
    async associations() {
      return graph ?? { data: { repository: Object.fromEntries(prs.map((p) => [`p${p.number}`, { headRefOid: p.head.sha, closingIssuesReferences: { nodes: refs, pageInfo: { hasNextPage: false } } }])) } };
    },
  };
}
const collect = (client, options = {}) => collectSnapshot({ repo: 'owner/repo', ...options }, client, () => '2026-10-22T00:00:00.000Z');

test('no PRs is a complete snapshot, not CI success; PR pseudo-issues filtered', async () => {
  const client = fixture({ prs: [], issues: [issue, { ...issue, number: 2, pull_request: {} }] });
  const s = await collect(client);
  assert.equal(s.status, 'complete');
  assert.equal(s.issues.length, 1);
  assert.equal(s.pullRequests.length, 0);
  assert.equal(client.calls.length, 3);
  assert.deepEqual(Object.values(s.runtime), ['unknown', 'unknown', 'unknown', 'unknown']);
});
test('Draft + green checks never implies acceptance; all evidence tied to exact HEAD', async () => {
  const client = fixture({ prs: [{ ...pr, draft: true }] });
  const s = await collect(client);
  const p = s.pullRequests[0];
  assert.equal(p.ci.conclusion, 'success');
  assert.equal(p.possibleHumanAcceptance.value, false);
  assert.equal(p.ci.headSha, sha);
  assert.ok(client.calls.filter((path) => path.includes('/commits/')).every((path) => path.includes(`/commits/${sha}/`)));
  assert.equal(p.ci.checks[0].headSha, sha);
  assert.match(renderText(s), /Draft/);
});
for (const [name, checks, statuses, expected] of [
  ['failed check', [{ ...check, conclusion: 'failure' }], [], 'failure'],
  ['running check', [{ ...check, status: 'in_progress', conclusion: null }], [], 'pending'],
  ['missing CI', [], [], 'missing'],
  ['pending legacy status', [], [{ context: 'build', state: 'pending' }], 'pending'],
  ['failed legacy status overrides green check', [check], [{ context: 'build', state: 'error' }], 'failure'],
  ['unknown conclusion', [{ ...check, conclusion: 'new_state' }], [], 'unknown'],
  ['neutral and skipped', [{ ...check, conclusion: 'neutral' }, { ...check, conclusion: 'skipped' }], [], 'no_success'],
  ['only skipped', [{ ...check, conclusion: 'skipped' }], [], 'no_success'],
  ['only neutral', [{ ...check, conclusion: 'neutral' }], [], 'no_success'],
  ['success with neutral and skipped', [check, { ...check, conclusion: 'neutral' }, { ...check, conclusion: 'skipped' }], [], 'success'],
  ['legacy success with skipped check', [{ ...check, conclusion: 'skipped' }], [{ state: 'success' }], 'success'],
]) test(name, async () => {
  const s = await collect(fixture({ checks, statuses }));
  assert.equal(s.pullRequests[0].ci.conclusion, expected);
  assert.equal(s.pullRequests[0].possibleHumanAcceptance.value, expected === 'success');
});
test('wrong check SHA is excluded, never green', async () => {
  const s = await collect(fixture({ checks: [{ ...check, head_sha: other }] }));
  assert.equal(s.status, 'partial');
  assert.equal(s.pullRequests[0].ci.conclusion, 'unknown');
  assert.equal(s.pullRequests[0].ci.checks.length, 0);
});
test('wrong combined-status SHA is rejected', async () => {
  const s = await collect(fixture({ statusSha: other }));
  assert.equal(s.status, 'partial');
  assert.equal(s.pullRequests[0].ci.conclusion, 'unknown');
});
test('API error preserves successful independent results', async () => {
  const s = await collect(fixture({ fail: '/check-runs?' }));
  assert.equal(s.status, 'partial');
  assert.equal(s.issues.length, 1);
  assert.equal(s.pullRequests[0].ci.conclusion, 'unknown');
});
test('list failures distinguish error from a genuine empty repository', async () => {
  const s = await collect(fixture({ fail: 'repos/' }));
  assert.equal(s.status, 'error');
  assert.equal(s.pagination.issues.returned, null);
  assert.equal(s.errors.length, 2);
  assert.match(renderText(s), /ERROR/);
});
test('partial issue list does not discard PR facts', async () => {
  const s = await collect(fixture({ fail: '/issues?' }));
  assert.equal(s.status, 'partial');
  assert.equal(s.pullRequests[0].headSha, sha);
});
test('malformed lists do not turn into an empty complete result', async () => {
  const s = await collect(fixture({ issues: {}, prs: [{ ...pr, head: {} }] }));
  assert.equal(s.status, 'error');
});
test('text references and PASS never create associations or review evidence', async () => {
  const s = await collect(fixture());
  assert.equal(s.issues[0].association.status, 'unlinked');
  assert.equal(s.issues[0].possibleHumanAcceptance.value, false);
  assert.deepEqual(s.pullRequests[0].association.issues, []);
});
test('only same-repository structured references connect issues', async () => {
  const refs = [{ number: 1, repository: { nameWithOwner: 'elsewhere/repo' } }];
  const s1 = await collect(fixture({ refs }));
  assert.equal(s1.issues[0].association.status, 'unlinked');
  const s2 = await collect(fixture({ refs: [...refs, { number: 1, repository: { nameWithOwner: 'OWNER/repo' } }] }));
  assert.equal(s2.issues[0].association.status, 'linked');
  assert.equal(s2.issues[0].association.pullRequests[0].headSha, sha);
});
test('HEAD changes during association read never attach new-head associations to old HEAD', async () => {
  const s = await collect(fixture({ graph: { data: { repository: { p2: { headRefOid: other, closingIssuesReferences: { nodes: [{ number: 1, repository: { nameWithOwner: 'owner/repo' } }], pageInfo: { hasNextPage: false } } } } } } }));
  assert.equal(s.status, 'partial');
  assert.equal(s.issues[0].association.status, 'unknown');
  assert.equal(s.pullRequests[0].headSha, sha);
});
test('GraphQL partial data preserves valid association but marks overall partial', async () => {
  const client = fixture();
  const graph = await client.associations();
  graph.errors = [{ message: 'partial' }];
  const s = await collect(fixture({ graph }));
  assert.equal(s.status, 'partial');
  assert.equal(s.pullRequests[0].association.status, 'complete');
});
test('association authorization failure leaves association unknown', async () => {
  const client = fixture();
  client.associations = async () => { throw new Error('No permission'); };
  const s = await collect(client);
  assert.equal(s.status, 'partial');
  assert.equal(s.issues[0].association.status, 'unknown');
});
test('bounded pages expose potential truncation and earlier omissions', async () => {
  const client = fixture();
  const s = await collect(client, { limit: 1, page: 2 });
  assert.equal(s.status, 'partial');
  assert.equal(s.pagination.issues.more, 'possible');
  assert.equal(s.pagination.pullRequests.earlierPagesOmitted, true);
  assert.ok(client.calls[0].includes('per_page=1&page=2'));
  assert.match(renderText(s), /use --page 3/);
});
test('truncated checks cannot yield green inference', async () => {
  const s = await collect(fixture({ checkCount: 101 }));
  assert.equal(s.status, 'partial');
  assert.equal(s.pullRequests[0].ci.conclusion, 'unknown');
  assert.equal(s.pullRequests[0].possibleHumanAcceptance.value, false);
});
test('truncated legacy statuses and references are marked partial', async () => {
  const client = fixture({ statuses: [{ state: 'success' }], statusCount: 101 });
  const graph = await client.associations();
  graph.data.repository.p2.closingIssuesReferences.pageInfo.hasNextPage = true;
  client.associations = async () => graph;
  const s = await collect(client);
  assert.equal(s.status, 'partial');
  assert.equal(s.pullRequests[0].ci.conclusion, 'unknown');
  assert.equal(s.pullRequests[0].association.status, 'partial');
});
test('needs-user labels suggest inspection, never alter factual state', async () => {
  const s = await collect(fixture({ issues: [{ ...issue, labels: [{ name: 'needs-user' }] }] }));
  assert.equal(s.issues[0].possibleHumanAcceptance.value, true);
  assert.equal(s.issues[0].state, 'open');
  assert.equal(s.issues[0].possibleHumanAcceptance.kind, 'inference');
});
test('terminal text neutralizes control codes from remote titles', async () => {
  const s = await collect(fixture({ issues: [{ ...issue, title: '\u001b[31mEVIL\nFORGED\u202e' }] }));
  const rendered = renderText(s);
  assert.equal(rendered.includes(String.fromCharCode(27)), false);
  assert.doesNotMatch(rendered, /\u202e|\nFORGED/);
});
test('client uses gh executable with GET/read-only GraphQL and no shell', async () => {
  const calls = [];
  const client = createGitHubClient({ run: async (...args) => { calls.push(args); return { stdout: '{}' }; } });
  await client.get('repos/owner/repo/issues');
  await client.associations('owner/repo', [2]);
  assert.equal(calls[0][0], 'gh');
  assert.deepEqual(calls[0][1], ['api', '--hostname', 'github.com', '--method', 'GET', 'repos/owner/repo/issues']);
  assert.equal(calls[0][2].shell, undefined);
  assert.equal(calls[0][2].timeout, 15000);
  assert.match(calls[1][1].at(-1), /^query=query /);
  assert.doesNotMatch(calls[1][1].at(-1), /mutation/);
});
for (const [code, expected] of [['ENOENT', /not installed/], ['ETIMEDOUT', /timed out/], [1, /gh auth status/]]) test(`client error ${code} is actionable and redacts raw stderr`, async () => {
  const client = createGitHubClient({ run: async () => { throw Object.assign(new Error('SECRET'), { code, stderr: 'SECRET' }); } });
  await assert.rejects(client.get('repos/owner/repo/issues'), (e) => expected.test(e.message) && !e.message.includes('SECRET'));
});
test('invalid JSON response fails explicitly', async () => {
  const client = createGitHubClient({ run: async () => ({ stdout: 'not-json' }) });
  await assert.rejects(client.get('repos/owner/repo/issues'), /invalid JSON/);
});
test('CLI validates inputs before queries and supports help', () => {
  for (const args of [[], ['--repo', '../oops'], ['--repo', 'a/b', '--limit', '31'], ['--repo', 'a/b', '--page', '0'], ['--repo', 'a/b', '--page', '1.5'], ['--repo', 'a/b', '--limit'], ['--unknown'], ['--json', '--json']]) assert.throws(() => parseArgs(args));
  assert.equal(parseArgs(['--help']).help, true);
});
test('CLI JSON, terminal, usage errors and exit codes are usable', async () => {
  const output = [];
  const out = (text) => output.push(text);
  assert.equal(await main(['--repo', 'owner/repo', '--json'], { client: fixture(), out }), 0);
  assert.equal(JSON.parse(output.pop()).pullRequests[0].headSha, sha);
  assert.equal(await main(['--repo', 'owner/repo', '--limit', '1'], { client: fixture(), out }), 2);
  assert.match(output.pop(), /partial/);
  assert.equal(await main(['--repo', 'owner/repo', '--json'], { client: fixture({ fail: 'repos/' }), out }), 1);
  assert.equal(JSON.parse(output.pop()).status, 'error');
  assert.equal(await main(['--json'], { client: fixture(), out }), 1);
  assert.equal(JSON.parse(output.pop()).status, 'error');
});

test('real CLI subprocess uses gh adapter for text and JSON (fake gh, no account)', { skip: process.platform === 'win32' }, async () => {
  const { mkdtemp, writeFile, chmod, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const dir = await mkdtemp(join(tmpdir(), 'task-status-test-'));
  try {
    const executable = join(dir, 'gh');
    await writeFile(executable, `#!/usr/bin/env node\nconst arg = process.argv.at(-1);\nif (arg.includes('/issues?')) console.log(JSON.stringify([${JSON.stringify(issue)}]));\nelse if (arg.includes('/pulls?')) console.log('[]');\nelse process.exit(7);\n`);
    await chmod(executable, 0o755);
    const run = promisify(execFile);
    const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    const json = await run(process.execPath, [cli, '--repo', 'owner/repo', '--json'], { env });
    assert.equal(JSON.parse(json.stdout).issues[0].number, 1);
    const text = await run(process.execPath, [cli, '--repo', 'owner/repo'], { env });
    assert.match(text.stdout, /loaded 1 issues, 0 PRs/);
    assert.match(text.stdout, /not an atomic snapshot/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('review verdict resolution parses explicit verdict even when text mentions PASS', async () => {
  const blockedReview = {
    id: 101,
    user: 'reviewer',
    body: '当前 HEAD 不能 PASS。静态审查发现多项 P1 问题。\n**裁定：BLOCKED**',
    state: 'commented',
    commit_id: sha,
  };
  const s = await collect(fixture({ reviews: [blockedReview] }));
  assert.equal(s.pullRequests[0].review.verdict, 'blocked');

  const reviseReview = {
    id: 102,
    user: 'reviewer',
    body: '本次改动不能直接 PASS，需要修改。\n**裁定：REVISE**',
    state: 'commented',
    commit_id: sha,
  };
  const s2 = await collect(fixture({ reviews: [reviseReview] }));
  assert.equal(s2.pullRequests[0].review.verdict, 'revise');

  const passReview = {
    id: 103,
    user: 'reviewer',
    body: '所有测试通过。\n**裁定：PASS**',
    state: 'commented',
    commit_id: sha,
  };
  const s3 = await collect(fixture({ reviews: [passReview] }));
  assert.equal(s3.pullRequests[0].review.verdict, 'pass');

  // Quoted historical PASS with current BLOCKED must yield blocked
  const quotedReview = {
    id: 104,
    user: 'reviewer',
    body: '> 上一轮 **裁定：PASS**\n本轮存在阻断项。\n**裁定：BLOCKED**',
    state: 'commented',
    commit_id: sha,
  };
  const s4 = await collect(fixture({ reviews: [quotedReview] }));
  assert.equal(s4.pullRequests[0].review.verdict, 'blocked');

  // Explicit historical narrative with current BLOCKED must yield blocked
  const narrativeReview = {
    id: 105,
    user: 'reviewer',
    body: '上一轮 **裁定：PASS**，本轮 **裁定：BLOCKED**',
    state: 'commented',
    commit_id: sha,
  };
  const s5 = await collect(fixture({ reviews: [narrativeReview] }));
  assert.equal(s5.pullRequests[0].review.verdict, 'blocked');

  // Explicit BLOCKED overrides approved GitHub review state (fail-closed)
  const approvedConflict = {
    id: 106,
    user: 'reviewer',
    body: '需要重新修复，不得合并。\n**裁定：BLOCKED**',
    state: 'approved',
    commit_id: sha,
  };
  const s6 = await collect(fixture({ reviews: [approvedConflict] }));
  assert.equal(s6.pullRequests[0].review.verdict, 'blocked');
});

test('comments 500-cap truncation records error and marks snapshot partial', async () => {
  const pageItems = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, body: 'comment', user: 'u' }));
  const s = await collect(fixture({ comments: () => pageItems }));
  assert.equal(s.status, 'partial');
  assert.equal(s.issues[0].commentsTruncated, true);
  assert.equal(s.issues[0].comments.length, 500);
  assert.ok(s.errors.some((e) => e.message.includes('Comments truncated at 500 items')));
});

test('reviews 500-cap truncation records error and marks snapshot partial', async () => {
  const pageItems = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, body: 'review', user: 'u', state: 'commented' }));
  const s = await collect(fixture({ reviews: () => pageItems }));
  assert.equal(s.status, 'partial');
  assert.equal(s.pullRequests[0].reviewsTruncated, true);
  assert.equal(s.pullRequests[0].reviews.length, 500);
  assert.ok(s.errors.some((e) => e.message.includes('Reviews truncated at 500 items')));
});

test('non-array comments or reviews response records error and marks snapshot partial', async () => {
  const s1 = await collect(fixture({ comments: { not: 'an array' } }));
  assert.equal(s1.status, 'partial');
  assert.ok(s1.errors.some((e) => e.message.includes('Non-array response for comments')));

  const s2 = await collect(fixture({ reviews: { not: 'an array' } }));
  assert.equal(s2.status, 'partial');
  assert.ok(s2.errors.some((e) => e.message.includes('Non-array response for reviews')));
});

test('query exceptions including Unexpected query are never ignored and mark partial', async () => {
  const s1 = await collect(fixture({ comments: () => { throw new Error('Unexpected query'); } }));
  assert.equal(s1.status, 'partial');
  assert.ok(s1.errors.some((e) => e.message.includes('Unexpected query')));

  const s2 = await collect(fixture({ reviews: () => { throw new Error('Unexpected query'); } }));
  assert.equal(s2.status, 'partial');
  assert.ok(s2.errors.some((e) => e.message.includes('Unexpected query')));
});
