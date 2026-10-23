import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, parseArgs, resolveProdexEntry } from '../cli.mjs';
import { EXIT, addSlots, claimSlot, loadConfig, normalizeOwnership, parseCheck, readClaim, releaseClaim, slotEnv, sweepSlots, removeClaimFile } from '../slots.mjs';

const childScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'race-child.mjs');
// Real thread URLs, so the path check is exercised the way a caller would hit it.
const THREAD_A = 'https://chatgpt.com/c/6ad9e501-da24-83e9-81f9-8b5aae1f7013';
const THREAD_B = 'https://chatgpt.com/c/7bd8e501-1234-83e9-9ad7-429cd3782b79';
const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prodex-slots-'));
const claimPath = (home, id) => path.join(home, 'slot-claims', `slot-${id}.json`);

function harness({ states = {}, alive = () => true, home = tempHome(), askExit = 0, askThrows = false } = {}) {
  const log = { asks: [], launches: [], restores: [], out: [], err: [], clock: 0 };
  const deps = {
    home,
    alive,
    now: () => log.clock,
    sleep: async (ms) => { log.clock += ms; },
    profileExists: () => true,
    checkSlot: async (slot) => ({ state: states[slot.id] ?? 'ready' }),
    launchHeaded: async (slot) => { log.launches.push(slot.id); return { ok: true }; },
    runAsk: async (slot, args) => {
      log.asks.push({ slot: slot.id, args, claimed: readClaim(home, slot.id) });
      if (askThrows) throw new Error('boom');
      return askExit;
    },
  };
  const run = (args) => main(args, { deps, out: (s) => log.out.push(s), err: (s) => log.err.push(s) });
  return { deps, log, run, home };
}

// Starts `count` children that rendezvous before acting, so they really collide, and returns
// their parsed results.
async function collide(mode, home, count, slotBase = 0, rounds = 1) {
  const children = Array.from({ length: count }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [childScript, mode, home, String(count), String(slotBase), String(rounds)]);
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`child exited ${code}: ${stderr.slice(-2000)}`))));
  }));
  return Promise.all(children);
}

function deadPid() {
  const child = spawnSync(process.execPath, ['-e', '0']);
  return child.pid;
}

test('slot 2 matches the layout used in the manual 2026-10-22 test; slot 1 overrides nothing', () => {
  const home = tempHome();
  const [added] = addSlots(home, 1);
  assert.deepEqual(added, {
    id: 2,
    port: 9334,
    profileDir: path.join(home, 'chrome-chatgpt-pro-slot2'),
    lockFile: path.join(home, 'browser-send-slot2.lock'),
  });
  const [one] = loadConfig(home).slots;
  assert.deepEqual(one, { id: 1, port: 9333, profileDir: null, lockFile: null });
  assert.equal(loadConfig(home).count, 2);
});

test('slot count is bounded and survives reload', () => {
  const home = tempHome();
  addSlots(home, 3);
  assert.equal(loadConfig(home).slots.length, 4);
  assert.throws(() => addSlots(home, 5), /At most 8/);
  assert.throws(() => addSlots(home, 0), /positive/);
});

test('slotEnv sets the port and forces the default lock for slot 1', () => {
  const base = { PRODEX_SEND_LOCK_FILE: 'leftover', KEEP: '1' };
  assert.deepEqual(slotEnv({ port: 9333, lockFile: null }, base), { KEEP: '1', PRODEX_CDP_PORT: '9333' });
  assert.deepEqual(slotEnv({ port: 9334, lockFile: 'x.lock' }, base), { KEEP: '1', PRODEX_CDP_PORT: '9334', PRODEX_SEND_LOCK_FILE: 'x.lock' });
});

test('parseCheck reads only the chatgpt status line', () => {
  assert.equal(parseCheck('bridge: ok\nchatgpt: ok logged_in=true composer=true url=https://chatgpt.com/\n').state, 'ready');
  assert.equal(parseCheck('chatgpt: browser_unreachable - No endpoint on 127.0.0.1:9399.').state, 'down');
  assert.equal(parseCheck('chatgpt: ok logged_in=false composer=false').state, 'needs-login');
  assert.equal(parseCheck('chatgpt: login_required - sign in').state, 'needs-login');
  assert.equal(parseCheck('chatgpt: blocked logged_in=false composer=false').state, 'needs-login');
  assert.equal(parseCheck('chatgpt: busy response_in_progress - ChatGPT is still generating').state, 'busy');
  assert.equal(parseCheck('chatgpt: blocked tab_not_visible visibility=hidden - hidden tab').state, 'hidden');
  assert.equal(parseCheck('chatgpt: something_new').state, 'unknown');
  assert.equal(parseCheck('nothing useful').state, 'error', 'no status line = the probe failed, not a login problem');
  assert.equal(parseCheck('').state, 'error');
});

test('releasing and reaping share one mutex, so release cannot delete a claim between check and delete', () => {
  const home = tempHome();
  const claim = claimSlot(home, 2, { pid: 111, alive: () => true });
  const mutex = `${claimPath(home, 2)}.reap`;
  fs.writeFileSync(mutex, 'someone else\n');
  assert.throws(() => releaseClaim(home, 2, claim.owner, { timeoutMs: 100 }), /Timed out/);
  assert.equal(readClaim(home, 2).owner, claim.owner, 'nothing was deleted while the mutex was held');
  assert.equal(claim.release(), false, 'the handle swallows the failure; the claim dies with its owner');
  fs.rmSync(mutex);
  assert.equal(releaseClaim(home, 2, claim.owner), true);
});

test('a mutex left by a stopped process is reported, never deleted automatically', () => {
  const home = tempHome();
  addSlots(home, 1);
  const mutex = `${path.join(home, 'slots.json')}.lock`;
  fs.writeFileSync(mutex, '999\n');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(mutex, old, old);
  assert.throws(() => addSlots(home, 1), /left behind by a process.*Delete it by hand/);
  assert.equal(fs.existsSync(mutex), true);
  assert.equal(loadConfig(home).count, 2);
  claimSlot(home, 3, { pid: 1, alive: () => true });
  const reap = `${claimPath(home, 3)}.reap`;
  fs.writeFileSync(reap, '999\n');
  fs.utimesSync(reap, old, old);
  assert.throws(() => claimSlot(home, 3, { pid: 2, alive: () => false }), /left behind by a process/);
  assert.equal(readClaim(home, 3).pid, 1, 'the existing claim was left alone');
});

test('a live holder blocks a claim; a dead holder is reaped; release only drops the own claim', () => {
  const home = tempHome();
  const first = claimSlot(home, 2, { pid: 111, alive: () => true });
  assert.equal(first.ok, true);
  const blocked = claimSlot(home, 2, { pid: 222, alive: () => true });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.holder.pid, 111);
  const reaped = claimSlot(home, 2, { pid: 222, alive: () => false });
  assert.equal(reaped.ok, true);
  assert.equal(readClaim(home, 2).pid, 222);
  assert.equal(first.release(), false, 'the old owner must not delete the new owner\'s claim');
  assert.equal(readClaim(home, 2).pid, 222);
  assert.equal(releaseClaim(home, 2), true);
  assert.equal(readClaim(home, 2), null);
});

test('a claim stores its ownership but never the reply or an ask session key', () => {
  const home = tempHome();
  claimSlot(home, 1, {
    pid: 5,
    alive: () => true,
    meta: { task: '71', sessionKey: 's1', threadUrl: THREAD_A },
  });
  const claim = readClaim(home, 1);
  assert.deepEqual(Object.keys(claim).sort(), ['owner', 'pid', 'sessionKey', 'startedAt', 'task', 'threadUrl']);
  assert.equal(claim.task, '#71', 'the task number is stored canonically');
  assert.ok(!JSON.stringify(claim).includes('reply text'));
});

test('a claim without ownership keeps exactly the original fields', () => {
  const home = tempHome();
  claimSlot(home, 1, { pid: 5, alive: () => true });
  assert.deepEqual(Object.keys(readClaim(home, 1)).sort(), ['owner', 'pid', 'startedAt']);
});

test('ownership is normalized and validated before anything is written', () => {
  assert.deepEqual(normalizeOwnership(), {});
  assert.deepEqual(normalizeOwnership({}), {});
  assert.deepEqual(normalizeOwnership({ task: '71' }), { task: '#71' });
  assert.deepEqual(normalizeOwnership({ task: '#71' }), { task: '#71' });
  assert.deepEqual(
    normalizeOwnership({ task: 71, sessionKey: 's-1_a.b:c', threadUrl: THREAD_A }),
    { task: '#71', sessionKey: 's-1_a.b:c', threadUrl: THREAD_A },
  );
  assert.deepEqual(normalizeOwnership({ task: undefined, sessionKey: undefined, threadUrl: undefined }), {});
  assert.throws(() => normalizeOwnership({ task: 'abc' }), /--task must be a task number/);
  assert.throws(() => normalizeOwnership({ task: '71a' }), /--task must be a task number/);
  assert.throws(() => normalizeOwnership({ task: '-1' }), /--task must be a task number/);
  assert.throws(() => normalizeOwnership({ sessionKey: 'x'.repeat(65) }), /--session must be/);
  assert.throws(() => normalizeOwnership({ sessionKey: '' }), /--session must be/);
  assert.throws(() => normalizeOwnership({ sessionKey: 'has space' }), /--session must be/);
  assert.throws(() => normalizeOwnership({ sessionKey: 'cookie=abc' }), /--session must be/);
  assert.throws(() => normalizeOwnership({ threadUrl: 'http://chatgpt.com/c/6ad9e501-da24-83e9-81f9-8b5aae1f7013' }), /must use https/);
  assert.throws(() => normalizeOwnership({ threadUrl: 'https://evil.example/c/abc' }), /must be on chatgpt.com/);
  assert.throws(() => normalizeOwnership({ threadUrl: 'not a url' }), /must be a full URL/);
  assert.throws(() => normalizeOwnership({ threadUrl: `https://chatgpt.com/c/${'a'.repeat(300)}` }), /at most 300/);
});

test('a thread URL is accepted only in one exact, canonical form', () => {
  const id = '6ad9e501-da24-83e9-81f9-8b5aae1f7013';
  const rejected = [
    [`https://user:secret@chatgpt.com/c/${id}`, /credentials/],
    [`https://chatgpt.com/SECRET/../c/${id}`, /written exactly/],
    [`https://chatgpt.com/%2e%2e/c/${id}`, /written exactly/],
    [`https://chatgpt.com:9443/c/${id}`, /must not use a port/],
    [`https://chatgpt.com:443/c/${id}`, /written exactly/],
    [`https://chatgpt.com/c/${id}?`, /query or fragment/],
    [`https://chatgpt.com/c/${id}#`, /query or fragment/],
    [`https://chatgpt.com/c/${id}?token=SENTINEL`, /query or fragment/],
    [`https://chatgpt.com/c/${id}#Bearer-SENTINEL`, /query or fragment/],
    [`https://chatgpt.com/c/${id}\n`, /control characters/],
    ['https://chatgpt.com/c/1234\n5678', /control characters/],
    [`https://chatgpt.com//c/${id}`, /must point at a thread/],
    [`https://chatgpt.com/c/${id}/`, /must point at a thread/],
    ['https://chatgpt.com/c/Bearer-SECRET', /must point at a thread/],
    ['https://chatgpt.com/c/12345678', /must point at a thread/],
    ['https://chatgpt.com/SENTINEL-token-9f', /must point at a thread/],
    [`https://CHATGPT.COM/c/${id}`, /written exactly/],
    [`http://chatgpt.com/c/${id}`, /must use https/],
    [`https://evil.example/c/${id}`, /must be on chatgpt\.com/],
    ['https://chatgpt.com/c/abc', /must point at a thread/],
    ['https://chatgpt.com/', /must point at a thread/],
  ];
  for (const [input, pattern] of rejected) {
    const label = JSON.stringify(input);
    assert.throws(() => normalizeOwnership({ threadUrl: input }), pattern, label);
    try {
      normalizeOwnership({ threadUrl: input });
    } catch (error) {
      assert.ok(!/SENTINEL|\bsecret\b/.test(error.message), `the error message echoed the value: ${error.message}`);
    }
  }
  // The two shapes a real thread has, stored exactly as given.
  assert.equal(normalizeOwnership({ threadUrl: THREAD_A }).threadUrl, THREAD_A);
  const inProject = 'https://chatgpt.com/g/g-p-68f0a1b2c3d4/c/6ad9e501-da24-83e9-81f9-8b5aae1f7013';
  assert.equal(normalizeOwnership({ threadUrl: inProject }).threadUrl, inProject);
});

test('a claim refuses invalid ownership and leaves nothing behind', () => {
  const home = tempHome();
  assert.throws(() => claimSlot(home, 1, { pid: 5, alive: () => true, meta: { task: 'oops' } }), /--task must be/);
  assert.equal(readClaim(home, 1), null);
  const dir = path.join(home, 'slot-claims');
  assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0, 'no temp file is left behind');
});

test('a claim without a recent heartbeat is dead even when its pid looks alive (recycled pid)', () => {
  const home = tempHome();
  claimSlot(home, 2, { pid: 111, alive: () => true });
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(claimPath(home, 2), old, old);
  const taken = claimSlot(home, 2, { pid: 222, alive: () => true });
  assert.equal(taken.ok, true);
  assert.equal(readClaim(home, 2).pid, 222);
  const fresh = claimSlot(home, 2, { pid: 333, alive: () => true });
  assert.equal(fresh.ok, false, 'a fresh heartbeat keeps the claim');
});

test('an unreadable claim counts as live until it is stale, then is replaced', () => {
  const home = tempHome();
  fs.mkdirSync(path.dirname(claimPath(home, 2)), { recursive: true });
  fs.writeFileSync(claimPath(home, 2), '{"owner":"half-writ');
  assert.equal(claimSlot(home, 2, { alive: () => false }).ok, false);
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(claimPath(home, 2), old, old);
  assert.equal(claimSlot(home, 2, { alive: () => false }).ok, true);
});

const ROUNDS = 20;
const winnersPerRound = (results) => Array.from({ length: ROUNDS }, (_, round) => results.filter((r) => r.results[round]).length);

test('six real processes colliding on dead claims, 20 rounds: exactly one winner every round', async () => {
  const home = tempHome();
  fs.mkdirSync(path.dirname(claimPath(home, 2)), { recursive: true });
  const dead = deadPid();
  for (let round = 0; round < ROUNDS; round++) {
    fs.writeFileSync(claimPath(home, 2 + round), `${JSON.stringify({ owner: 'dead', pid: dead, startedAt: 1 })}\n`);
  }
  const results = await collide('claim', home, 6, 2, ROUNDS);
  assert.deepEqual(winnersPerRound(results), Array(ROUNDS).fill(1));
});

test('six real processes colliding on free slots, 20 rounds: exactly one winner every round', async () => {
  const home = tempHome();
  const results = await collide('claim', home, 6, 2, ROUNDS);
  assert.deepEqual(winnersPerRound(results), Array(ROUNDS).fill(1));
});

test('four real processes adding a slot at once get four different ids', async () => {
  const home = tempHome();
  const results = await collide('add', home, 4);
  assert.deepEqual(results.flatMap((r) => r.ids).sort(), [2, 3, 4, 5]);
  assert.equal(loadConfig(home).count, 5);
});

test('parseArgs validates options and refuses --port passthrough', () => {
  assert.deepEqual(parseArgs(['run', '--slot', '2', '--', '--new-chat']).options.slot, 2);
  assert.equal(parseArgs(['run', '--', '--new-chat']).options.slot, 'auto');
  assert.throws(() => parseArgs(['run']), /after `--`/);
  assert.throws(() => parseArgs(['run', '--', '--port', '9400']), /Do not pass --port/);
  assert.throws(() => parseArgs(['run', '--', '--port=9400']), /Do not pass --port/);
  assert.throws(() => parseArgs(['add']), /--count/);
  assert.throws(() => parseArgs(['list', '--slot', 'x']), /Invalid integer/);
  assert.throws(() => parseArgs(['list', '--json', '--json']), /Duplicate/);
  assert.throws(() => parseArgs(['release']), /--slot/);
  assert.throws(() => parseArgs(['list', '--', 'x']), /Only `run` takes arguments/);
  // Options take their value as the next argument; the "=" form is refused without repeating it.
  assert.throws(() => parseArgs(['run', '--session=X-1', '--', '--new-chat']), /Unknown option: --session/);
  for (const argv of [['run', '--session=SENTINEL', '--', '--new-chat'], ['list', '--task=SENTINEL']]) {
    let message = '';
    try {
      parseArgs(argv);
    } catch (error) {
      message = error.message;
    }
    assert.ok(message, `${argv.join(' ')} should have been refused`);
    assert.ok(!message.includes('SENTINEL'), `the message repeated the value: ${message}`);
  }
});

test('run auto takes the first ready idle slot and always releases its claim', async () => {
  const h = harness();
  addSlots(h.home, 1);
  assert.equal(await h.run(['run', '--', '--new-chat', '--session-key', 'secret-key']), EXIT.OK);
  assert.equal(h.log.asks.length, 1);
  assert.equal(h.log.asks[0].slot, 1);
  assert.equal(h.log.asks[0].claimed.pid, process.pid);
  assert.ok(!JSON.stringify(h.log.asks[0].claimed).includes('secret-key'));
  assert.equal(readClaim(h.home, 1), null);
});

test('run auto skips a claimed slot and uses the next one', async () => {
  const h = harness();
  addSlots(h.home, 1);
  claimSlot(h.home, 1, { pid: 999, alive: () => true });
  assert.equal(await h.run(['run', '--', '--new-chat']), EXIT.OK);
  assert.equal(h.log.asks[0].slot, 2);
  assert.equal(readClaim(h.home, 1).pid, 999);
});

test('any failing ask is exit 1, never a code that could pass for 3 or 4, and the claim is released', async () => {
  for (const askExit of [5, 3, 4]) {
    const failing = harness({ askExit });
    assert.equal(await failing.run(['run', '--', '--new-chat']), EXIT.ERROR, `ask exit ${askExit}`);
    assert.match(failing.log.err.join('\n'), new RegExp(`ask exited with code ${askExit}`));
    assert.equal(readClaim(failing.home, 1), null);
  }
  const throwing = harness({ askThrows: true });
  assert.equal(await throwing.run(['run', '--', '--new-chat']), EXIT.ERROR);
  assert.equal(readClaim(throwing.home, 1), null);
});

test('run with no usable slot asks for the user instead of sending', async () => {
  const h = harness({ states: { 1: 'down', 2: 'needs-login' } });
  addSlots(h.home, 1);
  assert.equal(await h.run(['run', '--', '--new-chat']), EXIT.NEEDS_USER);
  assert.equal(h.log.asks.length, 0);
  assert.match(h.log.err.join('\n'), /slot 1: down; slot 2: needs-login/);
  assert.equal(readClaim(h.home, 1), null);
  assert.equal(readClaim(h.home, 2), null);
});

test('a probe that cannot run is an error, not a request for the user to log in', async () => {
  const h = harness({ states: { 1: 'error' } });
  assert.equal(await h.run(['run', '--', '--new-chat']), EXIT.ERROR);
  assert.equal(h.log.asks.length, 0);
  const ensure = harness({ states: { 1: 'error' } });
  assert.equal(await ensure.run(['ensure']), EXIT.ERROR);
  assert.match(ensure.log.err.join('\n'), /could not start or probe slot 1.*not a login problem/);
});

test('run waits while ready slots are busy and gives up after --wait-ms', async () => {
  const h = harness();
  claimSlot(h.home, 1, { pid: 999, alive: () => true });
  assert.equal(await h.run(['run', '--wait-ms', '5000', '--', '--new-chat']), EXIT.BUSY);
  assert.equal(h.log.asks.length, 0);
  assert.ok(h.log.clock >= 5000);
});

test('run treats a slot that is still generating as busy, not as broken', async () => {
  const busy = harness({ states: { 1: 'busy' } });
  assert.equal(await busy.run(['run', '--wait-ms', '4000', '--', '--new-chat']), EXIT.BUSY);
  assert.equal(busy.log.asks.length, 0);
  assert.equal(readClaim(busy.home, 1), null);
  const mixed = harness({ states: { 1: 'busy', 2: 'hidden' } });
  addSlots(mixed.home, 1);
  assert.equal(await mixed.run(['run', '--wait-ms', '4000', '--', '--new-chat']), EXIT.BUSY);
  assert.equal(mixed.log.asks.length, 0);
});

test('run picks up a slot that frees up while waiting', async () => {
  const h = harness();
  claimSlot(h.home, 1, { pid: 999, alive: () => true });
  let sleeps = 0;
  const originalSleep = h.deps.sleep;
  h.deps.sleep = async (ms) => { if (++sleeps === 2) releaseClaim(h.home, 1); await originalSleep(ms); };
  assert.equal(await h.run(['run', '--', '--new-chat']), EXIT.OK);
  assert.equal(h.log.asks[0].slot, 1);
});

test('run --slot N never falls back to another slot', async () => {
  const h = harness({ states: { 2: 'down' } });
  addSlots(h.home, 1);
  assert.equal(await h.run(['run', '--slot', '2', '--', '--new-chat']), EXIT.NEEDS_USER);
  assert.equal(h.log.asks.length, 0);
  assert.equal(await h.run(['run', '--slot', '7', '--', '--new-chat']), EXIT.ERROR);
});

test('a minimized (hidden) window is restored once and then used', async () => {
  const h = harness();
  let restored = false;
  h.deps.restoreWindow = async () => { restored = true; h.log.restores.push(1); return true; };
  h.deps.checkSlot = async () => ({ state: restored ? 'ready' : 'hidden' });
  assert.equal(await h.run(['run', '--', '--new-chat']), EXIT.OK);
  assert.equal(h.log.restores.length, 1);
  assert.equal(h.log.asks.length, 1);
});

test('a hidden window that cannot be restored is reported for the user', async () => {
  const h = harness({ states: { 1: 'hidden' } });
  h.deps.restoreWindow = async () => false;
  assert.equal(await h.run(['run', '--', '--new-chat']), EXIT.NEEDS_USER);
  assert.equal(h.log.asks.length, 0);
  const ensure = harness({ states: { 1: 'hidden' } });
  assert.equal(await ensure.run(['ensure']), EXIT.NEEDS_USER);
  assert.match(ensure.log.err.join('\n'), /slot 1 \(hidden\)/);
});

test('add registers slots, opens windows for browsers that are down and asks the user to sign in', async () => {
  const h = harness({ states: { 2: 'down' } });
  assert.equal(await h.run(['add', '--count', '1', '--json']), EXIT.NEEDS_USER);
  assert.deepEqual(h.log.launches, [2]);
  assert.equal(loadConfig(h.home).count, 2);
  assert.deepEqual(JSON.parse(h.log.out[0]), [{ id: 2, port: 9334, state: 'down' }]);
  assert.match(h.log.err.join('\n'), /user must act on slot 2 \(down\).*sign in to ChatGPT/);
});

test('a browser that fails to start is an error, not a request to log in', async () => {
  const h = harness({ states: { 2: 'down' } });
  h.deps.launchHeaded = async () => ({ ok: false, detail: 'login exited 1' });
  assert.equal(await h.run(['add', '--count', '1', '--json']), EXIT.ERROR);
  assert.deepEqual(JSON.parse(h.log.out[0]), [{ id: 2, port: 9334, state: 'error', detail: 'login exited 1' }]);
  assert.match(h.log.err.join('\n'), /could not start or probe slot 2.*not a login problem/);
});

test('ensure is silent when every slot is ready or busy and reopens a closed browser that is still logged in', async () => {
  const quiet = harness({ states: { 1: 'busy' } });
  assert.equal(await quiet.run(['ensure']), EXIT.OK);
  assert.deepEqual(quiet.log.launches, []);
  const h = harness();
  addSlots(h.home, 1);
  let calls = 0;
  h.deps.checkSlot = async (slot) => ({ state: slot.id === 2 && ++calls === 1 ? 'down' : 'ready' });
  assert.equal(await h.run(['ensure']), EXIT.OK);
  assert.deepEqual(h.log.launches, [2]);
});

test('list reports state and a live claim by pid and any ownership', async () => {
  const h = harness({ states: { 1: 'ready' } });
  claimSlot(h.home, 1, { pid: 321, alive: () => true });
  assert.equal(await h.run(['list', '--json']), EXIT.OK);
  assert.deepEqual(JSON.parse(h.log.out[0]), [{ id: 1, port: 9333, state: 'ready', busyWith: { pid: 321 } }]);
});

test('two slots can be told apart by the task and the thread they serve', async () => {
  const h = harness();
  addSlots(h.home, 1);
  claimSlot(h.home, 1, { pid: 111, alive: () => true, meta: { task: '71', sessionKey: 's1' } });
  claimSlot(h.home, 2, { pid: 222, alive: () => true, meta: { task: '72', threadUrl: THREAD_B } });
  assert.equal(await h.run(['list', '--json']), EXIT.OK);
  const rows = JSON.parse(h.log.out[0]);
  assert.deepEqual(rows[0].busyWith, { pid: 111, task: '#71', sessionKey: 's1' });
  assert.deepEqual(rows[1].busyWith, { pid: 222, task: '#72', threadUrl: THREAD_B });
  assert.match(h.log.out[0], /#71/);
  assert.ok(!/reply|answer text/.test(h.log.out[0]), 'the listing carries no conversation text');
});

test('run records the ownership it was given and forwards nothing extra to ask', async () => {
  const h = harness();
  const args = ['run', '--task', '71', '--session', 's1', '--thread-url', THREAD_A, '--', '--target-url', THREAD_A, '--effort', 'high'];
  assert.equal(await h.run(args), EXIT.OK);
  const ask = h.log.asks[0];
  assert.equal(ask.claimed.task, '#71');
  assert.equal(ask.claimed.sessionKey, 's1');
  assert.equal(ask.claimed.threadUrl, THREAD_A);
  assert.deepEqual(ask.args, ['--target-url', THREAD_A, '--effort', 'high'], 'ownership flags are consumed, not forwarded to ask');
  assert.match(h.log.err.join('\n'), /using slot 1 \(port 9333\) for #71 s1/);
});

test("the ask's own --session-key stays a prodex flag and is never stored as ownership", async () => {
  const h = harness();
  assert.equal(await h.run(['run', '--', '--new-chat', '--session-key', 'sk-secret']), EXIT.OK);
  const ask = h.log.asks[0];
  assert.deepEqual(ask.args, ['--new-chat', '--session-key', 'sk-secret']);
  assert.equal(ask.claimed.sessionKey, undefined);
  assert.ok(!JSON.stringify(ask.claimed).includes('sk-secret'));
  assert.match(h.log.err.join('\n'), /using slot 1 \(port 9333\)\n?$/);
});

test('bad ownership is rejected before any slot is probed or asked', async () => {
  const cases = [
    ['run', '--task', 'abc', '--', '--new-chat'],
    ['run', '--session', 'has space', '--', '--new-chat'],
    ['run', '--thread-url', 'https://evil.example/x', '--', '--new-chat'],
    ['run', '--thread-url', 'http://chatgpt.com/c/6ad9e501-da24-83e9-81f9-8b5aae1f7013', '--', '--new-chat'],
  ];
  for (const args of cases) {
    const h = harness();
    assert.equal(await h.run(args), EXIT.ERROR, args.join(' '));
    assert.equal(h.log.asks.length, 0, args.join(' '));
    assert.equal(readClaim(h.home, 1), null, args.join(' '));
  }
});

test('ownership flags are refused on commands that cannot record them', async () => {
  const h = harness();
  for (const args of [
    ['list', '--task', '71'],
    ['ensure', '--session', 's1'],
    ['add', '--count', '1', '--thread-url', THREAD_A],
    ['list', '--note', 'nope'],
    ['run', '--note', 'nope', '--', '--new-chat'],
  ]) {
    assert.equal(await h.run(args), EXIT.ERROR, args.join(' '));
  }
  assert.equal(loadConfig(h.home).count, 1, 'add did not run');
  assert.match(h.log.err.join('\n'), /--task.*only apply to run and release/);
});

test('an unknown command is refused without repeating it', async () => {
  const h = harness();
  assert.equal(await h.run(['SENTINEL-cmd']), EXIT.ERROR);
  const stderr = h.log.err.join('\n');
  assert.match(stderr, /Unknown command/);
  assert.ok(!stderr.includes('SENTINEL'), 'the command was echoed back');
});

test('a token in a wrong place is never echoed, in any form', async () => {
  const sentinel = 'SENTINEL-token-9f';
  const thread = 'https://chatgpt.com/c/6ad9e501-da24-83e9-81f9-8b5aae1f7013';
  const cases = [
    // a bare token where an option was expected
    ['run', sentinel, '--', '--new-chat'],
    // an unknown command together with ownership flags
    [sentinel, '--task', '71'],
    // the "=" form for each ownership field
    [`--session=${sentinel}`, 'run', '--', '--new-chat'],
    [`--task=${sentinel}`, 'run', '--', '--new-chat'],
    [`--thread-url=${thread}/${sentinel}`, 'run', '--', '--new-chat'],
  ];
  for (const argv of cases) {
    const h = harness();
    const code = await h.run(argv);
    assert.notEqual(code, EXIT.OK, `${argv.join(' ')} should not have succeeded`);
    assert.equal(h.log.asks.length, 0, 'nothing was sent');
    const stderr = h.log.err.join('\n');
    assert.ok(!stderr.includes(sentinel), `stderr echoed the value for: ${argv.join(' ')}`);
    assert.ok(!h.log.out.join('\n').includes(sentinel), `stdout echoed the value for: ${argv.join(' ')}`);
  }
});

test('a probe detail never carries a token in a URL', () => {
  const { detail } = parseCheck(`chatgpt: blocked logged_in=false url=https://chatgpt.com/c/x?token=SENTINEL-9f`);
  assert.ok(!detail.includes('SENTINEL-9f'), detail);
  assert.match(detail, /url=<redacted>/);
  // A "#" fragment is as good a place to hide a token as a query string.
  const fragment = parseCheck('chatgpt: busy url=https://chatgpt.com/c/x#access_token=SECRET-9f');
  assert.ok(!fragment.detail.includes('SECRET-9f'), fragment.detail);
  assert.match(fragment.detail, /url=<redacted>/);
  const plain = parseCheck('chatgpt: something_new url=https://chatgpt.com/');
  assert.match(plain.detail, /https:\/\/chatgpt\.com\//, 'a plain URL stays readable');
});

test('a slots.json that parses but is not an object falls back to one slot', () => {
  const home = tempHome();
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'slots.json'), 'null');
  assert.equal(loadConfig(home).count, 1);
  fs.writeFileSync(path.join(home, 'slots.json'), '"quoted"');
  assert.equal(loadConfig(home).count, 1);
});

test('a broken slots.json is reported without its contents', () => {
  const home = tempHome();
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'slots.json'), '{"count": 5, "note": "SENTINEL-json-9f');
  let message = '';
  try {
    loadConfig(home);
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /not valid JSON/);
  assert.ok(!message.includes('SENTINEL-json-9f'), `the parse error quoted the file: ${message}`);
});

test('a hand-edited claim cannot smuggle text or a credential into the listing', async () => {
  const h = harness();
  addSlots(h.home, 1);
  fs.mkdirSync(path.join(h.home, 'slot-claims'), { recursive: true });
  fs.writeFileSync(claimPath(h.home, 1), `${JSON.stringify({
    owner: 'x',
    pid: 4242,
    startedAt: Date.now(),
    task: '66\nslot 9 ready',
    sessionKey: 'Bearer SECRET',
    threadUrl: 'https://chatgpt.com/SECRET/../c/6ad9e501-da24-83e9-81f9-8b5aae1f7013',
  })}\n`);
  assert.equal(await h.run(['list', '--json']), EXIT.OK);
  const text = h.log.out.join('\n');
  assert.ok(!/SECRET|SENTINEL|slot 9 ready/.test(text), `the listing leaked an edited value: ${text}`);
  assert.deepEqual(JSON.parse(h.log.out[0])[0].busyWith, { pid: 4242 }, 'invalid fields are dropped, not shown');
});

test('a rejected ownership value writes no claim and is never echoed', async () => {
  const sentinel = 'SENTINEL-token-9f';
  const thread = 'https://chatgpt.com/c/6ad9e501-da24-83e9-81f9-8b5aae1f7013';
  const cases = [
    ['--thread-url', `${thread}?token=${sentinel}`],
    ['--thread-url', `https://chatgpt.com/${sentinel}/../c/6ad9e501-da24-83e9-81f9-8b5aae1f7013`],
    ['--thread-url', `https://user:${sentinel}@chatgpt.com/c/6ad9e501-da24-83e9-81f9-8b5aae1f7013`],
    // A path that is not a thread: the refusal must not repeat the path it did not like.
    ['--thread-url', `https://chatgpt.com/${sentinel}`],
    // A rejected value can be any text, so a token can arrive through the other two fields too.
    ['--session', `Bearer ${sentinel}`],
    ['--task', sentinel],
    // The "=" form is not accepted, and refusing it must not repeat what came after the "=".
    [`--session=${sentinel}`, ''],
    [`--task=${sentinel}`, ''],
    [`--thread-url=https://chatgpt.com/${sentinel}`, ''],
  ];
  for (const [flag, value] of cases) {
    const h = harness();
    const argv = value === '' ? ['run', flag, '--', '--new-chat'] : ['run', flag, value, '--', '--new-chat'];
    const label = value === '' ? flag : `${flag} ${value}`;
    assert.equal(await h.run(argv), EXIT.ERROR, label);
    assert.equal(h.log.asks.length, 0, 'nothing was sent');
    assert.equal(readClaim(h.home, 1), null, 'no claim was left');
    const dir = path.join(h.home, 'slot-claims');
    assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0, 'nothing was written to disk');
    const stderr = h.log.err.join('\n');
    assert.match(stderr, new RegExp(flag.split('=')[0]), 'the message still names the flag');
    assert.ok(!stderr.includes(sentinel), `stderr echoed the value for ${label}`);
    assert.ok(!h.log.out.join('\n').includes(sentinel), `stdout echoed the value for ${label}`);
  }
});

test('nothing from the ask arguments reaches the claim that is on disk during the run', async () => {
  const h = harness();
  const sentinel = 'SENTINEL-7f3c';
  assert.equal(await h.run(['run', '--task', '71', '--', '--new-chat', '--stdin', '--attach', sentinel]), EXIT.OK);
  const duringRun = h.log.asks[0].claimed;
  assert.deepEqual(Object.keys(duringRun).sort(), ['owner', 'pid', 'startedAt', 'task']);
  assert.ok(!JSON.stringify(duringRun).includes(sentinel), 'the claim carried ask arguments');
});

test('two runs holding two slots at once are both visible, each with its own ownership', async () => {
  const home = tempHome();
  addSlots(home, 1);
  const gates = [];
  const blockingHarness = () => {
    const h = harness({ home });
    h.deps.runAsk = async (slot, args) => {
      let open;
      const gate = new Promise((resolve) => { open = resolve; });
      gates.push({ open });
      h.log.asks.push({ slot: slot.id, args, claimed: readClaim(home, slot.id) });
      await gate;
      return 0;
    };
    return h;
  };
  const first = blockingHarness();
  const second = blockingHarness();
  const running = [
    first.run(['run', '--slot', '1', '--task', '71', '--session', 'sA', '--', '--new-chat']),
    second.run(['run', '--slot', '2', '--task', '72', '--session', 'sB', '--', '--new-chat']),
  ];
  for (let i = 0; ; i++) {
    if (gates.length === 2 && readClaim(home, 1) && readClaim(home, 2)) break;
    if (i > 400) throw new Error('the two runs never both held a claim');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const listing = harness({ home });
  assert.equal(await listing.run(['list', '--json']), EXIT.OK);
  const rows = JSON.parse(listing.log.out[0]);
  assert.deepEqual(rows[0].busyWith, { pid: process.pid, task: '#71', sessionKey: 'sA' });
  assert.deepEqual(rows[1].busyWith, { pid: process.pid, task: '#72', sessionKey: 'sB' });
  assert.equal(await listing.run(['list']), EXIT.OK);
  assert.match(listing.log.out.at(-1), /busy \(pid \d+\) #71 sA/, 'the plain listing names both owners too');
  for (const gate of gates) gate.open();
  assert.deepEqual(await Promise.all(running), [EXIT.OK, EXIT.OK]);
  assert.equal(readClaim(home, 1), null, 'both claims are released');
  assert.equal(readClaim(home, 2), null);
});

test('sweep removes a dead claim and a stale heartbeat, and never a live claim', () => {
  const home = tempHome();
  const dead = deadPid();
  fs.mkdirSync(path.dirname(claimPath(home, 1)), { recursive: true });
  fs.writeFileSync(claimPath(home, 1), `${JSON.stringify({ owner: 'a', pid: dead, startedAt: 1 })}\n`);
  claimSlot(home, 2, { pid: 111, alive: () => true });
  const stale = claimPath(home, 3);
  claimSlot(home, 3, { pid: 222, alive: () => true });
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(stale, old, old);
  const report = sweepSlots(home, [1, 2, 3], { alive: (pid) => pid === 111 || pid === 222 });
  assert.deepEqual(report.filter((r) => r.slot === 1).map((r) => r.removed), ['claim']);
  assert.match(report.find((r) => r.slot === 1).reason, /pid \d+ has exited/);
  assert.deepEqual(report.filter((r) => r.slot === 2), [], 'a live claim is never touched');
  assert.deepEqual(report.filter((r) => r.slot === 3).map((r) => r.removed), ['claim']);
  assert.match(report.find((r) => r.slot === 3).reason, /no heartbeat/);
  assert.equal(readClaim(home, 2).pid, 111);
  assert.equal(readClaim(home, 1), null);
  assert.equal(readClaim(home, 3), null);
});

test('sweep deletes a .tmp that is a hard link of the claim and an old orphan, keeps a fresh orphan', () => {
  const home = tempHome();
  addSlots(home, 1);
  claimSlot(home, 2, { pid: 111, alive: () => true });
  fs.linkSync(claimPath(home, 2), `${claimPath(home, 2)}.linked.tmp`);
  fs.writeFileSync(`${claimPath(home, 2)}.fresh.tmp`, 'x\n');
  const old = new Date(Date.now() - 10 * 60_000);
  fs.writeFileSync(`${claimPath(home, 2)}.orphan.tmp`, 'x\n');
  fs.utimesSync(`${claimPath(home, 2)}.orphan.tmp`, old, old);
  const report = sweepSlots(home, [2], { alive: () => true });
  assert.deepEqual(report.map((r) => r.removed).sort(), ['claim', 'temp', 'temp'].sort().filter((x) => x === 'temp'));
  assert.ok(report.every((r) => r.removed === 'temp'), 'the live claim itself stays');
  assert.equal(readClaim(home, 2).pid, 111, 'the claim survives its extra link being removed');
  assert.ok(!fs.existsSync(`${claimPath(home, 2)}.linked.tmp`), 'same-inode link is gone');
  assert.ok(!fs.existsSync(`${claimPath(home, 2)}.orphan.tmp`), 'stale orphan is gone');
  assert.ok(fs.existsSync(`${claimPath(home, 2)}.fresh.tmp`), 'a fresh orphan is left alone');
  fs.rmSync(`${claimPath(home, 2)}.fresh.tmp`, { force: true });
});

test('sweep reports a stale .reap mutex with a copy-paste command and deletes nothing there', () => {
  const home = tempHome();
  addSlots(home, 1);
  claimSlot(home, 2, { pid: 111, alive: () => true });
  const reap = `${claimPath(home, 2)}.reap`;
  fs.writeFileSync(reap, '999\n');
  fs.utimesSync(reap, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  const report = sweepSlots(home, [2]);
  assert.equal(report.length, 1);
  assert.match(report[0].blocked, /was left behind by a process/);
  assert.match(report[0].blocked, new RegExp(reap.replace(/[\\/]/g, '\\$&').replace(/'/g, "'")));
  assert.ok(report[0].blocked.includes('Remove-Item'), 'the command is copy-pasteable');
  assert.equal(fs.existsSync(reap), true, 'the mutex is never deleted automatically');
  assert.equal(readClaim(home, 2).pid, 111, 'the claim was left alone');
});

test('list sweeps first: a dead claim shows up as reaped in json and text, plus a stderr line', async () => {
  const h = harness();
  addSlots(h.home, 1);
  const dead = deadPid();
  fs.mkdirSync(path.dirname(claimPath(h.home, 1)), { recursive: true });
  fs.writeFileSync(claimPath(h.home, 1), `${JSON.stringify({ owner: 'a', pid: dead, startedAt: 1 })}\n`);
  h.deps.alive = (pid) => pid !== dead;
  assert.equal(await h.run(['list']), EXIT.OK);
  assert.match(h.log.out.at(-1), /\[self-healed: claim\]/);
  assert.match(h.log.err.join('\n'), /self-heal removed the claim of slot 1/);
  assert.equal(await h.run(['list', '--json']), EXIT.OK);
  const rows = JSON.parse(h.log.out.at(-1));
  assert.equal(rows[0].busyWith, null, 'the claim is gone from the listing');
  assert.equal(rows[0].reaped, undefined, 'the second sweep has nothing left to remove');
  assert.equal(readClaim(h.home, 1), null);
});

test('a stale .reap no longer blocks list: the slot is reported as blocked with the fix command', async () => {
  const h = harness();
  addSlots(h.home, 1);
  claimSlot(h.home, 1, { pid: 111, alive: () => true });
  const reap = `${claimPath(h.home, 1)}.reap`;
  fs.writeFileSync(reap, '999\n');
  fs.utimesSync(reap, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  assert.equal(await h.run(['list', '--json']), EXIT.OK, 'list must survive a stale mutex');
  const stderr = h.log.err.join('\n');
  assert.match(stderr, /self-heal blocked on slot 1/);
  assert.match(stderr, /Remove-Item/);
  assert.equal(fs.existsSync(reap), true);
  assert.equal(readClaim(h.home, 1).pid, 111);
});

test('argument mistakes print the usage block; runtime failures do not', async () => {
  const usage = harness();
  assert.equal(await usage.run(['run']), EXIT.ERROR);
  assert.match(usage.log.err.join('\n'), /Usage: node scripts\/prodex-slots\/cli\.mjs/);

  const runtime = harness({ states: { 1: 'ready' } });
  addSlots(runtime.home, 1);
  assert.equal(await runtime.run(['run', '--slot', '99', '--', '--new-chat']), EXIT.ERROR);
  const runtimeErr = runtime.log.err.join('\n');
  assert.match(runtimeErr, /No such slot: 99\. Registered slots: 1, 2 \(ports 9333, 9334\)/);
  assert.ok(!runtimeErr.includes('Usage: node scripts/prodex-slots/cli.mjs'), 'a runtime failure must not dump the usage block');
});

test('a failed ask points at recover instead of leaving a dead end', async () => {
  const h = harness({ askExit: 1 });
  assert.equal(await h.run(['run', '--', '--new-chat']), EXIT.ERROR);
  const stderr = h.log.err.join('\n');
  assert.match(stderr, /prodex ask exited with code 1/);
  assert.match(stderr, /prodex pro browser recover --port <port> --target-url <thread-url> --request-id <id>/);
  assert.ok(!stderr.includes('Usage: node scripts/prodex-slots/cli.mjs'));
});

test('removeClaimFile reports the file and the command when deletion is blocked', () => {
  const realRmSync = fs.rmSync;
  fs.rmSync = () => { const e = new Error('operation not permitted'); e.code = 'EPERM'; throw e; };
  try {
    let message = '';
    try { removeClaimFile('C:/x/slot-1.json'); } catch (error) { message = error.message; }
    assert.match(message, /could not delete C:\/x\/slot-1\.json \(EPERM\)/);
    assert.match(message, /blocked by an external policy/);
    assert.match(message, /Remove-Item -LiteralPath 'C:\/x\/slot-1\.json'/);
  } finally {
    fs.rmSync = realRmSync;
  }
});

test('a blocked temp cleanup after a successful claim warns but keeps the claim usable', async () => {
  const realRmSync = fs.rmSync;
  fs.rmSync = (target, options) => {
    if (String(target).endsWith('.tmp')) {
      const error = new Error('operation not permitted');
      error.code = 'EPERM';
      throw error;
    }
    return realRmSync(target, options);
  };
  try {
    const h = harness();
    addSlots(h.home, 1);
    assert.equal(await h.run(['run', '--slot', 'auto', '--', '--new-chat']), EXIT.OK, 'the dispatch itself succeeds');
    const stderr = h.log.err.join('\n');
    assert.match(stderr, /slot 1: could not delete .+\.tmp \(EPERM\)/);
    assert.match(stderr, /the claim itself is fine; the sweep collects the leftover/);
    assert.ok(!stderr.includes('Usage: node scripts/prodex-slots/cli.mjs'));
    assert.equal(readClaim(h.home, 1), null, 'the claim was released normally at the end');
  } finally {
    fs.rmSync = realRmSync;
  }
});

test('a blocked claim-file deletion during release is a runtime error that keeps the claim', async () => {
  const realRmSync = fs.rmSync;
  fs.rmSync = (target, options) => {
    if (String(target).endsWith('slot-1.json')) {
      const error = new Error('operation not permitted');
      error.code = 'EPERM';
      throw error;
    }
    return realRmSync(target, options);
  };
  try {
    const h = harness();
    claimSlot(h.home, 1, { pid: 111, alive: () => true, meta: { task: '71' } });
    assert.equal(await h.run(['release', '--slot', '1', '--note', 'closing']), EXIT.ERROR);
    const stderr = h.log.err.join('\n');
    assert.match(stderr, /could not delete .+slot-1\.json \(EPERM\)/);
    assert.match(stderr, /Remove-Item -LiteralPath/);
    assert.ok(!stderr.includes('Usage: node scripts/prodex-slots/cli.mjs'), 'a runtime deletion failure carries no usage block');
    assert.equal(readClaim(h.home, 1).pid, 111, 'the claim was not lost');
    assert.ok(!fs.existsSync(path.join(h.home, 'slot-claims', 'slot-1.closed.json')), 'no closure record without a successful release');
  } finally {
    fs.rmSync = realRmSync;
  }
});

test('a closure timestamp that is a valid format but an impossible date is dropped', async () => {
  const edited = harness();
  fs.mkdirSync(path.join(edited.home, 'slot-claims'), { recursive: true });
  fs.writeFileSync(path.join(edited.home, 'slot-claims', 'slot-1.closed.json'), `${JSON.stringify({
    closedAt: '2026-99-99T99:99:99.000Z',
    task: '#71',
  })}\n`);
  assert.equal(await edited.run(['list', '--json']), EXIT.OK);
  assert.equal(JSON.parse(edited.log.out[0])[0].lastClosed, undefined);
});

test('release writes a closure record that list shows as reusable', async () => {
  const h = harness();
  addSlots(h.home, 1);
  claimSlot(h.home, 1, { pid: 111, alive: () => true, meta: { task: '71', sessionKey: 's1' } });
  assert.equal(await h.run(['release', '--slot', '1', '--task', '71', '--session', 's1', '--note', '本轮线程已闭合，槽位可复用']), EXIT.OK);
  assert.equal(readClaim(h.home, 1), null, 'the claim is gone');
  const stderr = h.log.err.join('\n');
  assert.match(stderr, /released slot 1 \(claim removed\); closed record written \(#71, "本轮线程已闭合，槽位可复用"\)\. The slot is reusable\./);
  assert.equal(await h.run(['list', '--json']), EXIT.OK);
  const rows = JSON.parse(h.log.out[0]);
  assert.match(rows[0].lastClosed.closedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(rows[0].lastClosed.task, '#71');
  assert.equal(rows[0].lastClosed.sessionKey, 's1');
  assert.equal(rows[0].lastClosed.note, '本轮线程已闭合，槽位可复用');
  assert.equal(await h.run(['list']), EXIT.OK);
  assert.match(h.log.out.at(-1), /closed \d{4}-\d{2}-\d{2} \d{2}:\d{2} #71 本轮线程已闭合/);
  const next = harness({ home: h.home });
  assert.equal(await next.run(['run', '--slot', '1', '--task', '72', '--', '--new-chat']), EXIT.OK);
  assert.equal(next.log.asks[0].slot, 1, 'the closed slot took new work in the same home');
  assert.equal(readClaim(h.home, 1), null, 'the run released its own claim');
});

test('release keeps one closure record per slot and works without a claim', async () => {
  const h = harness();
  assert.equal(await h.run(['release', '--slot', '1', '--task', '71', '--note', 'first']), EXIT.OK);
  assert.equal(await h.run(['release', '--slot', '1', '--task', '72', '--note', 'second']), EXIT.OK);
  const dir = path.join(h.home, 'slot-claims');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.closed.json'));
  assert.deepEqual(files, ['slot-1.closed.json'], 'no growth across releases');
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'slot-1.closed.json'), 'utf8'));
  assert.equal(record.task, '#72', 'only the newest closure stays');
  assert.equal(record.note, 'second');
  assert.match(h.log.err.join('\n'), /no claim was present/, 'closing a slot without a claim still records');
});

test('closure notes are flattened and bounded; a hand-edited record cannot leak into list', async () => {
  const failing = harness();
  assert.equal(await failing.run(['release', '--slot', '1', '--note', `${'a\n'.repeat(150)}`]), EXIT.ERROR);
  assert.match(failing.log.err.join('\n'), /--note must be at most 200 characters/);
  assert.ok(!fs.existsSync(path.join(failing.home, 'slot-claims', 'slot-1.closed.json')), 'a rejected note writes nothing');
  const edited = harness();
  fs.mkdirSync(path.join(edited.home, 'slot-claims'), { recursive: true });
  fs.writeFileSync(path.join(edited.home, 'slot-claims', 'slot-1.closed.json'), `${JSON.stringify({
    closedAt: '2026-10-22T12:00:00.000Z',
    task: '71\nfake slot 9',
    sessionKey: 'Bearer SECRET',
    threadUrl: 'not a url',
    note: 'ok note',
  })}\n`);
  assert.equal(await edited.run(['list', '--json']), EXIT.OK);
  const text = edited.log.out.join('\n');
  assert.ok(!text.includes('SECRET') && !text.includes('slot 9'), 'invalid fields are dropped');
  const rows = JSON.parse(edited.log.out[0]);
  assert.deepEqual(rows[0].lastClosed, { closedAt: '2026-10-22T12:00:00.000Z', note: 'ok note' });
});

test('a rejected note never takes the claim down (validation runs before deletion)', async () => {
  const h = harness();
  claimSlot(h.home, 1, { pid: 111, alive: () => true, meta: { task: '71' } });
  assert.equal(await h.run(['release', '--slot', '1', '--note', 'x'.repeat(201)]), EXIT.ERROR);
  const stderr = h.log.err.join('\n');
  assert.match(stderr, /--note must be at most 200 characters/);
  assert.match(stderr, /Usage: node scripts\/prodex-slots\/cli\.mjs/, 'a rejected note is a usage error');
  assert.equal(readClaim(h.home, 1).pid, 111, 'the claim survived the rejected release');
  assert.ok(!fs.existsSync(path.join(h.home, 'slot-claims', 'slot-1.closed.json')));
});

test('run auto skips a slot whose reap mutex is stale and uses the next one', async () => {
  const h = harness();
  addSlots(h.home, 1);
  claimSlot(h.home, 1, { pid: 111, alive: () => true });
  const reap = `${claimPath(h.home, 1)}.reap`;
  fs.writeFileSync(reap, '999\n');
  fs.utimesSync(reap, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  assert.equal(await h.run(['run', '--slot', 'auto', '--', '--new-chat']), EXIT.OK);
  assert.equal(h.log.asks[0].slot, 2, 'the blocked slot was skipped');
  const stderr = h.log.err.join('\n');
  assert.match(stderr, /self-heal blocked on slot 1/);
  assert.ok(!stderr.includes('Usage: node scripts/prodex-slots/cli.mjs'), 'a blocked slot is a runtime report, not a usage error');
  assert.equal(readClaim(h.home, 2), null, 'the used slot released normally');
});

test('sweep does not echo a hand-edited pid', () => {
  const home = tempHome();
  fs.mkdirSync(path.dirname(claimPath(home, 1)), { recursive: true });
  fs.writeFileSync(claimPath(home, 1), `${JSON.stringify({ owner: 'x', pid: 'Bearer SECRET-9f', startedAt: 1 })}\n`);
  const report = sweepSlots(home, [1]);
  assert.equal(readClaim(home, 1), null, 'an invalid pid makes the claim dead and removable');
  assert.ok(!JSON.stringify(report).includes('SECRET-9f'), `the report echoed the pid: ${JSON.stringify(report)}`);
  assert.match(report[0].reason, /owner pid is invalid/);
});

test('a release that the reap mutex blocks is reported loudly after a successful ask', async () => {
  const h = harness();
  addSlots(h.home, 1);
  let armed = false;
  h.deps.runAsk = async (slot) => {
    // The mutex goes stale while the ask is running, so release happens into a blocked mutex.
    const reap = `${claimPath(h.home, slot.id)}.reap`;
    fs.writeFileSync(reap, '999\n');
    fs.utimesSync(reap, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    armed = true;
    return 0;
  };
  assert.equal(await h.run(['run', '--slot', '1', '--', '--new-chat']), EXIT.OK, 'the ask itself succeeded');
  assert.equal(armed, true);
  const stderr = h.log.err.join('\n');
  assert.match(stderr, /the claim could not be released/);
  assert.match(stderr, /treat the slot as occupied until `list` shows it free/);
  assert.ok(!stderr.includes('Usage: node scripts/prodex-slots/cli.mjs'));
  assert.equal(readClaim(h.home, 1).pid, process.pid, 'the claim is still on disk until the sweep or heartbeat clears it');
});

test('a slot the sweep found blocked is not claimed by run at all', async () => {
  const h = harness();
  addSlots(h.home, 1);
  claimSlot(h.home, 1, { pid: 111, alive: () => true });
  const reap = `${claimPath(h.home, 1)}.reap`;
  fs.writeFileSync(reap, '999\n');
  fs.utimesSync(reap, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  assert.equal(await h.run(['run', '--slot', 'auto', '--', '--new-chat']), EXIT.OK);
  assert.equal(h.log.asks[0].slot, 2, 'the sweep-blocked slot was never claimed');
  assert.equal(readClaim(h.home, 1).pid, 111, 'the pre-existing claim was left to its owner');
});

test('an unrelated sweep-blocked slot does not change the selected busy slot exit code', async () => {
  const h = harness({ states: { 2: 'busy' } });
  addSlots(h.home, 1);
  const reap = `${claimPath(h.home, 1)}.reap`;
  fs.mkdirSync(path.dirname(reap), { recursive: true });
  fs.writeFileSync(reap, '999\n');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(reap, old, old);
  assert.equal(await h.run(['run', '--slot', '2', '--wait-ms', '0', '--', '--new-chat']), EXIT.BUSY);
  assert.ok(h.log.err.some((line) => line.includes('all usable slots stayed busy')));
  assert.equal(h.log.asks.length, 0);
  assert.equal(readClaim(h.home, 2), null);
});

test('a missing prodex.mjs reports the npm root and the exact PRODEX_ENTRY command', () => {
  let message = '';
  try {
    resolveProdexEntry({ PRODEX_ENTRY: 'C:/nowhere/prodex.mjs' }, { npmRoot: 'C:/npm/root' });
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /Cannot find prodex\.mjs/);
  assert.match(message, /PRODEX_ENTRY = "C:\/npm\/root\\@youdie006\\prodex\\prodex\.mjs"/);
  assert.match(message, /Looked at: C:\/nowhere\/prodex\.mjs/);
});

test('a closure record without a usable timestamp is dropped', async () => {
  const edited = harness();
  fs.mkdirSync(path.join(edited.home, 'slot-claims'), { recursive: true });
  fs.writeFileSync(path.join(edited.home, 'slot-claims', 'slot-1.closed.json'), `${JSON.stringify({ task: '#71' })}\n`);
  assert.equal(await edited.run(['list', '--json']), EXIT.OK);
  assert.equal(JSON.parse(edited.log.out[0])[0].lastClosed, undefined);
});

const THREAD = 'https://chatgpt.com/c/6ad9e501-da24-83e9-81f9-8b5aae1f7013';
const HANDOFF = 'https://github.com/xiaolebao516/ai-one/issues/71#issuecomment-1';
const archiveArgs = ['release', '--slot', '1', '--task', '71', '--thread-url', THREAD, '--request-id', 'req-12345', '--handoff-url', HANDOFF];

test('release with archive evidence frees a real claim, then hands the exact thread to auto-finish', async () => {
  const h = harness();
  addSlots(h.home, 1);
  claimSlot(h.home, 1, { pid: 111, alive: () => true, meta: { task: '71', threadUrl: THREAD } });
  h.deps.alive = () => false; // the run that held the claim has exited; self-heal clears it
  const calls = [];
  h.deps.autoFinish = async (argv) => { calls.push(argv); return 0; };
  assert.equal(await h.run(archiveArgs), EXIT.OK);
  assert.equal(readClaim(h.home, 1), null, 'the real claim is gone');
  assert.deepEqual(calls[0], ['auto-finish', '--slot', '1', '--task', '71', '--thread-url', THREAD, '--request-id', 'req-12345', '--handoff-url', HANDOFF]);
  assert.match(h.log.err.join('\n'), /released slot 1/);
});

test('a failed or throwing archive never fails the release and is reported loudly without URLs', async () => {
  for (const autoFinish of [
    async (_argv, io) => { io.err(`prodex-archive: Handoff mismatch ${HANDOFF}`); return 1; },
    async () => { throw new Error(`module load failed ${HANDOFF}`); },
  ]) {
    const h = harness();
    addSlots(h.home, 1);
    claimSlot(h.home, 1, { pid: 111, alive: () => true, meta: { task: '71', threadUrl: THREAD } });
    h.deps.alive = () => false;
    h.deps.autoFinish = autoFinish;
    assert.equal(await h.run(archiveArgs), EXIT.OK);
    const stderr = h.log.err.join('\n');
    assert.match(stderr, /archive NOT done \(the slot is released anyway\)/);
    assert.doesNotMatch(stderr, /issuecomment/);
    assert.equal(readClaim(h.home, 1), null);
  }
});

test('release with a thread but no archive evidence says the chat was not archived', async () => {
  const h = harness();
  addSlots(h.home, 1);
  h.deps.autoFinish = async () => { throw new Error('MUST NOT CALL'); };
  assert.equal(await h.run(['release', '--slot', '1', '--task', '71', '--thread-url', THREAD]), EXIT.OK);
  assert.match(h.log.err.join('\n'), /archive NOT attempted/);
});

test('archive evidence is validated before any state changes', async () => {
  const h = harness();
  addSlots(h.home, 1);
  claimSlot(h.home, 1, { pid: 111, alive: () => true, meta: { task: '71', threadUrl: THREAD } });
  const closed = path.join(h.home, 'slot-claims', 'slot-1.closed.json');
  const bad = [
    ['release', '--slot', '1', '--task', '71', '--thread-url', THREAD, '--request-id', 'req-12345'],
    ['release', '--slot', '1', '--request-id', 'req-12345', '--handoff-url', HANDOFF],
    ['list', '--request-id', 'req-12345'],
    ['release', '--slot', '1', '--task', '71', '--thread-url', THREAD, '--request-id', 'x', '--handoff-url', HANDOFF],
    ['release', '--slot', '1', '--task', '71', '--thread-url', THREAD, '--request-id', 'req-12345', '--handoff-url', 'invalid-url'],
    ['release', '--slot', '1', '--task', '72', '--thread-url', THREAD, '--request-id', 'req-12345', '--handoff-url', HANDOFF],
  ];
  for (const args of bad) assert.equal(await h.run(args), EXIT.ERROR, args.join(' '));
  assert.ok(readClaim(h.home, 1), 'the claim is untouched');
  assert.ok(!fs.existsSync(closed), 'nothing was released');
  assert.doesNotMatch(h.log.err.join('\n'), /invalid-url|issuecomment/);
});

test('a live claim (an active run) blocks the archive release', async () => {
  const h = harness();
  addSlots(h.home, 1);
  claimSlot(h.home, 1, { pid: 111, alive: () => true, meta: { task: '99', threadUrl: THREAD } });
  h.deps.autoFinish = async () => { throw new Error('MUST NOT CALL'); };
  assert.equal(await h.run(archiveArgs), EXIT.ERROR);
  assert.ok(readClaim(h.home, 1), 'the other task keeps its claim');
  assert.match(h.log.err.join('\n'), /still active/);
});

test('with the real archive tool and a manual policy, release frees the slot and archives nothing', async () => {
  const h = harness();
  addSlots(h.home, 1);
  const { setArchivePolicy } = await import('../../prodex-archive/archive.mjs');
  await setArchivePolicy(h.home, 'manual');
  assert.equal(await h.run(archiveArgs), EXIT.OK);
  assert.match(h.log.err.join('\n'), /archive: archive policy is manual; no archive attempted/);
});

test('archive release needs a registered slot and an exact claim match, and releases conditionally', async () => {
  const h = harness();
  addSlots(h.home, 1);
  h.deps.autoFinish = async () => { throw new Error('MUST NOT CALL'); };
  const closed = (n) => path.join(h.home, 'slot-claims', `slot-${n}.closed.json`);
  // slot that is not registered
  assert.equal(await h.run(archiveArgs.map((x) => (x === '1' ? '9' : x))), EXIT.ERROR);
  assert.ok(!fs.existsSync(closed(9)));
  // claim without a thread is not an exact match
  claimSlot(h.home, 1, { pid: 111, alive: () => true, meta: { task: '71' } });
  assert.equal(await h.run(archiveArgs), EXIT.ERROR);
  assert.ok(readClaim(h.home, 1), 'partial ownership keeps its claim');
  assert.ok(!fs.existsSync(closed(1)));
  assert.match(h.log.err.join('\n'), /still active/);
});

test('a matching claim without an owner id is never deleted unconditionally', async () => {
  const h = harness();
  addSlots(h.home, 1);
  h.deps.autoFinish = async () => { throw new Error('MUST NOT CALL'); };
  claimSlot(h.home, 1, { pid: 111, alive: () => true, meta: { task: '71', threadUrl: THREAD } });
  const file = path.join(h.home, 'slot-claims', 'slot-1.json');
  const claim = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete claim.owner;
  fs.writeFileSync(file, JSON.stringify(claim));
  assert.equal(await h.run(archiveArgs), EXIT.ERROR);
  assert.ok(fs.existsSync(file), 'the claim file stays');
  assert.match(h.log.err.join(' '), /still active/);
});

test('release with archive evidence and no claim never calls an unconditional release', async () => {
  const h = harness();
  addSlots(h.home, 1);
  h.deps.autoFinish = async () => 0;
  assert.equal(await h.run(archiveArgs), EXIT.OK);
  // a claim taken after the release survives: nothing deletes slot files when none was read
  const taken = claimSlot(h.home, 1, { pid: 222, alive: () => true, meta: { task: '72' } });
  assert.ok(readClaim(h.home, 1));
  taken.release();
});

test('a run never starts on a thread whose archive is pending, and gives its claim back', async () => {
  const h = harness();
  const { setStatus } = await import('../../prodex-archive/archive.mjs');
  await setStatus(h.home, THREAD, { status: 'pending', task: '71', slot: 1 });
  assert.equal(await h.run(['run', '--slot', '1', '--task', '71', '--thread-url', THREAD, '--', '--target-url', THREAD]), EXIT.ERROR);
  assert.equal(h.log.asks.length, 0, 'no ask was sent');
  assert.equal(readClaim(h.home, 1), null, 'the claim was released');
  assert.match(h.log.err.join(' '), /being archived right now/);
});

test('a plain release with no claim read leaves a claim that appears afterwards alone', async () => {
  const h = harness();
  addSlots(h.home, 1);
  assert.equal(await h.run(['release', '--slot', '1', '--task', '71']), EXIT.OK);
  const taken = claimSlot(h.home, 1, { pid: 222, alive: () => true, meta: { task: '72' } });
  assert.ok(readClaim(h.home, 1));
  taken.release();
});

test('run needs --thread-url and --target-url to be the same thread, or neither', async () => {
  const other = 'https://chatgpt.com/c/7bd8e501-1234-83e9-9ad7-429cd3782b79';
  for (const args of [
    ['run', '--task', '71', '--thread-url', THREAD, '--', '--new-chat'],
    ['run', '--task', '71', '--', '--target-url', THREAD],
    ['run', '--task', '71', '--thread-url', THREAD, '--', '--target-url', other],
    ['run', '--task', '71', '--thread-url', THREAD, '--', '--target-url', THREAD, '--target-url', THREAD],
  ]) {
    const h = harness();
    assert.equal(await h.run(args), EXIT.ERROR, args.join(' '));
    assert.equal(h.log.asks.length, 0);
    assert.equal(readClaim(h.home, 1), null);
  }
});

test('a run backs off when the per-thread archive lock is held or the thread is archived', async () => {
  const { withLock, digest, setStatus } = await import('../../prodex-archive/archive.mjs');
  const askArgs = ['run', '--slot', '1', '--task', '71', '--thread-url', THREAD, '--', '--target-url', THREAD];
  const h = harness();
  const lock = path.join(h.home, 'archive', `thread-${digest(THREAD)}.lock`);
  let code;
  await withLock(lock, async () => { code = await h.run(askArgs); });
  assert.equal(code, EXIT.ERROR);
  assert.equal(h.log.asks.length, 0);
  assert.equal(readClaim(h.home, 1), null);
  await setStatus(h.home, THREAD, { status: 'archived', task: '71', slot: 1 });
  assert.equal(await h.run(askArgs), EXIT.ERROR);
  assert.match(h.log.err.join(' '), /already archived/);
  assert.equal(h.log.asks.length, 0);
});

test('run rejects --continue and --continue-task because their thread cannot be locked', async () => {
  for (const flag of [['--continue'], ['--continue-task', 'task_1'], ['--continue=1']]) {
    const h = harness();
    assert.equal(await h.run(['run', '--', ...flag, '--effort', 'high']), EXIT.ERROR, flag.join(' '));
    assert.equal(h.log.asks.length, 0);
  }
});

test('release over an unreadable claim file refuses and writes no closure', async () => {
  const h = harness();
  addSlots(h.home, 1);
  fs.mkdirSync(path.join(h.home, 'slot-claims'), { recursive: true });
  fs.writeFileSync(path.join(h.home, 'slot-claims', 'slot-1.json'), '{not json');
  assert.equal(await h.run(['release', '--slot', '1', '--task', '71']), EXIT.ERROR);
  assert.ok(!fs.existsSync(path.join(h.home, 'slot-claims', 'slot-1.closed.json')));
  assert.match(h.log.err.join(' '), /cannot be read/);
});

test('a stale-heartbeat claim whose process is alive still blocks archive-on-release', async () => {
  const h = harness();
  addSlots(h.home, 1);
  h.deps.autoFinish = async () => { throw new Error('MUST NOT CALL'); };
  claimSlot(h.home, 1, { pid: 111, alive: () => true, meta: { task: '71', threadUrl: THREAD } });
  const file = path.join(h.home, 'slot-claims', 'slot-1.json');
  const old = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(file, old, old);
  h.deps.now = () => Date.now();
  assert.equal(await h.run(archiveArgs), EXIT.ERROR);
  assert.ok(fs.existsSync(file), 'the claim was not swept away');
  assert.match(h.log.err.join(' '), /still active/);
});
