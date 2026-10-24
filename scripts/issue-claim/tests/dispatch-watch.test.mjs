import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForClaimThenWatch } from '../dispatch-watch.mjs';

const base = { issue: 7, agent: 'Claude Code / dispatch-1', pid: 42, cwd: '.', intervalMs: 1, sleep: async () => {} };

test('waits for the agent to claim, then watches the launched process', async () => {
  let calls = 0;
  const beat = () => (++calls < 3 ? { ok: false, missing: true } : { ok: true });
  let watched;
  const result = await waitForClaimThenWatch({ ...base, beat, watch: async (...args) => { watched = args; return { stopped: 'process-exited', beats: 2 }; } });
  assert.equal(calls, 3);
  assert.deepEqual(watched.slice(0, 2), [7, 'Claude Code / dispatch-1']);
  assert.equal(watched[2].pid, 42);
  assert.equal(result.stopped, 'process-exited');
});

test('gives up when no claim ever appears and never watches', async () => {
  let watched = false;
  const result = await waitForClaimThenWatch({ ...base, attempts: 3, beat: () => ({ ok: false, missing: true }), watch: async () => { watched = true; } });
  assert.deepEqual(result, { stopped: 'no-claim' });
  assert.equal(watched, false);
});

test('does not keep alive a claim that belongs to someone else', async () => {
  let watched = false;
  const result = await waitForClaimThenWatch({ ...base, beat: () => ({ ok: false, holder: { agent: 'someone else' } }), watch: async () => { watched = true; } });
  assert.equal(result.stopped, 'not-ours');
  assert.equal(watched, false);
});
