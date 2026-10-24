// Started by ai-one right after it launches a command-line agent (Spec #155 C). The agent claims the
// Issue itself a little later, so this waits (bounded) for that claim to exist, then keeps it alive
// only while the launched process is alive. It never creates a claim and never takes one over.
//   node scripts/issue-claim/dispatch-watch.mjs <issue> <agent> <pid>
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { heartbeat, watchClaim } from './cli.mjs';

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForClaimThenWatch({
  issue, agent, pid, cwd, attempts = 40, intervalMs = 15000,
  beat = heartbeat, watch = watchClaim, sleep = sleepMs,
}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = beat(issue, agent, { cwd });
    if (result.ok) return watch(issue, agent, { cwd, pid });
    // Another holder owns it: not ours to keep alive.
    if (!result.missing) return { stopped: 'not-ours', holder: result.holder };
    await sleep(intervalMs);
  }
  return { stopped: 'no-claim' };
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  const [issueText, agent, pidText] = process.argv.slice(2);
  const issue = Number(issueText);
  const pid = Number(pidText);
  if (!Number.isSafeInteger(issue) || issue < 1 || !agent || !Number.isSafeInteger(pid) || pid < 1) {
    console.error('usage: node scripts/issue-claim/dispatch-watch.mjs <issue> <agent> <pid>');
    process.exitCode = 1;
  } else {
    waitForClaimThenWatch({ issue, agent, pid, cwd: process.cwd() }).then(
      (result) => { console.log(JSON.stringify(result)); },
      (error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; },
    );
  }
}
