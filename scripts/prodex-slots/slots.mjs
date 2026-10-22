import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EXIT = { OK: 0, ERROR: 1, NEEDS_USER: 3, BUSY: 4 };
export const BASE_PORT = 9333;
export const MAX_SLOTS = 8;

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
// so the registry only stores how many slots exist.
export function addSlots(home, add) {
  if (!Number.isInteger(add) || add < 1) throw new Error('--count must be a positive integer');
  const { count } = loadConfig(home);
  if (count + add > MAX_SLOTS) throw new Error(`At most ${MAX_SLOTS} slots (have ${count}, asked for ${add} more)`);
  saveConfig(home, count + add);
  return loadConfig(home).slots.slice(count);
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

// A claim is a scheduling hint so `run --slot auto` spreads work over idle slots. Correctness of
// the browser itself still rests on Prodex's own per-slot send lock, which stays in force.
// A claim whose owner process is gone is reaped; a recycled pid keeps a claim alive until
// `release --slot N` removes it.
export function claimSlot(home, id, { pid = process.pid, label = '', alive = processAlive, now = Date.now } = {}) {
  const file = claimFile(home, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, `${JSON.stringify({ pid, label, startedAt: now() })}\n`, { flag: 'wx' });
      return { ok: true, release: () => releaseClaim(home, id, pid) };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const holder = readClaim(home, id);
    if (holder && alive(holder.pid)) return { ok: false, holder };
    fs.rmSync(file, { force: true });
  }
  return { ok: false, holder: readClaim(home, id) };
}

export function releaseClaim(home, id, pid = null) {
  const holder = readClaim(home, id);
  if (pid !== null && holder && holder.pid !== pid) return false;
  fs.rmSync(claimFile(home, id), { force: true });
  return true;
}
