#!/usr/bin/env node
// Issue claim lock (Issue #77). All agents share one GitHub account, so assignees and comments
// cannot tell them apart. The only reliable guard is an atomic create: the ref
// refs/heads/claim/<N> is pushed with an empty lease ("must not exist yet"), so of two agents
// claiming at once exactly one succeeds. The ref points at an empty commit whose message records
// who holds it. Release deletes it with a lease on that commit.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EXIT = { ok: 0, error: 1, held: 2 };

// Claim commits never carry the local git identity (a real name or private email would be pushed
// with every claim) and must not depend on one being configured.
const CLAIM_IDENTITY = {
  GIT_AUTHOR_NAME: 'ai-one issue-claim',
  GIT_AUTHOR_EMAIL: 'issue-claim@ai-one.invalid',
  GIT_COMMITTER_NAME: 'ai-one issue-claim',
  GIT_COMMITTER_EMAIL: 'issue-claim@ai-one.invalid',
};

const USAGE = `usage:
  node scripts/issue-claim/cli.mjs claim <N> --agent "<tool / session>"
  node scripts/issue-claim/cli.mjs show [<N>]
  node scripts/issue-claim/cli.mjs release <N> --agent "<tool / session>"
  node scripts/issue-claim/cli.mjs heartbeat <N> --agent "<tool / session>"
  node scripts/issue-claim/cli.mjs inspect [<N>] [--suspect-after-min 30]   (inspect only; takeover always uses the default window)
  node scripts/issue-claim/cli.mjs takeover <N> --agent "<new tool / session>" --stopped-evidence "<how the old writer is known to have stopped>"
options: --remote <name> (default origin)`;

function git(args, { cwd, input, env, allowFail = false } = {}) {
  const result = spawnSync('git', args, { cwd, input: input ?? '', encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    throw new Error(`git ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, remote: 'origin' };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (['--agent', '--remote', '--stopped-evidence', '--suspect-after-min'].includes(arg)) {
      const value = rest[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      options[arg.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = value;
      i += 1;
    } else if (/^#?\d+$/.test(arg) && options.issue === undefined) {
      const issue = Number(arg.replace('#', ''));
      if (!Number.isSafeInteger(issue) || issue <= 0) throw new Error(`not an issue number: ${arg}`);
      options.issue = issue;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const refFor = (issue) => `refs/heads/claim/${issue}`;

/** Holder message of the claim commit, or undefined when the issue is not claimed. */
function readClaim(issue, { cwd, remote }) {
  const listed = git(['ls-remote', remote, refFor(issue)], { cwd }).stdout;
  if (!listed) return undefined;
  const sha = listed.split(/\s+/)[0];
  git(['fetch', '--quiet', remote, `${refFor(issue)}`], { cwd });
  const message = git(['log', '-1', '--format=%B', sha], { cwd }).stdout;
  const agent = /^agent: (.*)$/m.exec(message)?.[1];
  const at = /^at: (.*)$/m.exec(message)?.[1];
  const beat = /^beat: (.*)$/m.exec(message)?.[1];
  const generation = Number(/^generation: (\d+)$/m.exec(message)?.[1] ?? 1);
  return { sha, agent, at, beat, generation, message };
}

export function claim(issue, agent, { cwd, remote = 'origin', now = new Date() } = {}) {
  // Same holder (same tool + session string) resuming: keep the existing claim instead of failing.
  const existing = readClaim(issue, { cwd, remote });
  if (existing) return existing.agent === agent ? { ok: true, sha: existing.sha, resumed: true } : { ok: false, holder: existing };
  const emptyTree = git(['mktree'], { cwd, input: '' }).stdout;
  const message = `claim #${issue}

agent: ${agent}
at: ${now.toISOString()}
`;
  const commit = git(['commit-tree', emptyTree, '-m', message], { cwd, env: CLAIM_IDENTITY }).stdout;
  const pushed = git(['push', '--porcelain', `--force-with-lease=${refFor(issue)}:`, remote, `${commit}:${refFor(issue)}`], {
    cwd,
    allowFail: true,
  });
  if (pushed.status === 0) return { ok: true, sha: commit };
  // The push may have landed even though it reported failure (connection dropped after the update):
  // the claim is ours exactly when the remote ref points at the commit we just made.
  const holder = readClaim(issue, { cwd, remote });
  if (holder?.sha === commit) return { ok: true, sha: commit };
  if (holder) return { ok: false, holder };
  throw new Error(`push failed: ${pushed.stderr || pushed.stdout}`);
}

export function release(issue, agent, { cwd, remote = 'origin' } = {}) {
  const holder = readClaim(issue, { cwd, remote });
  if (!holder) return { ok: true, released: false };
  if (holder.agent !== agent) return { ok: false, holder };
  // Lease on the claim we just read: if someone re-claimed in between, the delete is refused.
  const pushed = git(['push', '--porcelain', `--force-with-lease=${refFor(issue)}:${holder.sha}`, remote, `:${refFor(issue)}`], {
    cwd,
    allowFail: true,
  });
  if (pushed.status === 0) return { ok: true, released: true };
  // Uncertain result: read back instead of guessing.
  const after = readClaim(issue, { cwd, remote });
  if (!after) return { ok: true, released: true };
  if (after.sha !== holder.sha) return { ok: false, holder: after };
  throw new Error(`release failed: ${pushed.stderr || pushed.stdout}`);
}

// Lease liveness (Issue #139). A heartbeat is a child commit on claim/<N> pushed with a lease on the
// previous claim commit, so a stale writer can never overwrite a newer holder. Only the holder
// beats. The states are evidence for a human or coordinator: a missed heartbeat never lets anyone
// delete or take the claim by itself, because all agents share one GitHub credential and nothing
// fences the old writer's pushes to the feature branch.
export const DEFAULT_SUSPECT_AFTER_MIN = 30;

function commitClaim(issue, { agent, at, beat, generation, takeoverFrom, evidence }, parent, { cwd }) {
  const emptyTree = git(['mktree'], { cwd, input: '' }).stdout;
  const handover = takeoverFrom ? `took-over-from: ${takeoverFrom}\nstopped-evidence (stated by the new holder, not verified): ${evidence}\n` : '';
  const message = `claim #${issue}\n\nagent: ${agent}\nat: ${at}\n${beat ? `beat: ${beat}\n` : ''}generation: ${generation}\n${handover}`;
  const args = ['commit-tree', emptyTree, ...(parent ? ['-p', parent] : []), '-m', message];
  return git(args, { cwd, env: CLAIM_IDENTITY }).stdout;
}

/** Pushes `commit` over the claim ref only if it still points at `expected`; reads back when unsure. */
function advanceClaim(issue, expected, commit, { cwd, remote }) {
  const pushed = git(['push', '--porcelain', `--force-with-lease=${refFor(issue)}:${expected}`, remote, `${commit}:${refFor(issue)}`], {
    cwd,
    allowFail: true,
  });
  if (pushed.status === 0) return { ok: true, sha: commit };
  const after = readClaim(issue, { cwd, remote });
  if (after?.sha === commit) return { ok: true, sha: commit };
  if (after) return { ok: false, holder: after };
  throw new Error(`claim update failed: ${pushed.stderr || pushed.stdout}`);
}

export function heartbeat(issue, agent, { cwd, remote = 'origin', now = new Date() } = {}) {
  const holder = readClaim(issue, { cwd, remote });
  if (!holder) return { ok: false, missing: true };
  if (holder.agent !== agent) return { ok: false, holder };
  const commit = commitClaim(issue, { agent, at: holder.at, beat: now.toISOString(), generation: holder.generation }, holder.sha, { cwd });
  return advanceClaim(issue, holder.sha, commit, { cwd, remote });
}

/** ACTIVE: beat (or claim time) is recent. SUSPECT_STALE: silent past the window; observe only. */
export function assess(holder, { now = new Date(), suspectAfterMin = DEFAULT_SUSPECT_AFTER_MIN } = {}) {
  const last = Date.parse(holder.beat ?? holder.at ?? '');
  if (Number.isNaN(last)) return { state: 'HANDOFF_BLOCKED', reason: 'claim has no readable timestamp' };
  const exactMin = Math.max(0, (now.getTime() - last) / 60000);
  const silentMin = Math.floor(exactMin);
  return exactMin >= suspectAfterMin
    ? { state: 'SUSPECT_STALE', silentMin, reason: `no heartbeat for ${silentMin} min (window ${suspectAfterMin})` }
    : { state: 'ACTIVE', silentMin, reason: `last sign of life ${silentMin} min ago` };
}

/**
 * Manual-exception handover. Only a SUSPECT_STALE claim can be taken, and the caller must say how
 * the old writer is known to have stopped. That statement is recorded, not verified: without a
 * write gateway the old process could still push, so this is for a coordinator or user who has
 * actually stopped it. The swap is a compare-and-swap on the exact old claim commit.
 */
export function takeover(issue, agent, evidence, { cwd, remote = 'origin', now = new Date() } = {}) {
  const statedEvidence = String(evidence ?? '').replace(/\s+/g, ' ').trim();
  if (!statedEvidence) throw new Error('takeover needs non-empty stopped evidence');
  const holder = readClaim(issue, { cwd, remote });
  if (!holder) return { ok: false, missing: true };
  if (holder.agent === agent) return { ok: true, sha: holder.sha, resumed: true };
  // The window is deliberately not a caller option: shrinking it would make a live holder look stale.
  const verdict = assess(holder, { now });
  if (verdict.state !== 'SUSPECT_STALE') return { ok: false, holder, verdict };
  const stamp = now.toISOString();
  const commit = commitClaim(issue, { agent, at: stamp, beat: stamp, generation: holder.generation + 1, takeoverFrom: holder.agent, evidence: statedEvidence }, holder.sha, { cwd });
  const result = advanceClaim(issue, holder.sha, commit, { cwd, remote });
  return result.ok ? { ...result, previous: holder, evidence: statedEvidence } : result;
}

export function list({ cwd, remote = 'origin' } = {}) {
  const listed = git(['ls-remote', remote, 'refs/heads/claim/*'], { cwd }).stdout;
  return listed
    .split('\n')
    .filter(Boolean)
    .map((line) => Number(line.split('refs/heads/claim/')[1]))
    .filter(Number.isInteger)
    .sort((a, b) => a - b)
    .map((issue) => ({ issue, ...readClaim(issue, { cwd, remote }) }));
}

function describe(issue, holder) {
  return `#${issue} claimed by ${holder.agent ?? '(unknown)'} at ${holder.at ?? '(unknown)'}`;
}

export function main(argv, { cwd = process.cwd(), out = console.log, err = console.error } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    err(`${error.message}\n${USAGE}`);
    return EXIT.error;
  }
  const { command, issue, agent, remote } = options;
  try {
    if (command === 'show') {
      const claims = issue === undefined ? list({ cwd, remote }) : [{ issue, ...readClaim(issue, { cwd, remote }) }];
      const held = claims.filter((entry) => entry.sha);
      out(held.length ? held.map((entry) => describe(entry.issue, entry)).join('\n') : 'no claims');
      return EXIT.ok;
    }
    const suspectAfterMin = options.suspectAfterMin === undefined ? undefined : Number(options.suspectAfterMin);
    if (suspectAfterMin !== undefined && !(suspectAfterMin > 0)) throw new Error('--suspect-after-min needs a positive number');
    if (command === 'inspect') {
      const claims = (issue === undefined ? list({ cwd, remote }) : [{ issue, ...readClaim(issue, { cwd, remote }) }]).filter((entry) => entry.sha);
      out(
        claims.length
          ? claims
              .map((entry) => {
                const verdict = assess(entry, { suspectAfterMin });
                const hint = verdict.state === 'SUSPECT_STALE' ? ' -> not safe to take automatically; confirm the old writer stopped, then use takeover' : '';
                return `${verdict.state} ${describe(entry.issue, entry)} gen ${entry.generation}: ${verdict.reason}${hint}`;
              })
              .join('\n')
          : 'no claims',
      );
      return EXIT.ok;
    }
    if (command === 'heartbeat' && issue !== undefined && agent) {
      const result = heartbeat(issue, agent, { cwd, remote });
      if (result.ok) {
        out(`heartbeat #${issue} for ${agent}`);
        return EXIT.ok;
      }
      err(result.missing ? `#${issue} is not claimed` : `not the holder: ${describe(issue, result.holder)}. Stop writing: the claim moved on.`);
      return EXIT.held;
    }
    if (command === 'takeover' && issue !== undefined && agent) {
      if (!options.stoppedEvidence) {
        err('takeover needs --stopped-evidence "<how the old writer is known to have stopped>"');
        return EXIT.error;
      }
      const result = takeover(issue, agent, options.stoppedEvidence, { cwd, remote });
      if (result.ok) {
        out(
          result.resumed
            ? `#${issue} is already held by ${agent}`
            : `took over #${issue} from ${result.previous.agent}; generation ${result.previous.generation + 1}. Stop evidence is recorded as stated, not verified: ${result.evidence}`,
        );
        return EXIT.ok;
      }
      err(
        result.missing
          ? `#${issue} is not claimed; use claim`
          : result.verdict
            ? `HANDOFF_BLOCKED: ${describe(issue, result.holder)} is ${result.verdict.state} (${result.verdict.reason}); not taken.`
            : `lost the race: ${describe(issue, result.holder)}`,
      );
      return EXIT.held;
    }
    if ((command !== 'claim' && command !== 'release') || issue === undefined || !agent) {
      err(USAGE);
      return EXIT.error;
    }
    if (command === 'claim') {
      const result = claim(issue, agent, { cwd, remote });
      if (result.ok) {
        out(result.resumed ? `#${issue} is already held by ${agent}; resuming` : `claimed #${issue} for ${agent}`);
        return EXIT.ok;
      }
      err(`not claimed: ${describe(issue, result.holder)}. Do not work on it unless the user reassigns it or the holder hands it over in the Issue.`);
      return EXIT.held;
    }
    const result = release(issue, agent, { cwd, remote });
    if (result.ok) {
      out(result.released ? `released #${issue}` : `#${issue} was not claimed`);
      return EXIT.ok;
    }
    err(`not released: ${describe(issue, result.holder)}; only the holder releases it.`);
    return EXIT.held;
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return EXIT.error;
  }
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
