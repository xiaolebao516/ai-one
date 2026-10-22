import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EXIT = { OK: 0, ERROR: 1, NEEDS_USER: 3, BUSY: 4 };
export const BASE_PORT = 9333;
export const MAX_SLOTS = 8;
// A claim is refreshed every CLAIM_BEAT_MS while its owner runs; one not refreshed for
// CLAIM_STALE_MS is dead even if its pid was recycled by an unrelated process.
export const CLAIM_BEAT_MS = 20_000;
export const CLAIM_STALE_MS = 120_000;

export function slotsHome(env = process.env) {
  return env.PRODEX_SLOTS_HOME || path.join(os.homedir(), '.local', 'share', 'prodex');
}

// Slot 1 is the stock Prodex browser: default port, default profile, default send lock.
// Leaving profileDir/lockFile null means "do not override", so callers that bypass this
// tool still serialize against slot 1.
export function defaultSlot() {
  return { id: 1, port: BASE_PORT, profileDir: null, lockFile: null };
}

export function slotDefinition(id, home) {
  if (id === 1) return defaultSlot();
  return {
    id,
    port: BASE_PORT + id - 1,
    profileDir: path.join(home, `chrome-chatgpt-pro-slot${id}`),
    lockFile: path.join(home, `browser-send-slot${id}.lock`),
  };
}

export function configPath(home) {
  return path.join(home, 'slots.json');
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Short critical sections only. The file is created exclusively; one older than staleMs belongs
// to a holder that died and is replaced. fn must be synchronous.
export function withMutex(file, fn, { timeoutMs = 5000, staleMs = 10_000 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > staleMs) fs.rmSync(file, { force: true });
    } catch {
      continue;
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`);
    sleepSync(25);
  }
  try {
    return fn();
  } finally {
    fs.rmSync(file, { force: true });
  }
}

export function loadConfig(home) {
  let count = 1;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(home), 'utf8'));
    if (Number.isInteger(raw.count) && raw.count >= 1 && raw.count <= MAX_SLOTS) count = raw.count;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read ${configPath(home)}: ${error.message}`, { cause: error });
  }
  return { count, slots: Array.from({ length: count }, (_, index) => slotDefinition(index + 1, home)) };
}

export function saveConfig(home, count) {
  fs.mkdirSync(home, { recursive: true });
  const target = configPath(home);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ version: 1, count }, null, 2)}\n`);
  fs.renameSync(temp, target);
}

// Registers `add` more slots after the existing ones; ports/profiles/locks derive from the id,
// so the registry only stores how many slots exist. The read-modify-write is mutually exclusive
// across processes, so concurrent adds receive different slot ids.
export function addSlots(home, add) {
  if (!Number.isInteger(add) || add < 1) throw new Error('--count must be a positive integer');
  return withMutex(`${configPath(home)}.lock`, () => {
    const { count } = loadConfig(home);
    if (count + add > MAX_SLOTS) throw new Error(`At most ${MAX_SLOTS} slots (have ${count}, asked for ${add} more)`);
    saveConfig(home, count + add);
    return loadConfig(home).slots.slice(count);
  });
}

export function slotEnv(slot, base = process.env) {
  const env = { ...base, PRODEX_CDP_PORT: String(slot.port) };
  if (slot.lockFile) env.PRODEX_SEND_LOCK_FILE = slot.lockFile;
  else delete env.PRODEX_SEND_LOCK_FILE;
  return env;
}

// `prodex pro browser check` prints `chatgpt: <status> ...`; only that line is interpreted.
export function parseCheck(text) {
  const match = /^chatgpt:\s*(\S+)(.*)$/m.exec(String(text));
  if (!match) return { state: 'unknown' };
  const [, status, rest] = match;
  const detail = `${status}${rest}`.trim();
  if (status === 'browser_unreachable') return { state: 'down' };
  if (status === 'ok' && /logged_in=true/.test(rest) && /composer=true/.test(rest)) return { state: 'ready' };
  // Logged in and answering a previous request: usable once that finishes.
  if (status === 'busy') return { state: 'busy', detail };
  // Window minimized or behind another tab: Prodex cannot send until it is visible again.
  if (/tab_not_visible/.test(rest)) return { state: 'hidden', detail };
  if (/logged_in=false/.test(rest) || /login/.test(status)) return { state: 'needs-login', detail };
  return { state: 'unknown', detail };
}

export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function claimFile(home, id) {
  return path.join(home, 'slot-claims', `slot-${id}.json`);
}

export function readClaim(home, id) {
  try {
    return JSON.parse(fs.readFileSync(claimFile(home, id), 'utf8'));
  } catch {
    return null;
  }
}

function claimAgeMs(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

// A claim is a scheduling hint so `run --slot auto` spreads work over idle slots; Prodex's own
// per-slot send lock remains the guard for the browser itself. The claim holds only a random
// owner id, the pid and a start time, never a session key or any conversation text.
//
// The file appears complete and atomically (hard link of a fully written temp file). Judging a
// claim dead and removing it happens under a mutex and re-reads the file first, so a claim just
// taken by someone else is never deleted. Dead = owner pid gone, or no heartbeat for staleMs
// (covers a pid recycled by another process). A file that cannot be parsed counts as live until
// it is stale.
export function claimSlot(home, id, { pid = process.pid, alive = processAlive, now = Date.now, staleMs = CLAIM_STALE_MS, beatMs = CLAIM_BEAT_MS } = {}) {
  const file = claimFile(home, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const owner = crypto.randomUUID();
  const temp = `${file}.${owner}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ owner, pid, startedAt: now() })}\n`);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.linkSync(temp, file);
        const beat = setInterval(() => {
          try {
            const at = new Date();
            fs.utimesSync(file, at, at);
          } catch { /* claim already gone */ }
        }, beatMs);
        beat.unref();
        return { ok: true, owner, release: () => { clearInterval(beat); return releaseClaim(home, id, owner); } };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const verdict = withMutex(`${file}.reap`, () => {
        const age = claimAgeMs(file);
        if (age === null) return { retry: true };
        const holder = readClaim(home, id);
        const dead = holder ? !alive(holder.pid) || age >= staleMs : age >= staleMs;
        if (!dead) return { holder };
        fs.rmSync(file, { force: true });
        return { retry: true };
      });
      if (!verdict.retry) return { ok: false, holder: verdict.holder };
    }
    return { ok: false, holder: readClaim(home, id) };
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// With `owner` set only that owner's claim is removed; without it the claim is dropped
// unconditionally (manual `release`).
export function releaseClaim(home, id, owner = null) {
  if (owner !== null && readClaim(home, id)?.owner !== owner) return false;
  fs.rmSync(claimFile(home, id), { force: true });
  return true;
}
