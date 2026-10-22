#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXIT, addSlots, claimOwnership, claimSlot, loadConfig, normalizeOwnership, parseCheck, processAlive, readClaim, releaseClaim, slotEnv, slotsHome } from './slots.mjs';

export const usage = [
  'Usage: node scripts/prodex-slots/cli.mjs <command> [options]',
  '  list [--json]                         slots, browser state, claims and who they serve',
  '  add --count N [--json]                register N more slots and open their login windows',
  '  ensure [--json]                       reopen slot browsers that are not running',
  '  run [--slot N|auto] [--wait-ms MS] [--task N] [--session KEY] [--thread-url URL]',
  '                                        -- <args of `prodex pro browser ask`>',
  '  release --slot N                      drop a stale claim',
  'Ownership (run only): --task 71, --session s1, --thread-url https://chatgpt.com/c/<id>.',
  'They are shown by `list` so another session can see who a slot serves; never reply text.',
  'Use the ask\'s own --session-key after `--`: that one is prodex\'s, this one is ownership.',
  'Exit: 0 ok, 1 error (also any failure of the prodex ask itself), 3 needs the user, 4 all ready slots busy past --wait-ms.',
  '`run` passes the ask output (the reply) through to stdout: redirect it to a file, do not log it.',
].join('\n');

const VALUE_OPTIONS = { '--slot': 'slot', '--count': 'count', '--wait-ms': 'waitMs', '--task': 'task', '--session': 'sessionKey', '--thread-url': 'threadUrl' };
const OWNERSHIP_FLAGS = { task: '--task', sessionKey: '--session', threadUrl: '--thread-url' };
const NUMERIC_OPTIONS = new Set(['--slot', '--count', '--wait-ms']);
// States that are not a problem for the user: the slot works or will work by itself.
const NO_USER_ACTION = new Set(['ready', 'busy']);

export function parseArgs(args) {
  const separator = args.indexOf('--');
  const head = separator === -1 ? args : args.slice(0, separator);
  const passthrough = separator === -1 ? [] : args.slice(separator + 1);
  const [command, ...rest] = head;
  const options = { slot: 'auto', waitMs: 600_000, json: false };
  const seen = new Set();
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === '--json') { options.json = true; continue; }
    if (!(arg in VALUE_OPTIONS)) {
      // Report at most the option name, and only when it is one this tool knows. A token pasted
      // in the wrong place arrives here as an "option" too, so nothing unrecognized is repeated.
      const name = arg.split('=')[0];
      if (name in VALUE_OPTIONS || name === '--json') {
        throw new Error(`Unknown option: ${name}. Options take their value as the next argument (${name} <value>); the "=" form is not accepted here`);
      }
      throw new Error('Unknown option. Expected one of: --json, --slot, --count, --wait-ms, --task, --session, --thread-url, each with its value as the next argument; the "=" form is not accepted');
    }
    const value = rest[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
    if (!NUMERIC_OPTIONS.has(arg)) { options[VALUE_OPTIONS[arg]] = value; continue; }
    if (arg === '--slot' && value === 'auto') continue;
    if (!/^\d+$/.test(value)) throw new Error(`Invalid integer: ${arg}`);
    options[VALUE_OPTIONS[arg]] = Number(value);
  }
  if (command === 'run') {
    if (!passthrough.length) throw new Error('run needs the ask arguments after `--`');
    if (passthrough.includes('--port') || passthrough.some((a) => a.startsWith('--port='))) {
      throw new Error('Do not pass --port: the slot decides the browser');
    }
  } else if (passthrough.length) {
    throw new Error('Only `run` takes arguments after `--`');
  }
  if (command === 'add' && !options.count) throw new Error('add needs --count N');
  if (command === 'release' && options.slot === 'auto') throw new Error('release needs --slot N');
  const provided = Object.keys(OWNERSHIP_FLAGS).filter((key) => options[key] !== undefined);
  if (provided.length) {
    // Ownership is recorded in the claim, so only a command that takes a claim can carry it.
    // The command is not validated (it may be a token pasted in the wrong place), so the message
    // names the flags and the rule, not the command.
    if (command !== 'run') {
      throw new Error(`${provided.map((key) => OWNERSHIP_FLAGS[key]).join(' / ')} only apply to run`);
    }
    options.ownership = normalizeOwnership({
      task: options.task,
      sessionKey: options.sessionKey,
      threadUrl: options.threadUrl,
    });
  } else {
    options.ownership = {};
  }
  return { command, options, passthrough };
}

export function resolveProdexEntry(env = process.env) {
  const candidates = [];
  if (env.PRODEX_ENTRY) candidates.push(env.PRODEX_ENTRY);
  const npm = spawnSync('npm root -g', { encoding: 'utf8', shell: true, windowsHide: true });
  if (npm.status === 0) candidates.push(path.join(String(npm.stdout).trim(), '@youdie006', 'prodex', 'prodex.mjs'));
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error('Cannot find prodex.mjs; set PRODEX_ENTRY to its absolute path');
  return found;
}

// Un-minimizes (without activating) the Edge window that owns the slot's debug port.
function restoreScript(port) {
  return `
Add-Type -Namespace S -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);'
$restored = $false
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -match 'remote-debugging-port=${port}( |$)' -and $_.CommandLine -notmatch '--type=' } | ForEach-Object {
  $h = (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).MainWindowHandle
  if ($h -and [S.W]::IsIconic($h)) { [void][S.W]::ShowWindow($h, 4); $restored = $true }
}
if ($restored) { 'restored' }`;
}

export function realDeps(home = slotsHome()) {
  let entry;
  const prodex = (args) => ({ entry: (entry ??= resolveProdexEntry()), args });
  return {
    home,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    profileExists: (slot) => !slot.profileDir || fs.existsSync(slot.profileDir),
    checkSlot(slot) {
      const { entry: file, args } = prodex(['pro', 'browser', 'check', '--port', String(slot.port)]);
      const result = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
      // `check` exits 1 for harmless reasons (for example a missing optional config), so only
      // a failure to run it at all is an error; the browser state comes from its output.
      if (result.error || result.signal) return { state: 'error', detail: `check did not run: ${result.error?.code ?? result.signal}` };
      return parseCheck(`${result.stdout ?? ''}`);
    },
    launchHeaded(slot) {
      const { entry: file, args } = prodex([
        'pro', 'browser', 'login', '--port', String(slot.port),
        ...(slot.profileDir ? ['--profile-dir', slot.profileDir] : []),
        '--cwd', process.cwd(), '--headed', '--no-wait',
      ]);
      const result = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
      if (result.error || result.signal || result.status !== 0) {
        return { ok: false, detail: `login exited ${result.error?.code ?? result.signal ?? result.status}` };
      }
      return { ok: true };
    },
    restoreWindow(slot) {
      if (process.platform !== 'win32') return false;
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', restoreScript(slot.port)], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
      return result.status === 0 && /restored/.test(result.stdout ?? '');
    },
    runAsk(slot, askArgs) {
      const { entry: file, args } = prodex(['pro', 'browser', 'ask', ...askArgs]);
      return new Promise((resolve) => {
        const child = spawn(process.execPath, [file, ...args], { env: slotEnv(slot), stdio: 'inherit' });
        child.on('error', () => resolve(EXIT.ERROR));
        child.on('close', (code) => resolve(code ?? EXIT.ERROR));
      });
    },
  };
}

async function describeSlots(config, deps) {
  return Promise.all(config.slots.map(async (slot) => {
    const claim = readClaim(deps.home, slot.id);
    const busy = claim && (deps.alive ?? processAlive)(claim.pid);
    return { id: slot.id, port: slot.port, state: (await deps.checkSlot(slot)).state, busyWith: busy ? { pid: claim.pid, ...claimOwnership(claim) } : null };
  }));
}

// A minimized window is restored once before it is reported as needing the user.
async function checkWithRestore(slot, deps) {
  let result = await deps.checkSlot(slot);
  if (result.state === 'hidden' && deps.restoreWindow && await deps.restoreWindow(slot)) {
    await deps.sleep(1000);
    result = await deps.checkSlot(slot);
  }
  return result;
}

async function ensureSlots(slots, deps, { pollMs = 2000, timeoutMs = 20_000 } = {}) {
  const results = [];
  for (const slot of slots) {
    let { state, detail } = await checkWithRestore(slot, deps);
    if (state === 'down') {
      const launched = await deps.launchHeaded(slot);
      if (launched && launched.ok === false) {
        state = 'error';
        detail = launched.detail;
      } else {
        const deadline = deps.now() + timeoutMs;
        while (deps.now() < deadline) {
          await deps.sleep(pollMs);
          ({ state, detail } = await checkWithRestore(slot, deps));
          if (state !== 'down') break;
        }
      }
    }
    results.push({ id: slot.id, port: slot.port, state, ...(detail ? { detail } : {}) });
  }
  return results;
}

// The task and session are what a reader needs to tell two busy slots apart; the thread URL is
// kept in the listing rather than on this line, which `run` writes while it is already busy.
function ownershipLabel(ownership = {}) {
  return [ownership.task, ownership.sessionKey].filter(Boolean).join(' ');
}

function renderSlots(rows) {
  return rows.map((r) => {
    const owned = r.busyWith ? [r.busyWith.task, r.busyWith.sessionKey, r.busyWith.threadUrl].filter(Boolean).join(' ') : '';
    return `slot ${r.id}  port ${r.port}  ${r.state}${r.detail ? ` (${r.detail})` : ''}${r.busyWith ? `  busy (pid ${r.busyWith.pid})${owned ? ` ${owned}` : ''}` : ''}`;
  }).join('\n');
}

async function runCommand(options, passthrough, deps, err) {
  const config = loadConfig(deps.home);
  const wanted = options.slot === 'auto' ? config.slots : config.slots.filter((s) => s.id === options.slot);
  if (!wanted.length) throw new Error(`No such slot: ${options.slot}`);
  const deadline = deps.now() + options.waitMs;
  const notReady = new Map();
  for (;;) {
    let anyReadyButBusy = false;
    for (const slot of wanted) {
      if (notReady.has(slot.id)) continue;
      const claim = claimSlot(deps.home, slot.id, { alive: deps.alive, now: deps.now, meta: options.ownership });
      if (!claim.ok) { anyReadyButBusy = true; continue; }
      try {
        const { state } = await checkWithRestore(slot, deps);
        if (state === 'busy') { anyReadyButBusy = true; continue; }
        if (state !== 'ready') { notReady.set(slot.id, state); continue; }
        const label = ownershipLabel(options.ownership);
        err(`prodex-slots: using slot ${slot.id} (port ${slot.port})${label ? ` for ${label}` : ''}`);
        // The ask's own exit code is not part of this tool's 0/1/3/4 contract: any failure is 1.
        const code = await deps.runAsk(slot, passthrough);
        if (code !== 0) err(`prodex-slots: prodex ask exited with code ${code}`);
        return code === 0 ? EXIT.OK : EXIT.ERROR;
      } finally {
        claim.release();
      }
    }
    if (notReady.size === wanted.length) {
      const detail = [...notReady].map(([id, state]) => `slot ${id}: ${state}`).join('; ');
      if ([...notReady.values()].includes('error')) {
        err(`prodex-slots: could not probe a slot (${detail}); check that prodex is installed and runs.`);
        return EXIT.ERROR;
      }
      err(`prodex-slots: no usable slot. ${detail}. Ask the user to sign in or complete any ChatGPT verification (run \`ensure\`), or to add slots (\`add --count N\`).`);
      return EXIT.NEEDS_USER;
    }
    if (!anyReadyButBusy || deps.now() >= deadline) {
      err('prodex-slots: all usable slots stayed busy within --wait-ms');
      return EXIT.BUSY;
    }
    await deps.sleep(2000);
  }
}

export async function main(args, { deps = realDeps(), out = (s) => process.stdout.write(`${s}\n`), err = (s) => process.stderr.write(`${s}\n`) } = {}) {
  try {
    if (!args.length || args[0] === '--help') { out(usage); return EXIT.OK; }
    const { command, options, passthrough } = parseArgs(args);
    const show = (rows) => out(options.json ? JSON.stringify(rows, null, 2) : renderSlots(rows));
    if (command === 'list') {
      show(await describeSlots(loadConfig(deps.home), deps));
      return EXIT.OK;
    }
    if (command === 'add' || command === 'ensure') {
      const slots = command === 'add' ? addSlots(deps.home, options.count) : loadConfig(deps.home).slots;
      const fresh = new Set(slots.filter((s) => !deps.profileExists(s)).map((s) => s.id));
      const rows = await ensureSlots(slots, deps, { timeoutMs: fresh.size ? 5000 : 20_000 });
      show(rows);
      const failed = rows.filter((r) => r.state === 'error');
      if (failed.length) {
        err(`prodex-slots: could not start or probe slot ${failed.map((r) => `${r.id} (${r.detail ?? 'error'})`).join(', ')}; this is not a login problem.`);
        return EXIT.ERROR;
      }
      const pending = rows.filter((r) => !NO_USER_ACTION.has(r.state));
      if (pending.length) err(`prodex-slots: the user must act on slot ${pending.map((r) => `${r.id} (${r.state})`).join(', ')}: sign in to ChatGPT or complete any verification in its window; then run \`list\`.`);
      return pending.length ? EXIT.NEEDS_USER : EXIT.OK;
    }
    if (command === 'release') {
      releaseClaim(deps.home, options.slot);
      return EXIT.OK;
    }
    if (command === 'run') return await runCommand(options, passthrough, deps, err);
    // The command is an argv token this tool did not recognise, so it is not repeated either.
    throw new Error('Unknown command. The first argument must be one of: list, add, ensure, run, release (or --help)');
  } catch (error) {
    err(`${error.message}\n${usage}`);
    return EXIT.ERROR;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
