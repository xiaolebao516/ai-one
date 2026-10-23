#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest, statusFor, validateFinish, withLock } from '../prodex-archive/archive.mjs';
import { claimFilePresent, EXIT, addSlots, claimOwnership, claimSlot, loadConfig, normalizeNote, normalizeOwnership, parseCheck, processAlive, readClaim, readClosure, releaseClaim, slotEnv, slotsHome, sweepSlots, writeClosure } from './slots.mjs';
import { diagnoseBrowserUnreachable } from './browser-diagnostics.mjs';

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
  '  release ... --request-id ID --handoff-url GITHUB_COMMENT_URL',
  '                                        also archive the finished chat (needs --task and --thread-url; see scripts/prodex-archive/README.md)',
  'Ownership (run and release): --task 71, --session s1, --thread-url https://chatgpt.com/c/<id>.',
  'They are shown by `list` so another session can see who a slot serves; never reply text.',
  'Use the ask\'s own --session-key after `--`: that one is prodex\'s, this one is ownership.',
  'Exit: 0 ok, 1 error (also any failure of the prodex ask itself), 3 needs the user, 4 all ready slots busy past --wait-ms.',
  '`run` passes the ask output (the reply) through to stdout: redirect it to a file, do not log it.',
].join('\n');

const VALUE_OPTIONS = { '--slot': 'slot', '--count': 'count', '--wait-ms': 'waitMs', '--task': 'task', '--session': 'sessionKey', '--thread-url': 'threadUrl', '--note': 'note', '--request-id': 'requestId', '--handoff-url': 'handoffUrl' };
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
      throw new Error('Unknown option. Expected one of: --json, --slot, --count, --wait-ms, --task, --session, --thread-url, --note, --request-id, --handoff-url, each with its value as the next argument; the "=" form is not accepted');
    }
    const value = rest[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
    if (!NUMERIC_OPTIONS.has(arg)) { options[VALUE_OPTIONS[arg]] = value; continue; }
    if (arg === '--slot' && value === 'auto') continue;
    if (!/^\d+$/.test(value)) throw new Error(`Invalid integer: ${arg}`);
    options[VALUE_OPTIONS[arg]] = Number(value);
  }
  if (command === 'run') {
    // The thread a claim names must be the thread the ask really targets, otherwise every
    // protection keyed on the claim would watch the wrong chat.
    if (passthrough.some((arg) => arg === '--continue' || arg === '--continue-task' || arg.startsWith('--continue=') || arg.startsWith('--continue-task='))) {
      // These make prodex pick an old thread from its own records, so the claim could not name (or
      // lock) the thread that is really used. Use --target-url with --thread-url instead.
      throw new Error('run does not accept --continue / --continue-task; continue a thread with the same URL in --thread-url and --target-url');
    }
    const targets = passthrough.reduce((all, arg, i) => (arg === '--target-url' ? [...all, passthrough[i + 1]] : all), []);
    if (targets.length > 1) throw new Error('run takes at most one --target-url');
    if ((targets.length === 1) !== (options.threadUrl !== undefined)) {
      throw new Error('Continuing a thread needs the same URL in --thread-url (ownership) and in --target-url after `--`; give both or neither');
    }
    if (targets.length === 1 && normalizeOwnership({ threadUrl: targets[0] }).threadUrl !== normalizeOwnership({ threadUrl: options.threadUrl }).threadUrl) {
      throw new Error('--thread-url and --target-url must name the same thread');
    }
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
  const archiveFlags = ['requestId', 'handoffUrl'].filter((key) => options[key] !== undefined);
  if (archiveFlags.length) {
    // Archive evidence only makes sense on release, and only as a complete set; rejected before
    // any state changes. The values are never echoed (they may be pasted tokens).
    if (command !== 'release') throw new UsageError('--request-id / --handoff-url only apply to release');
    if (archiveFlags.length !== 2) throw new UsageError('Archiving on release needs both --request-id and --handoff-url');
    if (options.task === undefined || options.threadUrl === undefined) {
      throw new UsageError('Archiving on release also needs --task and --thread-url');
    }
    // Format and Handoff-URL checks happen here, before release touches any state. The archive
    // tool's messages are generic and never repeat the rejected value.
    try {
      validateFinish({ task: String(options.task).replace('#', ''), slot: options.slot, threadUrl: options.threadUrl,
        requestId: options.requestId, handoffUrl: options.handoffUrl });
    } catch (error) {
      throw new UsageError(`Invalid archive evidence: ${error.message}`);
    }
  }
  // Validate the note here, before release touches any state: a rejected note must not take the
  // claim down with it.
  if (command === 'release') options.note = options.note === undefined ? undefined : normalizeNote(options.note);
  return { command, options, passthrough };
}

// `npmRoot` is injectable so tests can force the not-found path without stubbing node:child_process.
export function resolveProdexEntry(env = process.env, { npmRoot = null } = {}) {
  const candidates = [];
  if (env.PRODEX_ENTRY) candidates.push(env.PRODEX_ENTRY);
  let npmRootValue = npmRoot ?? '';
  if (npmRoot === null) {
    const npm = spawnSync('npm root -g', { encoding: 'utf8', shell: true, windowsHide: true });
    if (npm.status === 0) npmRootValue = String(npm.stdout).trim();
  }
  if (npmRootValue) candidates.push(path.join(npmRootValue, '@youdie006', 'prodex', 'prodex.mjs'));
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) {
    const how = npmRootValue
      ? `PowerShell: $env:PRODEX_ENTRY = "${npmRootValue}\\@youdie006\\prodex\\prodex.mjs"`
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

export function realDeps(home = slotsHome(), { platform = process.platform, env = process.env, spawnSyncFn = spawnSync, fetchFn = globalThis.fetch } = {}) {
  let entry;
  const prodex = (args) => ({ entry: (entry ??= resolveProdexEntry(env)), args });
  return {
    home,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    profileExists: (slot) => !slot.profileDir || fs.existsSync(slot.profileDir),
    checkSlot(slot) {
      const { entry: file, args } = prodex(['pro', 'browser', 'check', '--port', String(slot.port)]);
      const result = spawnSyncFn(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
      // `check` exits 1 for harmless reasons (for example a missing optional config), so only
      // a failure to run it at all is an error; the browser state comes from its output.
      if (result.error || result.signal) return { state: 'error', detail: `check did not run: ${result.error?.code ?? result.signal}` };
      const parsed = parseCheck(`${result.stdout ?? ''}`);
      if (parsed.state !== 'down') return parsed;
      return diagnoseBrowserUnreachable(slot, { platform, spawnSyncFn, fetchFn });
    },
    launchHeaded(slot) {
      const { entry: file, args } = prodex([
        'pro', 'browser', 'login', '--port', String(slot.port),
        ...(slot.profileDir ? ['--profile-dir', slot.profileDir] : []),
        '--cwd', process.cwd(), '--headed', '--no-wait',
      ]);
      const result = spawnSyncFn(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
      if (result.error || result.signal || result.status !== 0) {
        return { ok: false, detail: `login exited ${result.error?.code ?? result.signal ?? result.status}` };
      }
      return { ok: true };
    },
    restoreWindow(slot) {
      if (platform !== 'win32') return false;
      const result = spawnSyncFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', restoreScript(slot.port)], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
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
    const check = await deps.checkSlot(slot);
    return {
      id: slot.id,
      port: slot.port,
      state: check.state,
      ...(['unknown', 'down'].includes(check.state) && check.detail ? { detail: check.detail } : {}),
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
          if (state !== 'down' && state !== 'unknown') break;
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

async function runCommand(options, passthrough, deps, err, sweepReport = []) {
  const config = loadConfig(deps.home);
  const wanted = options.slot === 'auto' ? config.slots : config.slots.filter((s) => s.id === options.slot);
  if (!wanted.length) {
    throw new Error(`No such slot: ${options.slot}. Registered slots: ${config.slots.map((s) => s.id).join(', ')} (ports ${config.slots.map((s) => s.port).join(', ')})`);
  }
  const deadline = deps.now() + options.waitMs;
  const notReady = new Map();
  const blocked = new Map();
  // Slots the sweep already found unclaimable (stale mutex, blocked deletion) are not retried
  // here: claiming them would either fail again or - worse - succeed and then fail to release.
  const wantedIds = new Set(wanted.map((slot) => slot.id));
  for (const item of sweepReport) {
    if (item.blocked && wantedIds.has(item.slot)) blocked.set(item.slot, item.blocked);
  }
  for (;;) {
    let anyReadyButBusy = false;
    for (const slot of wanted) {
      if (notReady.has(slot.id) || blocked.has(slot.id)) continue;
      let claim;
      try {
        claim = claimSlot(deps.home, slot.id, { alive: deps.alive, now: deps.now, meta: options.ownership });
      } catch (error) {
        // A stale .reap mutex (or a policy-blocked deletion) makes this slot unclaimable; say so
        // immediately and let the other slots work - never skip in silence.
        blocked.set(slot.id, error.message);
        err(`prodex-slots: slot ${slot.id} could not be claimed: ${error.message}`);
        continue;
      }
      if (!claim.ok) {
        if (claim.warning) err(`prodex-slots: slot ${slot.id}: ${claim.warning}`);
        anyReadyButBusy = true;
        continue;
      }
      if (claim.warning) err(`prodex-slots: slot ${slot.id}: ${claim.warning} (the claim itself is fine; the sweep collects the leftover)`);
      // Run and archive serialize on the same per-thread lock: the archive holds it from "pending"
      // to its result, and this check takes it after the claim is visible. Either the archive sees
      // this claim, or this run sees "pending"/"archived" (or the busy lock) and backs off.
      if (options.ownership.threadUrl) {
        let blockedReason = null;
        try {
          await withLock(path.join(deps.home, 'archive', `thread-${digest(options.ownership.threadUrl)}.lock`), async () => {
            const status = statusFor(deps.home, options.ownership.threadUrl)?.status;
            if (status === 'pending' || status === 'archived') blockedReason = status;
          });
        } catch {
          blockedReason = 'pending';
        }
        if (blockedReason) {
          if (claim.release() !== true) err(`prodex-slots: slot ${slot.id}: the claim could not be released; treat the slot as occupied until \`list\` shows it free.`);
          err(`prodex-slots: slot ${slot.id}: this thread is ${blockedReason === 'archived' ? 'already archived' : 'being archived right now'}; not starting a new ask on it`);
          return EXIT.ERROR;
        }
      }
      try {
        const { state, detail } = await checkWithRestore(slot, deps);
        if (state === 'busy') { anyReadyButBusy = true; continue; }
        if (state !== 'ready') {
          notReady.set(slot.id, state);
          if (state === 'unknown' && detail) err(`prodex-slots: slot ${slot.id}: ${detail}`);
          continue;
        }
        const label = ownershipLabel(options.ownership);
        err(`prodex-slots: using slot ${slot.id} (port ${slot.port})${label ? ` for ${label}` : ''}`);
        // The ask's own exit code is not part of this tool's 0/1/3/4 contract: any failure is 1.
        const code = await deps.runAsk(slot, passthrough);
        if (code !== 0) err(`prodex-slots: prodex ask exited with code ${code}; its own output above shows the reason. On a request_mismatch, take the answer back with \`prodex pro browser recover --port <port> --target-url <thread-url> --request-id <id>\` and do not resend blindly`);
        return code === 0 ? EXIT.OK : EXIT.ERROR;
      } finally {
        // This also runs when the browser was busy or the ask failed, so do not assume success.
        // A blocked .reap mutex prevents sweeping even after the heartbeat expires.
        if (claim.release() !== true) {
          err(`prodex-slots: slot ${slot.id}: the claim could not be released; this is separate from the ask result; treat the slot as occupied until \`list\` shows it free. Run \`list\` for the self-heal report; a blocked .reap mutex requires its printed manual fix after other prodex-slots commands have stopped.`);
        }
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
      if ([...notReady.values()].includes('unknown')) {
        err(`prodex-slots: no usable slot. ${detail}. Browser state is uncertain; no automatic restart was attempted. Inspect the browser window and run \`list\` again. Sign in only if the page asks.`);
        return EXIT.NEEDS_USER;
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

// Closing a thread is the one moment the chat is known to be finished, so this is where the
// archive is started. It never changes the release result: the slot is already free, and an
// archive that is skipped or fails is reported loudly instead of failing the release.
async function archiveOnRelease(options, deps, err) {
  if (options.requestId === undefined) {
    if (options.ownership.threadUrl) {
      err('prodex-slots: archive NOT attempted: the chat stays open in ChatGPT. After the Archive-ready Handoff is posted, close it with `release ... --request-id ID --handoff-url URL` (or run scripts/prodex-archive/cli.mjs skip to keep it).');
    }
    return;
  }
  const autoFinish = deps.autoFinish ?? (async (argv, io) => (await import('../prodex-archive/cli.mjs')).main(argv, { home: deps.home, ...io }));
  const lines = [];
  let code;
  try {
    code = await autoFinish(['auto-finish', '--slot', String(options.slot), '--task', String(options.ownership.task).replace('#', ''),
      '--thread-url', options.ownership.threadUrl, '--request-id', options.requestId, '--handoff-url', options.handoffUrl],
    { out: (line) => lines.push(line), err: (line) => lines.push(line) });
  } catch (error) {
    code = 1;
    lines.push(`archive tool failed: ${error?.message ?? 'unknown error'}`);
  }
  const detail = lines.join(' ').replace(/https?:\/\/\S+/g, '[url]');
  if (code === 0) err(`prodex-slots: archive: ${detail}`);
  else err(`prodex-slots: archive NOT done (the slot is released anyway): ${detail}. Inspect it, then retry with scripts/prodex-archive/cli.mjs retry.`);
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
    if (command === 'release' && options.requestId !== undefined) {
      // Checked before the self-heal sweep: a claim whose heartbeat is stale (for example after the
      // machine slept) but whose process is alive is still an active run, and the sweep would
      // otherwise delete it and hide that.
      const live = readClaim(deps.home, options.slot);
      if (live && (deps.alive ?? processAlive)(live.pid)) {
        throw new Error('The run holding this slot claim is still active; wait for it to finish before archiving. Nothing was released or archived');
      }
    }
    // An archiving release must not run the sweep: it deletes claims with a stale heartbeat even when their
    // process is alive, which would hide another slot's active run from the archive's conflict check.
    // The archive ignores claims whose process is dead by itself.
    const archivingRelease = command === 'release' && options.requestId !== undefined;
    const sweepReport = ['list', 'run', 'ensure', 'release'].includes(command) && !archivingRelease
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
      const uncertain = pending.filter((r) => r.state === 'unknown');
      const needsUser = pending.filter((r) => r.state !== 'unknown');
      if (uncertain.length) err(`prodex-slots: browser state is uncertain for slot ${uncertain.map((r) => `${r.id} (port ${r.port})`).join(', ')}; no automatic restart was attempted. Inspect the browser window and run \`node scripts/prodex-slots/cli.mjs list\` again. Sign in only if the page asks.`);
      if (needsUser.length) err(`prodex-slots: the user must act on slot ${needsUser.map((r) => `${r.id} (${r.state})`).join(', ')}: sign in to ChatGPT or complete any verification in its window; then run \`list\`.`);
      return pending.length ? EXIT.NEEDS_USER : EXIT.OK;
    }
    if (command === 'release') {
      // Ownership and note were validated in parseArgs, so nothing below can reject after the
      // claim is already gone.
      const had = readClaim(deps.home, options.slot);
      // A claim file that exists but cannot be read is a live, unknown occupant: never record the
      // slot as free over it.
      if (!had && claimFilePresent(deps.home, options.slot)) {
        throw new Error('The slot has a claim file that cannot be read; nothing was released or archived. Inspect it with `list` and fix or remove it');
      }
      const archiving = options.requestId !== undefined;
      if (archiving) {
        // Fail closed before anything changes: the slot must be registered, and a live claim must
        // name exactly this task and thread (unknown or partial ownership is not a match).
        if (!loadConfig(deps.home).slots.some((slot) => slot.id === options.slot)) {
          throw new Error(`Slot ${options.slot} is not registered; nothing was released or archived`);
        }
        if (had) {
          // A run that still holds the claim has not finished its ask; archiving under it could
          // archive the chat before that ask is sent.
          if ((deps.alive ?? processAlive)(had.pid)) {
            throw new Error('The run holding this slot claim is still active; wait for it to finish before archiving. Nothing was released or archived');
          }
          const owner = claimOwnership(had);
          if (owner.task !== options.ownership.task || owner.threadUrl !== options.ownership.threadUrl) {
            throw new Error('The slot claim does not name exactly this task and thread; nothing was released or archived');
          }
        }
      }
      // Release only the claim that was checked above; a claim that appeared in between stays.
      // With no claim read there is nothing to delete: an unconditional release could remove a claim
      // another agent took a moment ago. A claim without an owner id cannot be released safely.
      if (had) {
        if (typeof had.owner !== 'string' || !had.owner || releaseClaim(deps.home, options.slot, had.owner) !== true) {
          throw new Error('The slot claim changed or has no owner id; nothing was archived. Run `list` and retry');
        }
      }
      const record = writeClosure(deps.home, options.slot, { ownership: options.ownership, note: options.note });
      err(`prodex-slots: released slot ${options.slot}${had ? ' (claim removed)' : ' (no claim was present)'}; closed record written (${record.task ?? 'no task'}${record.note ? `, "${record.note}"` : ''}). The slot is reusable.`);
      await archiveOnRelease(options, deps, err);
      return EXIT.OK;
    }
    if (command === 'run') return await runCommand(options, passthrough, deps, err, sweepReport);
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
