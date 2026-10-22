#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXIT, addSlots, claimSlot, loadConfig, parseCheck, processAlive, readClaim, releaseClaim, slotEnv, slotsHome } from './slots.mjs';

export const usage = [
  'Usage: node scripts/prodex-slots/cli.mjs <command> [options]',
  '  list [--json]                         slots, browser state, claims',
  '  add --count N [--json]                register N more slots and open their login windows',
  '  ensure [--json]                       reopen slot browsers that are not running',
  '  run [--slot N|auto] [--wait-ms MS] -- <args of `prodex pro browser ask`>',
  '  release --slot N                      drop a stale claim',
  'Exit: 0 ok, 1 error, 3 needs the user (login), 4 all ready slots busy past --wait-ms.',
].join('\n');

const VALUE_OPTIONS = { '--slot': 'slot', '--count': 'count', '--wait-ms': 'waitMs' };

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
    if (!(arg in VALUE_OPTIONS)) throw new Error(`Unknown option: ${arg}`);
    const value = rest[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value: ${arg}`);
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
    throw new Error(`${command ?? ''} takes no arguments after --`);
  }
  if (command === 'add' && !options.count) throw new Error('add needs --count N');
  if (command === 'release' && options.slot === 'auto') throw new Error('release needs --slot N');
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

export function realDeps(home = slotsHome()) {
  let entry;
  const prodex = (args, env) => ({ entry: (entry ??= resolveProdexEntry()), args, env });
  return {
    home,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    profileExists: (slot) => !slot.profileDir || fs.existsSync(slot.profileDir),
    checkSlot(slot) {
      const { entry: file, args } = prodex(['pro', 'browser', 'check', '--port', String(slot.port)]);
      const result = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
      return parseCheck(`${result.stdout ?? ''}`);
    },
    launchHeaded(slot) {
      const { entry: file, args } = prodex([
        'pro', 'browser', 'login', '--port', String(slot.port),
        ...(slot.profileDir ? ['--profile-dir', slot.profileDir] : []),
        '--cwd', process.cwd(), '--headed', '--no-wait',
      ]);
      spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
    },
    runAsk(slot, askArgs) {
      const { entry: file, args, env } = prodex(['pro', 'browser', 'ask', ...askArgs], slotEnv(slot));
      return new Promise((resolve) => {
        const child = spawn(process.execPath, [file, ...args], { env, stdio: 'inherit' });
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
    return { id: slot.id, port: slot.port, state: (await deps.checkSlot(slot)).state, busyWith: busy ? { pid: claim.pid, label: claim.label } : null };
  }));
}

async function ensureSlots(slots, deps, { pollMs = 2000, timeoutMs = 20_000 } = {}) {
  const results = [];
  for (const slot of slots) {
    let { state } = await deps.checkSlot(slot);
    if (state === 'down') {
      await deps.launchHeaded(slot);
      const deadline = deps.now() + timeoutMs;
      while (deps.now() < deadline) {
        await deps.sleep(pollMs);
        ({ state } = await deps.checkSlot(slot));
        if (state !== 'down') break;
      }
    }
    results.push({ id: slot.id, port: slot.port, state });
  }
  return results;
}

function renderSlots(rows) {
  return rows.map((r) => `slot ${r.id}  port ${r.port}  ${r.state}${r.busyWith ? `  busy (pid ${r.busyWith.pid}${r.busyWith.label ? `, ${r.busyWith.label}` : ''})` : ''}`).join('\n');
}

function needsUser(rows) {
  return rows.filter((r) => r.state !== 'ready' && r.state !== 'busy');
}

async function runCommand(options, passthrough, deps, err) {
  const config = loadConfig(deps.home);
  const wanted = options.slot === 'auto' ? config.slots : config.slots.filter((s) => s.id === options.slot);
  if (!wanted.length) throw new Error(`No such slot: ${options.slot}`);
  const label = passthrough.find((a, i) => passthrough[i - 1] === '--session-key') ?? '';
  const deadline = deps.now() + options.waitMs;
  const notReady = new Map();
  for (;;) {
    let anyReadyButBusy = false;
    for (const slot of wanted) {
      if (notReady.has(slot.id)) continue;
      const claim = claimSlot(deps.home, slot.id, { label, alive: deps.alive, now: deps.now });
      if (!claim.ok) { anyReadyButBusy = true; continue; }
      try {
        const { state } = await deps.checkSlot(slot);
        if (state === 'busy') { anyReadyButBusy = true; continue; }
        if (state !== 'ready') { notReady.set(slot.id, state); continue; }
        err(`prodex-slots: using slot ${slot.id} (port ${slot.port})`);
        return await deps.runAsk(slot, passthrough);
      } finally {
        claim.release();
      }
    }
    if (notReady.size === wanted.length) {
      err(`prodex-slots: no usable slot. ${[...notReady].map(([id, state]) => `slot ${id}: ${state}`).join('; ')}. Ask the user to log in (run \`ensure\`) or to add slots (\`add --count N\`).`);
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
      const pending = needsUser(rows);
      if (pending.length) err(`prodex-slots: the user must act on slot ${pending.map((r) => `${r.id} (${r.state})`).join(', ')}: log in to ChatGPT in its window, or bring a hidden/minimized window to the front; then run \`list\`.`);
      return pending.length ? EXIT.NEEDS_USER : EXIT.OK;
    }
    if (command === 'release') {
      releaseClaim(deps.home, options.slot);
      return EXIT.OK;
    }
    if (command === 'run') return await runCommand(options, passthrough, deps, err);
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    err(`${error.message}\n${usage}`);
    return EXIT.ERROR;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
