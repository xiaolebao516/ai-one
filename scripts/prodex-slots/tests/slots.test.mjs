import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { main, parseArgs } from '../cli.mjs';
import { EXIT, addSlots, claimSlot, loadConfig, parseCheck, readClaim, releaseClaim, slotEnv } from '../slots.mjs';

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prodex-slots-'));

function harness({ states = {}, alive = () => true, home = tempHome(), askExit = 0, askThrows = false } = {}) {
  const log = { asks: [], launches: [], out: [], err: [], clock: 0 };
  const deps = {
    home,
    alive,
    now: () => log.clock,
    sleep: async (ms) => { log.clock += ms; },
    profileExists: () => true,
    checkSlot: async (slot) => ({ state: states[slot.id] ?? 'ready' }),
    launchHeaded: async (slot) => { log.launches.push(slot.id); },
    runAsk: async (slot, args) => {
      log.asks.push({ slot: slot.id, args, claimed: readClaim(home, slot.id) });
      if (askThrows) throw new Error('boom');
      return askExit;
    },
  };
  const run = (args) => main(args, { deps, out: (s) => log.out.push(s), err: (s) => log.err.push(s) });
  return { deps, log, run, home };
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
  assert.equal(parseCheck('nothing useful').state, 'unknown');
});

test('a live holder blocks a claim; a dead holder is reaped; release only drops own claim', () => {
  const home = tempHome();
  const first = claimSlot(home, 2, { pid: 111, label: 'a', alive: () => true });
  assert.equal(first.ok, true);
  const blocked = claimSlot(home, 2, { pid: 222, alive: () => true });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.holder.pid, 111);
  const reaped = claimSlot(home, 2, { pid: 222, alive: () => false });
  assert.equal(reaped.ok, true);
  assert.equal(readClaim(home, 2).pid, 222);
  assert.equal(first.release(), false);
  assert.equal(readClaim(home, 2).pid, 222);
  assert.equal(releaseClaim(home, 2), true);
  assert.equal(readClaim(home, 2), null);
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
  assert.throws(() => parseArgs(['list', '--', 'x']), /no arguments/);
});

test('run auto takes the first ready idle slot and always releases its claim', async () => {
  const h = harness();
  addSlots(h.home, 1);
  assert.equal(await h.run(['run', '--', '--new-chat', '--session-key', 'k1']), EXIT.OK);
  assert.equal(h.log.asks.length, 1);
  assert.equal(h.log.asks[0].slot, 1);
  assert.equal(h.log.asks[0].claimed.label, 'k1');
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

test('run releases the claim and passes the exit code through when ask fails or throws', async () => {
  const failing = harness({ askExit: 5 });
  assert.equal(await failing.run(['run', '--', '--new-chat']), 5);
  assert.equal(readClaim(failing.home, 1), null);
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

test('run waits while ready slots are busy and gives up after --wait-ms', async () => {
  const h = harness();
  claimSlot(h.home, 1, { pid: 999, alive: () => true });
  assert.equal(await h.run(['run', '--wait-ms', '5000', '--', '--new-chat']), EXIT.BUSY);
  assert.equal(h.log.asks.length, 0);
  assert.ok(h.log.clock >= 5000);
});

test('run treats a slot that is still generating as busy, not as broken, and uses a hidden one never', async () => {
  const busy = harness({ states: { 1: 'busy' } });
  assert.equal(await busy.run(['run', '--wait-ms', '4000', '--', '--new-chat']), EXIT.BUSY);
  assert.equal(busy.log.asks.length, 0);
  assert.equal(readClaim(busy.home, 1), null);
  const mixed = harness({ states: { 1: 'busy', 2: 'hidden' } });
  addSlots(mixed.home, 1);
  assert.equal(await mixed.run(['run', '--wait-ms', '4000', '--', '--new-chat']), EXIT.BUSY);
  assert.equal(mixed.log.asks.length, 0);
});

test('ensure leaves a busy slot alone but asks the user about a hidden window', async () => {
  const ok = harness({ states: { 1: 'busy' } });
  assert.equal(await ok.run(['ensure']), EXIT.OK);
  const hidden = harness({ states: { 1: 'hidden' } });
  assert.equal(await hidden.run(['ensure']), EXIT.NEEDS_USER);
  assert.match(hidden.log.err.join('\n'), /slot 1 \(hidden\)/);
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

test('add registers slots, opens windows for browsers that are down and asks the user to log in', async () => {
  const h = harness({ states: { 2: 'down' } });
  assert.equal(await h.run(['add', '--count', '1', '--json']), EXIT.NEEDS_USER);
  assert.deepEqual(h.log.launches, [2]);
  assert.equal(loadConfig(h.home).count, 2);
  assert.deepEqual(JSON.parse(h.log.out[0]), [{ id: 2, port: 9334, state: 'down' }]);
  assert.match(h.log.err.join('\n'), /user must act on slot 2 \(down\).*log in to ChatGPT/);
});

test('ensure is silent when every slot is ready and reopens a closed browser that is still logged in', async () => {
  const quiet = harness();
  assert.equal(await quiet.run(['ensure']), EXIT.OK);
  assert.deepEqual(quiet.log.launches, []);
  const h = harness();
  addSlots(h.home, 1);
  let calls = 0;
  h.deps.checkSlot = async (slot) => ({ state: slot.id === 2 && ++calls === 1 ? 'down' : 'ready' });
  assert.equal(await h.run(['ensure']), EXIT.OK);
  assert.deepEqual(h.log.launches, [2]);
});

test('list reports state and a live claim', async () => {
  const h = harness({ states: { 1: 'ready' } });
  claimSlot(h.home, 1, { pid: 321, label: 'rev', alive: () => true });
  assert.equal(await h.run(['list', '--json']), EXIT.OK);
  assert.deepEqual(JSON.parse(h.log.out[0]), [{ id: 1, port: 9333, state: 'ready', busyWith: { pid: 321, label: 'rev' } }]);
});
