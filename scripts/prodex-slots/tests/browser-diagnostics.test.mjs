import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { main, realDeps } from '../cli.mjs';
import { addSlots, EXIT } from '../slots.mjs';
import { classifyWindowsBrowserProcesses } from '../browser-diagnostics.mjs';

const PROFILE2 = 'C:\\Users\\Tester\\AppData\\Local\\Prodex\\chrome-chatgpt-pro-slot2';
const PROFILE3 = 'C:\\Users\\Tester\\AppData\\Local\\Prodex\\chrome-chatgpt-pro-slot3';
const SLOT2 = { id: 2, port: 9334, profileDir: PROFILE2, lockFile: 'C:\\Users\\Tester\\AppData\\Local\\Prodex\\browser-send-slot2.lock' };

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prodex-browser-diagnostics-'));

function browserProcess({ name = 'msedge.exe', port = 9334, profile = PROFILE2, type = null } = {}) {
  const executable = name === 'chrome.exe'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const typeArg = type ? ' --type=' + type : '';
  return {
    Name: name,
    ProcessId: 1234,
    CommandLine: '"' + executable + '" --remote-debugging-port=' + port + ' --user-data-dir="' + profile + '"' + typeArg,
  };
}

function mockRealDeps({
  home = tempHome(),
  platform = 'win32',
  check = 'chatgpt: browser_unreachable - endpoint unavailable',
  processes = [browserProcess()],
  processProbeError = false,
  fetchFn = async () => { throw new Error('PRIVATE-CDP-ERROR'); },
} = {}) {
  const calls = { powershell: 0, fetch: 0 };
  const spawnSyncFn = (command) => {
    if (command === 'powershell.exe') {
      calls.powershell += 1;
      if (processProbeError) {
        return { status: 1, stderr: 'PRIVATE-ACCESS-DENIED', stdout: '' };
      }
      return { status: 0, stdout: JSON.stringify(processes) };
    }
    return { status: 1, stdout: check, stderr: 'PRIVATE-PRODEX-ERROR' };
  };
  const deps = realDeps(home, {
    platform,
    env: { PRODEX_ENTRY: process.execPath },
    spawnSyncFn,
    fetchFn: async (...args) => {
      calls.fetch += 1;
      return fetchFn(...args);
    },
  });
  return { deps, calls, home };
}

test('only the exact main browser process with the exact port and full profile path matches', () => {
  assert.deepEqual(classifyWindowsBrowserProcesses([browserProcess()], SLOT2), { state: 'running' });

  assert.equal(classifyWindowsBrowserProcesses([
    browserProcess({ port: 9335, profile: PROFILE3 }),
  ], SLOT2).state, 'absent', 'another slot does not match');

  assert.equal(classifyWindowsBrowserProcesses([
    browserProcess({ port: 93340 }),
  ], SLOT2).state, 'ambiguous', 'a port prefix is not an exact match');

  assert.equal(classifyWindowsBrowserProcesses([
    browserProcess({ profile: PROFILE2 + '-backup' }),
  ], SLOT2).state, 'ambiguous', 'a profile-name prefix is not an exact match');

  assert.equal(classifyWindowsBrowserProcesses([
    browserProcess({ type: 'renderer' }),
  ], SLOT2).state, 'ambiguous', 'a child process is never counted as the main browser');

  assert.equal(classifyWindowsBrowserProcesses([
    browserProcess({ name: 'firefox.exe' }),
  ], SLOT2).state, 'absent', 'an unrelated executable is not a browser match');
});

test('whole quoted Windows arguments still identify the live dedicated browser', () => {
  const profile = 'C:\\Prodex Profiles\\slot2';
  const process = browserProcess();
  process.CommandLine = '"C:\\Program Files\\Edge\\msedge.exe" "--remote-debugging-port=9334" "--user-data-dir=' + profile + '"';
  assert.equal(classifyWindowsBrowserProcesses([process], { ...SLOT2, profileDir: profile }).state, 'running');
});

test('a live matching process with an unresponsive CDP port is unknown, never down', async () => {
  const { deps, calls } = mockRealDeps({ processes: [browserProcess()] });
  const result = await deps.checkSlot(SLOT2);

  assert.equal(result.state, 'unknown');
  assert.match(result.detail, /process is running, but its debugging port is not responding/);
  assert.match(result.detail, /No automatic restart was attempted/);
  assert.equal(calls.powershell, 1);
  assert.equal(calls.fetch, 1);
  assert.ok(!JSON.stringify(result).includes(PROFILE2));
  assert.ok(!JSON.stringify(result).includes('PRIVATE-CDP-ERROR'));
});

test('no browser process and no CDP response is the only confirmed down case', async () => {
  const { deps } = mockRealDeps({ processes: [] });
  const result = await deps.checkSlot(SLOT2);

  assert.equal(result.state, 'down');
  assert.match(result.detail, /No matching browser process was found/);
});

test('a failed or permission-denied process probe cannot infer down', async () => {
  const { deps } = mockRealDeps({ processProbeError: true });
  const result = await deps.checkSlot(SLOT2);

  assert.equal(result.state, 'unknown');
  assert.match(result.detail, /Could not verify whether the browser is closed/);
  assert.ok(!JSON.stringify(result).includes('PRIVATE-ACCESS-DENIED'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE-CDP-ERROR'));
});

test('a responding CDP endpoint without a ChatGPT page is unknown, not down', async () => {
  const { deps } = mockRealDeps({
    processes: [browserProcess()],
    fetchFn: async (url) => {
      if (url.endsWith('/json/version')) {
        return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9334/devtools/browser/PRIVATE' }) };
      }
      return { ok: true, json: async () => [] };
    },
  });
  const result = await deps.checkSlot(SLOT2);

  assert.equal(result.state, 'unknown');
  assert.match(result.detail, /no ChatGPT page is available yet/);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('existing ready, busy, hidden and login states bypass extra diagnostics unchanged', async () => {
  const cases = [
    ['chatgpt: ok logged_in=true composer=true', 'ready'],
    ['chatgpt: busy response_in_progress - generating', 'busy'],
    ['chatgpt: blocked tab_not_visible visibility=hidden - hidden tab', 'hidden'],
    ['chatgpt: login_required - sign in', 'needs-login'],
  ];
  for (const [check, expected] of cases) {
    const { deps, calls } = mockRealDeps({ check, processes: [] });
    const result = await deps.checkSlot(SLOT2);
    assert.equal(result.state, expected);
    assert.equal(calls.powershell, 0, expected + ' must not trigger a process probe');
    assert.equal(calls.fetch, 0, expected + ' must not trigger a CDP probe');
  }
});

test('ensure never relaunches a browser when process/port evidence is uncertain', async () => {
  const home = tempHome();
  addSlots(home, 1);
  const { deps } = mockRealDeps({ home, processes: [browserProcess()] });
  const checkSlot = deps.checkSlot.bind(deps);
  deps.checkSlot = (slot) => checkSlot(slot.id === 2 ? { ...slot, profileDir: PROFILE2 } : slot);
  const launches = [];
  deps.launchHeaded = async (slot) => { launches.push(slot.id); return { ok: true }; };
  const out = [];
  const err = [];

  const code = await main(['ensure', '--json'], {
    deps,
    out: (value) => out.push(value),
    err: (value) => err.push(value),
  });

  assert.equal(code, EXIT.NEEDS_USER);
  assert.deepEqual(launches, []);
  const rows = JSON.parse(out[0]);
  assert.equal(rows.find((row) => row.id === 2).state, 'unknown');
  assert.match(err.join('\n'), /no automatic restart was attempted/);
});


test('unsupported platforms report unknown rather than inferring the browser is closed', async () => {
  const { deps } = mockRealDeps({ platform: 'linux', processes: [] });
  const result = await deps.checkSlot(SLOT2);

  assert.equal(result.state, 'unknown');
  assert.match(result.detail, /cannot verify the browser process/);
});

test('ensure keeps polling a newly launched browser while its page state is unknown', async () => {
  const home = tempHome();
  addSlots(home, 1);
  const states = ['down', 'unknown', 'ready'];
  const launches = [];
  let now = 0;
  const deps = {
    home,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    profileExists: () => true,
    checkSlot: async () => {
      const state = states.shift() ?? 'ready';
      return { state, ...(state === 'unknown' ? { detail: 'browser starting' } : {}) };
    },
    launchHeaded: async (slot) => { launches.push(slot.id); return { ok: true }; },
  };
  const out = [];
  const err = [];

  const code = await main(['ensure', '--json'], {
    deps,
    out: (value) => out.push(value),
    err: (value) => err.push(value),
  });

  assert.equal(code, EXIT.OK);
  assert.deepEqual(launches, [1]);
  assert.equal(JSON.parse(out[0])[0].state, 'ready');
  assert.equal(now, 4000, 'polling continues through an intermediate unknown state');
});


test('list surfaces safe diagnostic guidance for an uncertain browser state', async () => {
  const home = tempHome();
  addSlots(home, 1);
  const { deps } = mockRealDeps({ home, processes: [browserProcess()] });
  const checkSlot = deps.checkSlot.bind(deps);
  deps.checkSlot = (slot) => checkSlot(slot.id === 2 ? { ...slot, profileDir: PROFILE2 } : slot);
  const out = [];
  const err = [];

  const code = await main(['list', '--json'], {
    deps,
    out: (value) => out.push(value),
    err: (value) => err.push(value),
  });

  assert.equal(code, EXIT.OK);
  const row = JSON.parse(out[0]).find((item) => item.id === 2);
  assert.equal(row.state, 'unknown');
  assert.match(row.detail, /debugging port is not responding/);
  assert.ok(!JSON.stringify(row).includes(PROFILE2));
});

test('run reports the uncertain browser cause without misdirecting to login or more slots', async () => {
  const home = tempHome();
  addSlots(home, 1);
  const { deps } = mockRealDeps({ home });
  const checkSlot = deps.checkSlot.bind(deps);
  deps.checkSlot = (slot) => checkSlot({ ...slot, profileDir: PROFILE2 });
  deps.runAsk = async () => assert.fail('must not send on an uncertain browser');
  const err = [];
  const code = await main(['run', '--slot', '2', '--', '--new-chat'], {
    deps, out: () => {}, err: (value) => err.push(value),
  });
  assert.equal(code, EXIT.NEEDS_USER);
  assert.match(err.join('\n'), /process is running, but its debugging port is not responding/);
  assert.doesNotMatch(err.join('\n'), /Ask the user to sign in|add slots/);
});
