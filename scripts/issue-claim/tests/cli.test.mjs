import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { EXIT, heartbeat, identityFromPs, identityFromProcStat, main, processIdentity, takeover, watchClaim } from '../cli.mjs';

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
function plantStaleClaim(dir, issue, agent, { force = false } = {}) {
  const tree = git(dir, 'mktree');
  const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const env = { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.invalid', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.invalid' };
  const made = spawnSync('git', ['commit-tree', tree, '-m', `claim #${issue}\n\nagent: ${agent}\nat: ${old}\n`], { cwd: dir, encoding: 'utf8', env });
  assert.equal(made.status, 0, made.stderr);
  git(dir, 'push', '--quiet', ...(force ? ['--force'] : []), 'origin', `${made.stdout.trim()}:refs/heads/claim/${issue}`);
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
  // A heartbeat cannot be backdated through the exported API to make a live claim look stale.
  assert.equal(heartbeat(92, 'busy', { cwd: a, now: new Date(Date.now() - 3 * 3600 * 1000) }).ok, true);
  assert.equal(takeover(92, 'rescuer', 'x', { cwd: b }).ok, false);
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

test('a claim stamped in the future is not ACTIVE: it needs a human look', () => {
  const [a] = clones;
  const tree = git(a, 'mktree');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.invalid', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.invalid' };
  const future = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const made = spawnSync('git', ['commit-tree', tree, '-m', `claim #95\n\nagent: skewed\nat: ${future}\n`], { cwd: a, encoding: 'utf8', env });
  git(a, 'push', '--quiet', 'origin', `${made.stdout.trim()}:refs/heads/claim/95`);
  assert.match(run(a, ['inspect', '95']).out, /^HANDOFF_BLOCKED .*clock anomaly/);
  assert.equal(run(a, ['takeover', '95', '--agent', 'x', '--stopped-evidence', 'y']).code, EXIT.held);
  assert.equal(run(a, ['release', '95', '--agent', 'skewed']).code, EXIT.ok);
});

test('watchClaim beats while the same process lives and stops when it exits or its pid is reused', async () => {
  const [a] = clones;
  assert.equal(run(a, ['claim', '96', '--agent', 'worker']).code, EXIT.ok);
  const identities = ['start-1', 'start-1', 'start-1', 'someone-else'];
  const reused = await watchClaim(96, 'worker', { cwd: a, pid: 1, intervalMs: 0, identityOf: () => identities.shift() });
  assert.deepEqual({ stopped: reused.stopped, beats: reused.beats }, { stopped: 'process-exited', beats: 2 });
  const gone = await watchClaim(96, 'worker', { cwd: a, pid: 1, intervalMs: 0, identityOf: () => undefined });
  assert.deepEqual({ stopped: gone.stopped, beats: gone.beats }, { stopped: 'unverifiable', beats: 0 });
  assert.equal(run(a, ['release', '96', '--agent', 'worker']).code, EXIT.ok);
});

test('watchClaim stops as fenced once the claim has moved on', async () => {
  const [a, b] = clones;
  // Forced here, since a fresh beat is not stale: the next beat must fail instead of writing again.
  assert.equal(run(a, ['claim', '97', '--agent', 'old-owner']).code, EXIT.ok);
  const result = await watchClaim(97, 'old-owner', {
    cwd: a,
    pid: 1,
    intervalMs: 0,
    identityOf: () => 'same',
    sleep: async () => {
      plantStaleClaim(b, 97, 'rescuer', { force: true });
    },
  });
  assert.equal(result.stopped, 'fenced');
  assert.equal(result.holder.agent, 'rescuer');
  assert.equal(run(b, ['release', '97', '--agent', 'rescuer']).code, EXIT.ok);
});

test('watch CLI refuses a process it cannot identify and rejects bad input', async () => {
  const [a] = clones;
  assert.equal(run(a, ['claim', '98', '--agent', 'w']).code, EXIT.ok);
  const dead = spawnSync(process.execPath, ['-e', '0']);
  const errors = [];
  assert.equal(await main(['watch', '98', '--agent', 'w', '--pid', String(dead.pid ?? 999999)], { cwd: a, out: () => {}, err: (line) => errors.push(line) }), EXIT.error);
  assert.match(errors.join('\n'), /cannot verify the identity/);
  assert.equal(await main(['watch', '98', '--agent', 'w', '--pid', 'abc'], { cwd: a, out: () => {}, err: () => {} }), EXIT.error);
  assert.equal(run(a, ['release', '98', '--agent', 'w']).code, EXIT.ok);
});

test('processIdentity is stable for a live process and absent for a dead one', () => {
  const mine = processIdentity(process.pid);
  assert.ok(mine, 'own process identity is readable');
  assert.equal(processIdentity(process.pid), mine);
  const dead = spawnSync(process.execPath, ['-e', '0']);
  assert.equal(processIdentity(dead.pid), undefined);
});

test('process identity parsers treat zombies as gone and keep a stable start-time fingerprint', () => {
  const live = '1234 (my cmd) with ) paren) S 1 1234 1234 0 -1 4194560 100 0 0 0 1 1 0 0 20 0 1 0 98765 1000 100 18446744073709551615';
  assert.equal(identityFromProcStat(live), 'proc:98765');
  assert.equal(identityFromProcStat(live.replace(') S ', ') Z ')), undefined);
  assert.equal(identityFromProcStat(live.replace(') S ', ') X ')), undefined);
  assert.equal(identityFromProcStat('garbage'), undefined);
  assert.equal(identityFromPs('S Sat Oct 24 02:00:00 2026'), 'Sat Oct 24 02:00:00 2026');
  assert.equal(identityFromPs('Z+ Sat Oct 24 02:00:00 2026'), undefined);
  assert.equal(identityFromPs(''), undefined);
});

test('a killed but unreaped child stops being "alive" (Unix only)', { skip: process.platform === 'win32' }, async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const before = processIdentity(child.pid);
  assert.ok(before);
  child.kill('SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 300));
  // Node reaps the child on exit, so this checks the dead-process path; the parser tests above cover Z.
  assert.equal(processIdentity(child.pid), undefined);
});
