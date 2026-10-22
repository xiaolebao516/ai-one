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

const USAGE = `usage:
  node scripts/issue-claim/cli.mjs claim <N> --agent "<tool / session>"
  node scripts/issue-claim/cli.mjs show [<N>]
  node scripts/issue-claim/cli.mjs release <N> --agent "<tool / session>"
options: --remote <name> (default origin)`;

function git(args, { cwd, input, allowFail = false } = {}) {
  const result = spawnSync('git', args, { cwd, input: input ?? '', encoding: 'utf8' });
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
    if (arg === '--agent' || arg === '--remote') {
      const value = rest[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = value;
      i += 1;
    } else if (/^#?\d+$/.test(arg) && options.issue === undefined) {
      options.issue = Number(arg.replace('#', ''));
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
  return { sha, agent, at, message };
}

export function claim(issue, agent, { cwd, remote = 'origin', now = new Date() } = {}) {
  const emptyTree = git(['mktree'], { cwd, input: '' }).stdout;
  const message = `claim #${issue}\n\nagent: ${agent}\nat: ${now.toISOString()}\n`;
  const commit = git(['commit-tree', emptyTree, '-m', message], { cwd }).stdout;
  const pushed = git(['push', '--porcelain', `--force-with-lease=${refFor(issue)}:`, remote, `${commit}:${refFor(issue)}`], {
    cwd,
    allowFail: true,
  });
  if (pushed.status === 0) return { ok: true, sha: commit };
  const holder = readClaim(issue, { cwd, remote });
  if (holder) return { ok: false, holder };
  throw new Error(`push failed: ${pushed.stderr || pushed.stdout}`);
}

export function release(issue, agent, { cwd, remote = 'origin' } = {}) {
  const holder = readClaim(issue, { cwd, remote });
  if (!holder) return { ok: true, released: false };
  if (holder.agent !== agent) return { ok: false, holder };
  // Lease on the claim we just read: if someone re-claimed in between, the delete is refused.
  git(['push', '--porcelain', `--force-with-lease=${refFor(issue)}:${holder.sha}`, remote, `:${refFor(issue)}`], { cwd });
  return { ok: true, released: true };
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
    if ((command !== 'claim' && command !== 'release') || issue === undefined || !agent) {
      err(USAGE);
      return EXIT.error;
    }
    if (command === 'claim') {
      const result = claim(issue, agent, { cwd, remote });
      if (result.ok) {
        out(`claimed #${issue} for ${agent}`);
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
