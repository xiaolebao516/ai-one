#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXIT, addSlots, claimOwnership, claimSlot, loadConfig, normalizeNote, normalizeOwnership, parseCheck, processAlive, readClaim, readClosure, releaseClaim, slotEnv, slotsHome, sweepSlots, writeClosure } from './slots.mjs';

// Argument mistakes (bad flags, missing values, unknown commands) are usage errors: the reason
// plus the full usage block. Anything that fails at runtime carries its own next step and is
// printed without the usage block - see the catch in main().
export class UsageError extends Error {}

export const usage = [
  'Usage: node scripts/prodex-slots/cli.mjs <command> [options]',
  '  list [--json]                         slots, browser state, claims and who they serve',
  '  add --count N [--json]                register N more slots and open their login windows',
  '  ensure [--json]                       reopen slot browsers that are not running',
  '  run [--slot N|auto] [--wait-ms MS] [--task N] [--session KEY] [--thread-url URL]',
  '                                        -- <args of `prodex pro browser ask`>',
  '  release --slot N [--task N] [--session KEY] [--thread-url URL] [--note "…"]',
  '                                        write the "thread closed, slot reusable" record',
  'Ownership (run and release): --task 71, --session s1, --thread-url https://chatgpt.com/c/<id>.',
  'They are shown by `list` so another session can see who a slot serves; never reply text.',
  'Use the ask\'s own --session-key after `--`: that one is prodex\'s, this one is ownership.',
  'Exit: 0 ok, 1 error (also any failure of the prodex ask itself), 3 needs the user, 4 all ready slots busy past --wait-ms.',
  '`run` passes the ask output (the reply) through to stdout: redirect it to a file, do not log it.',
].join('\n');

const VALUE_OPTIONS = { '--slot': 'slot', '--count': 'count', '--wait-ms': 'waitMs', '--task': 'task', '--session': 'sessionKey', '--thread-url': 'threadUrl', '--note': 'note' };
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
    // Ownership lands in the claim (run) or the closure record (release); the other commands
    // keep no per-slot record of their own, so they refuse the flags outright. The command is
    // not validated (it may be a token pasted in the wrong place), so the message names the
    // flags and the rule, not the command.
    if (command !== 'run' && command !== 'release') {
      throw new UsageError(`${provided.map((key) => OWNERSHIP_FLAGS[key]).join(' / ')} only apply to run and release`);
    }
    options.ownership = normalizeOwnership({
      task: options.task,
      sessionKey: options.sessionKey,
      threadUrl: options.threadUrl,
    });
  } else {
    options.ownership = {};
  }
  if (options.note !== undefined && command !== 'release') {
    throw new UsageError('--note only applies to release');
  }
  // Validate the note here, before release touches any state: a rejected note must not take the
  // claim down with it.
  if (command === 'release') options.note = options.note === undefined ? undefined : normalizeNote(options.note);
  return { command, options, passthrough };
}

export function resolveProdexEntry(env = process.env) {
  const candidates = [];
  let npmRoot = '';
  if (env.PRODEX_ENTRY) candidates.push(env.PRODEX_ENTRY);
  const npm = spawnSync('npm root -g', { encoding: 'utf8', shell: true, windowsHide: true });
  if (npm.status === 0) {
    npmRoot = String(npm.stdout).trim();
    candidates.push(path.join(npmRoot, '@youdie006', 'prodex', 'prodex.mjs'));
  }
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) {
    const how = npmRoot
      ? `PowerShell: $env:PRODEX_ENTRY = "${npmRoot}\\@youdie006\\prodex\\prodex.mjs"`
      : 'PowerShell: $env:PRODEX_ENTRY = "<path to>\\prodex.mjs" (npm root -g produced nothing)';
    throw new Error(`Cannot find prodex.mjs. Set PRODEX_ENTRY to its absolute path - ${how}. Looked at: ${candidates.join(', ') || 'nothing'}`);
  }
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

// Self-heal pass before any command that reads or takes state: dead claims and `.tmp`
// leftovers go away, blocked slots are reported with a hand-deletion command. The report is
// attached to the matching `list` rows and summarized on stderr for the other commands.
function sweepAndReport(config, deps, err) {
  const report = sweepSlots(deps.home, config.slots.map((slot) => slot.id), { alive: deps.alive ?? processAlive });
  for (const item of report) {
    if (item.blocked) err(`prodex-slots: self-heal blocked on slot ${item.slot}: ${item.blocked}`);
    else err(`prodex-slots: self-heal removed the ${item.removed} of slot ${item.slot} (${item.reason})`);
  }
  return report;
}

async function describeSlots(config, deps, sweepReport = []) {
  return Promise.all(config.slots.map(async (slot) => {
    const claim = readClaim(deps.home, slot.id);
    const busy = claim && (deps.alive ?? processAlive)(claim.pid);
    const reaped = sweepReport.filter((item) => item.slot === slot.id && item.removed)
      .map(({ removed, reason }) => ({ removed, reason }));
    const closure = readClosure(deps.home, slot.id);
    return {
      id: slot.id,
      port: slot.port,
      state: (await deps.checkSlot(slot)).state,
      ...(reaped.length ? { reaped } : {}),
      ...(closure ? { lastClosed: closure } : {}),
      busyWith: busy ? { pid: claim.pid, ...claimOwnership(claim) } : null,
    };
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
    const swept = r.reaped ? `  [self-healed: ${r.reaped.map((x) => x.removed).join(' + ')}]` : '';
    const closed = r.lastClosed
      ? `  closed ${r.lastClosed.closedAt.slice(0, 16).replace('T', ' ')} ${[r.lastClosed.task, r.lastClosed.note].filter(Boolean).join(' ')}`.slice(0, 120)
      : '';
    return `slot ${r.id}  port ${r.port}  ${r.state}${r.detail ? ` (${r.detail})` : ''}${swept}${r.busyWith ? `  busy (pid ${r.busyWith.pid})${owned ? ` ${owned}` : ''}` : ''}${closed}`;
  }).join('\n');
}

async function runCommand(options, passthrough, deps, err) {
  const config = loadConfig(deps.home);
  const wanted = options.slot === 'auto' ? config.slots : config.slots.filter((s) => s.id === options.slot);
  if (!wanted.length) {
    throw new Error(`No such slot: ${options.slot}. Registered slots: ${config.slots.map((s) => s.id).join(', ')} (ports ${config.slots.map((s) => s.port).join(', ')})`);
  }
  const deadline = deps.now() + options.waitMs;
  const notReady = new Map();
  const blocked = new Map();
  for (;;) {
    let anyReadyButBusy = false;
    for (const slot of wanted) {
      if (notReady.has(slot.id) || blocked.has(slot.id)) continue;
      let claim;
      try {
        claim = claimSlot(deps.home, slot.id, { alive: deps.alive, now: deps.now, meta: options.ownership });
      } catch (error) {
        // A stale .reap mutex (or a policy-blocked deletion) makes this slot unclaimable; the
        // sweep report has already printed the fix. Skip it and let the other slots work.
        blocked.set(slot.id, error.message);
        continue;
      }
      if (!claim.ok) { anyReadyButBusy = true; continue; }
      try {
        const { state } = await checkWithRestore(slot, deps);
        if (state === 'busy') { anyReadyButBusy = true; continue; }
        if (state !== 'ready') { notReady.set(slot.id, state); continue; }
        const label = ownershipLabel(options.ownership);
        err(`prodex-slots: using slot ${slot.id} (port ${slot.port})${label ? ` for ${label}` : ''}`);
        // The ask's own exit code is not part of this tool's 0/1/3/4 contract: any failure is 1.
        const code = await deps.runAsk(slot, passthrough);
        if (code !== 0) err(`prodex-slots: prodex ask exited with code ${code}; its own output above shows the reason. On a request_mismatch, take the answer back with \`prodex pro browser recover --port <port> --target-url <thread-url> --request-id <id>\` and do not resend blindly`);
        return code === 0 ? EXIT.OK : EXIT.ERROR;
      } finally {
        claim.release();
      }
    }
    if (notReady.size + blocked.size === wanted.length) {
      const detail = [
        [...notReady].map(([id, state]) => `slot ${id}: ${state}`),
        [...blocked].map(([id, message]) => `slot ${id}: blocked (${message})`),
      ].flat().join('; ');
      const fix = blocked.size
        ? ' Fix the blocked slots (the self-heal report above names each file and its hand-deletion command).'
        : ' Check that prodex is installed and runs.';
      // Probe errors and unclaimable slots are tool/browser failures, not something a login
      // fixes - never hand them to the user as a sign-in request.
      if (notReady.size === 0 || [...notReady.values()].includes('error')) {
        err(`prodex-slots: could not use any slot. ${detail}.${fix}`);
        return EXIT.ERROR;
      }
      err(`prodex-slots: no usable slot. ${detail}. Ask the user to sign in or complete any ChatGPT verification (run \`ensure\`), or to add slots (\`add --count N\`).`);
      return EXIT.NEEDS_USER;
    }
    if (!anyReadyButBusy || deps.now() >= deadline) {
      err('prodex-slots: all usable slots stayed busy within --wait-ms. Wait longer (--wait-ms), free a slot (release --slot N with a closure note), or ask the user for more slots (add --count N).');
      return EXIT.BUSY;
    }
    await deps.sleep(2000);
  }
}

export async function main(args, { deps = realDeps(), out = (s) => process.stdout.write(`${s}\n`), err = (s) => process.stderr.write(`${s}\n`) } = {}) {
  try {
    if (!args.length || args[0] === '--help') { out(usage); return EXIT.OK; }
    let parsed;
    try {
      parsed = parseArgs(args);
    } catch (error) {
      throw new UsageError(error.message);
    }
    const { command, options, passthrough } = parsed;
    const show = (rows) => out(options.json ? JSON.stringify(rows, null, 2) : renderSlots(rows));
    // list/run/ensure/release all read or take claim state, so they sweep first; `add` only
    // registers, and a sweep there would report slots that are about to be created.
    const sweepReport = ['list', 'run', 'ensure', 'release'].includes(command)
      ? sweepAndReport(loadConfig(deps.home), deps, err)
      : [];
    if (command === 'list') {
      show(await describeSlots(loadConfig(deps.home), deps, sweepReport));
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
      // Ownership and note were validated in parseArgs, so nothing below can reject after the
      // claim is already gone.
      const had = readClaim(deps.home, options.slot);
      releaseClaim(deps.home, options.slot);
      const record = writeClosure(deps.home, options.slot, { ownership: options.ownership, note: options.note });
      err(`prodex-slots: released slot ${options.slot}${had ? ' (claim removed)' : ' (no claim was present)'}; closed record written (${record.task ?? 'no task'}${record.note ? `, "${record.note}"` : ''}). The slot is reusable.`);
      return EXIT.OK;
    }
    if (command === 'run') return await runCommand(options, passthrough, deps, err);
    // The command is an argv token this tool did not recognise, so it is not repeated either.
    throw new UsageError('Unknown command. The first argument must be one of: list, add, ensure, run, release (or --help)');
  } catch (error) {
    if (error instanceof UsageError) {
      err(`${error.message}\n${usage}`);
    } else {
      err(`prodex-slots: ${error.message}`);
    }
    return EXIT.ERROR;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
