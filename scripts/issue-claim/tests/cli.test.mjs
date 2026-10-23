import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { EXIT, main, takeover } from '../cli.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');
let root;
let clones;

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function run(cwd, argv) {
  const lines = { out: [], err: [] };
  const code = main(argv, { cwd, out: (line) => lines.out.push(line), err: (line) => lines.err.push(line) });
  return { code, out: lines.out.join('\n'), err: lines.err.join('\n') };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'issue-claim-'));
  const origin = join(root, 'origin.git');
  git(root, 'init', '--bare', '--quiet', origin);
  clones = ['a', 'b', 'c'].map((name) => {
    const dir = join(root, name);
    git(root, 'clone', '--quiet', origin, dir);
    git(dir, 'config', 'user.name', `agent-${name}`);
    git(dir, 'config', 'user.email', `${name}@example.invalid`);
    return dir;
  });
});

after(() => rmSync(root, { recursive: true, force: true }));

test('the first claim wins and a second agent is told who holds it', () => {
  const [a, b] = clones;
  assert.equal(run(a, ['claim', '80', '--agent', 'Codex / s1']).code, EXIT.ok);
  const second = run(b, ['claim', '#80', '--agent', 'WorkBuddy / s2']);
  assert.equal(second.code, EXIT.held);
  assert.match(second.err, /claimed by Codex \/ s1/);
  assert.match(run(b, ['show']).out, /#80 claimed by Codex \/ s1 at \d{4}-/);
});

test('only the holder releases, after which the issue can be claimed again', () => {
  const [a, b] = clones;
  assert.equal(run(b, ['release', '80', '--agent', 'WorkBuddy / s2']).code, EXIT.held);
  assert.equal(run(a, ['release', '80', '--agent', 'Codex / s1']).code, EXIT.ok);
  assert.equal(run(b, ['show', '80']).out, 'no claims');
  assert.equal(run(b, ['claim', '80', '--agent', 'WorkBuddy / s2']).code, EXIT.ok);
  assert.equal(run(b, ['release', '80', '--agent', 'WorkBuddy / s2']).code, EXIT.ok);
});

test('three processes claiming at once: exactly one succeeds', async () => {
  const codes = await Promise.all(
    clones.map(
      (dir, index) =>
        new Promise((resolve) => {
          const child = spawn(process.execPath, [CLI, 'claim', '81', '--agent', `agent-${index}`], { cwd: dir, stdio: 'ignore' });
          child.on('exit', resolve);
        }),
    ),
  );
  assert.deepEqual(codes.filter((code) => code === EXIT.ok).length, 1);
  assert.deepEqual(codes.filter((code) => code === EXIT.held).length, 2);
});

test('the same holder claiming again resumes instead of being refused', () => {
  const [a] = clones;
  assert.equal(run(a, ['claim', '83', '--agent', 'Codex / s1']).code, EXIT.ok);
  const again = run(a, ['claim', '83', '--agent', 'Codex / s1']);
  assert.equal(again.code, EXIT.ok);
  assert.match(again.out, /resuming/);
  assert.equal(run(a, ['release', '83', '--agent', 'Codex / s1']).code, EXIT.ok);
});

test('claim commits carry the fixed tool identity, not the local git user', () => {
  const [a] = clones;
  assert.equal(run(a, ['claim', '84', '--agent', 'Codex / s1']).code, EXIT.ok);
  git(a, 'fetch', '--quiet', 'origin', 'refs/heads/claim/84');
  const who = git(a, 'log', '-1', '--format=%an <%ae> / %cn <%ce>', 'FETCH_HEAD');
  assert.equal(who, 'ai-one issue-claim <issue-claim@ai-one.invalid> / ai-one issue-claim <issue-claim@ai-one.invalid>');
  assert.equal(run(a, ['release', '84', '--agent', 'Codex / s1']).code, EXIT.ok);
});

test('a stale lease cannot delete a newer claim', () => {
  const [a, b] = clones;
  assert.equal(run(a, ['claim', '85', '--agent', 'old']).code, EXIT.ok);
  const stale = git(a, 'ls-remote', 'origin', 'refs/heads/claim/85').split(/\s+/)[0];
  assert.equal(run(a, ['release', '85', '--agent', 'old']).code, EXIT.ok);
  assert.equal(run(b, ['claim', '85', '--agent', 'new']).code, EXIT.ok);
  const refused = spawnSync('git', ['push', `--force-with-lease=refs/heads/claim/85:${stale}`, 'origin', ':refs/heads/claim/85'], { cwd: a, encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(run(a, ['show', '85']).out, /claimed by new/);
  assert.equal(run(b, ['release', '85', '--agent', 'new']).code, EXIT.ok);
});

test('bad arguments are a usage error, not a claim', () => {
  assert.equal(run(clones[0], ['claim', '82']).code, EXIT.error);
  assert.equal(run(clones[0], ['claim', 'abc', '--agent', 'x']).code, EXIT.error);
  assert.equal(run(clones[0], ['claim', '0', '--agent', 'x']).code, EXIT.error);
  assert.equal(run(clones[0], ['claim', '99999999999999999999', '--agent', 'x']).code, EXIT.error);
  assert.equal(run(clones[0], ['show']).out.includes('#82'), false);
});

test('heartbeat keeps the claim alive; only the holder can beat', () => {
  const [a, b] = clones;
  assert.equal(run(a, ['claim', '90', '--agent', 'holder']).code, EXIT.ok);
  assert.match(run(a, ['inspect', '90']).out, /^ACTIVE #90 claimed by holder/);
  assert.equal(run(a, ['heartbeat', '90', '--agent', 'holder']).code, EXIT.ok);
  const other = run(b, ['heartbeat', '90', '--agent', 'intruder']);
  assert.equal(other.code, EXIT.held);
  assert.match(other.err, /not the holder/);
  assert.equal(run(b, ['heartbeat', '91', '--agent', 'holder']).code, EXIT.held);
  assert.match(run(b, ['show', '90']).out, /claimed by holder/);
  assert.equal(run(a, ['release', '90', '--agent', 'holder']).code, EXIT.ok);
});

// Plants a claim whose last sign of life is long past, as an agent that died without releasing.
function plantStaleClaim(dir, issue, agent) {
  const tree = git(dir, 'mktree');
  const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const env = { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.invalid', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.invalid' };
  const made = spawnSync('git', ['commit-tree', tree, '-m', `claim #${issue}\n\nagent: ${agent}\nat: ${old}\n`], { cwd: dir, encoding: 'utf8', env });
  assert.equal(made.status, 0, made.stderr);
  git(dir, 'push', '--quiet', 'origin', `${made.stdout.trim()}:refs/heads/claim/${issue}`);
}

test('a live claim cannot be taken, and the window is not a takeover option', () => {
  const [a, b] = clones;
  assert.equal(run(a, ['claim', '92', '--agent', 'busy']).code, EXIT.ok);
  const early = run(b, ['takeover', '92', '--agent', 'rescuer', '--stopped-evidence', 'killed pid 1']);
  assert.equal(early.code, EXIT.held);
  assert.match(early.err, /HANDOFF_BLOCKED/);
  // Neither a shrunk window nor an injected future clock can make a live holder look stale.
  const shrunk = run(b, ['takeover', '92', '--agent', 'rescuer', '--stopped-evidence', 'x', '--suspect-after-min', '0.0001']);
  assert.equal(shrunk.code, EXIT.error);
  const future = takeover(92, 'rescuer', 'x', { cwd: b, now: new Date(Date.now() + 3600 * 1000) });
  assert.equal(future.ok, false);
  assert.match(run(b, ['show', '92']).out, /claimed by busy/);
  assert.match(run(b, ['inspect', '92', '--suspect-after-min', '0.0001']).out, /^SUSPECT_STALE .*not safe to take automatically/);
  assert.equal(run(a, ['release', '92', '--agent', 'busy']).code, EXIT.ok);
});

test('takeover of a stale claim needs evidence, records it, bumps the generation and fences the old holder', () => {
  const [a, b] = clones;
  plantStaleClaim(a, 93, 'old');
  assert.match(run(b, ['inspect', '93']).out, /^SUSPECT_STALE/);
  assert.equal(run(b, ['takeover', '93', '--agent', 'new']).code, EXIT.error);
  assert.equal(run(b, ['takeover', '93', '--agent', 'new', '--stopped-evidence', '   ']).code, EXIT.error);
  assert.throws(() => takeover(93, 'new', undefined, { cwd: b }), /evidence/);
  assert.match(run(b, ['show', '93']).out, /claimed by old/);
  const taken = run(b, ['takeover', '93', '--agent', 'new', '--stopped-evidence', 'process killed, confirmed by user']);
  assert.equal(taken.code, EXIT.ok, taken.err);
  assert.match(taken.out, /generation 2/);
  git(b, 'fetch', '--quiet', 'origin', 'refs/heads/claim/93');
  const message = git(b, 'log', '-1', '--format=%B', 'FETCH_HEAD');
  assert.match(message, /took-over-from: old/);
  assert.match(message, /process killed, confirmed by user/);
  assert.match(run(b, ['inspect', '93']).out, /^ACTIVE #93 claimed by new .* gen 2/);
  assert.equal(run(a, ['heartbeat', '93', '--agent', 'old']).code, EXIT.held);
  assert.equal(run(a, ['release', '93', '--agent', 'old']).code, EXIT.held);
  assert.equal(run(b, ['heartbeat', '93', '--agent', 'new']).code, EXIT.ok);
  assert.equal(run(b, ['release', '93', '--agent', 'new']).code, EXIT.ok);
});

test('two rescuers racing for a stale claim: exactly one wins', async () => {
  const [a, b, c] = clones;
  plantStaleClaim(a, 94, 'old');
  const codes = await Promise.all(
    [b, c].map(
      (dir, index) =>
        new Promise((resolve) => {
          const child = spawn(process.execPath, [CLI, 'takeover', '94', '--agent', `rescuer-${index}`, '--stopped-evidence', 'confirmed'], { cwd: dir, stdio: 'ignore' });
          child.on('exit', resolve);
        }),
    ),
  );
  assert.equal(codes.filter((code) => code === EXIT.ok).length, 1);
  assert.equal(codes.filter((code) => code === EXIT.held).length, 1);
  assert.match(run(a, ['show', '94']).out, /^#94 claimed by rescuer-\d/);
});
