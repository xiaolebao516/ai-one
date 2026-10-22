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

// Ownership is what makes a slot readable to other sessions: which task it serves, which
// session holds it and which thread it is talking to. It is deliberately narrow - three short
// fields - because it is written to a file other sessions and the user can read. Reply text,
// ask stdin/stdout and credentials never belong here.
export const OWNERSHIP_LIMITS = { sessionKey: 64, threadUrl: 300 };
const TASK_PATTERN = /^#?\d{1,6}$/;
const SESSION_KEY_PATTERN = new RegExp(`^[A-Za-z0-9._:-]{1,${OWNERSHIP_LIMITS.sessionKey}}$`);
const THREAD_HOST = 'chatgpt.com';
// A thread is either /c/<uuid> or, inside a project, /g/g-p-<project>/c/<uuid>. Anything else -
// a query string, a fragment, user:pass in the authority, an arbitrary segment where the id goes
// - is refused. The id shape is a format constraint on trusted CLI input, not proof that the id
// is real; what it does buy is that a pasted token cannot pass as a thread id.
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const THREAD_PROJECT_PATTERN = /^g-p-[a-z0-9]{1,40}$/;

// One validator per field, returning a value or the reason it was refused. `normalizeOwnership`
// throws on refusal (a typo must not be written); `claimOwnership` drops the value instead (a
// hand-edited file must not break `list`, and must not leak whatever it was edited to say).
//
// No refusal message repeats the offending value. A rejected field is by definition text this
// tool did not expect, so it may be a token that got pasted in the wrong place, and stderr ends
// up in logs; the message says what the rule is and leaves the value out.
const OWNERSHIP_FIELDS = {
  task(raw) {
    const value = String(raw).trim();
    if (!TASK_PATTERN.test(value)) return { error: '--task must be a task number like 71 or #71' };
    return { value: value.startsWith('#') ? value : `#${value}` };
  },
  sessionKey(raw) {
    const value = String(raw);
    if (!SESSION_KEY_PATTERN.test(value)) {
      return { error: `--session must be 1-${OWNERSHIP_LIMITS.sessionKey} characters of letters, digits, dot, underscore, colon or dash (it is shown to other sessions)` };
    }
    return { value };
  },
  threadUrl(raw) {
    const value = String(raw);
    if (value.length > OWNERSHIP_LIMITS.threadUrl) {
      return { error: `--thread-url must be at most ${OWNERSHIP_LIMITS.threadUrl} characters` };
    }
    // Rejecting control characters is the point of this check, so the control-character range is intended.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(value)) return { error: '--thread-url must not contain control characters' };
    // Checked on the raw text, because an empty "?" or "#" disappears from url.search/url.hash
    // while staying in the string that would be stored.
    if (value.includes('?') || value.includes('#')) return { error: '--thread-url must not carry a query or fragment' };
    let url;
    try {
      url = new URL(value);
    } catch {
      return { error: `--thread-url must be a full URL such as https://${THREAD_HOST}/c/<thread-id>` };
    }
    if (url.protocol !== 'https:') return { error: '--thread-url must use https' };
    if (url.hostname !== THREAD_HOST) return { error: `--thread-url must be on ${THREAD_HOST}` };
    if (url.username || url.password) return { error: '--thread-url must not carry credentials (user:pass@)' };
    if (url.port) return { error: '--thread-url must not use a port' };
    // Split without dropping empty segments, so "//c/<id>" and a trailing separator are refused
    // here instead of being tidied up.
    const parts = url.pathname.split('/');
    const isThread = parts.length === 3 && parts[0] === '' && parts[1] === 'c' && THREAD_ID_PATTERN.test(parts[2]);
    const isProjectThread = parts.length === 5 && parts[0] === '' && parts[1] === 'g'
      && THREAD_PROJECT_PATTERN.test(parts[2]) && parts[3] === 'c' && THREAD_ID_PATTERN.test(parts[4]);
    if (!isThread && !isProjectThread) {
      return { error: `--thread-url must point at a thread: https://${THREAD_HOST}/c/<thread-id> or https://${THREAD_HOST}/g/g-p-<project>/c/<thread-id>, where <thread-id> is the id from the address bar` };
    }
    // The URL parser silently normalizes "/SECRET/../c/x", "%2e%2e", ":443" and similar. Storing
    // the text it would normalize would put whatever sat in front of the path into the claim, so
    // only the exact, already-canonical form is accepted.
    if (url.href !== value) {
      return { error: `--thread-url must be written exactly as the thread URL, without "..", percent-escaped segments, a default port or a trailing separator` };
    }
    return { value: url.href };
  },
};

export const OWNERSHIP_KEYS = Object.keys(OWNERSHIP_FIELDS);

// Validates and normalizes the three ownership fields. Anything else is rejected here rather
// than written to disk, so a typo cannot leave a claim that the next session has to interpret.
export function normalizeOwnership(fields = {}) {
  const ownership = {};
  for (const key of OWNERSHIP_KEYS) {
    if (fields[key] === undefined || fields[key] === null) continue;
    const checked = OWNERSHIP_FIELDS[key](fields[key]);
    if (checked.error) throw new Error(checked.error);
    ownership[key] = checked.value;
  }
  return ownership;
}

// Reads ownership back out of a claim file. Values are re-validated, not just the key names, so
// an edited claim can neither smuggle a credential into `list` nor fake a field it does not
// have; anything that does not validate is simply not shown.
export function claimOwnership(claim) {
  const ownership = {};
  for (const key of OWNERSHIP_KEYS) {
    const raw = claim?.[key];
    if (typeof raw !== 'string' || !raw) continue;
    const checked = OWNERSHIP_FIELDS[key](raw);
    if (checked.value) ownership[key] = checked.value;
  }
  return ownership;
}

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

// Short critical sections only (a few file operations). The file is created exclusively. A file
// older than staleMs means its holder stopped inside the section; it is reported, never deleted
// automatically: without OS file locks two processes cannot both judge it stale and remove it
// safely, and a wrongly removed live mutex would let two processes in at once.
// fn must be synchronous.
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
    let age;
    try {
      age = Date.now() - fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (age > staleMs) {
      throw new Error(`${file} was left behind by a process that stopped inside a short critical section. Delete it by hand if no other prodex-slots command is running.`);
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
  let raw;
  try {
    raw = fs.readFileSync(configPath(home), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { count, slots: Array.from({ length: count }, (_, index) => slotDefinition(index + 1, home)) };
    throw new Error(`Cannot read ${configPath(home)}: ${error.message}`, { cause: error });
  }
  // A JSON parse error can quote the file it failed on, and a hand-edited slots.json is exactly
  // where someone might have pasted something; report the file, not its contents.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${configPath(home)} is not valid JSON; fix or delete that file by hand`);
  }
  if (parsed && Number.isInteger(parsed.count) && parsed.count >= 1 && parsed.count <= MAX_SLOTS) count = parsed.count;
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
// Detail is Prodex's own status text, printed to the user and to logs. URLs are the one part of
// it that could carry a token, so any URL with a query or credentials is redacted; a plain URL
// stays. The tail is capped so a chatty probe cannot flood a line.
export function redactDetail(text) {
  const redacted = String(text).replace(/https?:\/\/\S+/g, (url) => (/[?@#]/.test(url) ? 'url=<redacted>' : url));
  return redacted.length > 200 ? `${redacted.slice(0, 200)}...` : redacted;
}

export function parseCheck(text) {
  const match = /^chatgpt:\s*(\S+)(.*)$/m.exec(String(text));
  // No status line at all means the probe itself failed, which is not something a login fixes.
  if (!match) return { state: 'error', detail: 'check printed no chatgpt status line' };
  const [, status, rest] = match;
  const detail = redactDetail(`${status}${rest}`.trim());
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
// per-slot send lock remains the guard for the browser itself. The claim holds a random owner
// id, the pid, a start time and, when the caller provided them, the three ownership fields
// (task / session key / thread URL) so another session can see who a slot is serving. It never
// holds reply text, ask stdin/stdout or credentials.
//
// The file appears complete and atomically (hard link of a fully written temp file). Judging a
// claim dead and removing it happens under a mutex and re-reads the file first, so a claim just
// taken by someone else is never deleted. Dead = owner pid gone, or no heartbeat for staleMs
// (covers a pid recycled by another process). A file that cannot be parsed counts as live until
// it is stale.
export function claimSlot(home, id, { pid = process.pid, alive = processAlive, now = Date.now, staleMs = CLAIM_STALE_MS, beatMs = CLAIM_BEAT_MS, meta = {} } = {}) {
  // Validate before touching the directory: a rejected claim must not leave a temp file behind.
  const ownership = normalizeOwnership(meta);
  const file = claimFile(home, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const owner = crypto.randomUUID();
  const temp = `${file}.${owner}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ owner, pid, startedAt: now(), ...ownership })}\n`);
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
        return {
          ok: true,
          owner,
          release: () => {
            clearInterval(beat);
            try {
              return releaseClaim(home, id, owner);
            } catch {
              return false; // a leftover claim dies with its owner or its heartbeat
            }
          },
        };
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
// unconditionally (manual `release`). The owner check and the delete happen under the same
// mutex that guards removal of dead claims, so the file cannot be swapped between the two.
export function releaseClaim(home, id, owner = null, mutexOptions = {}) {
  const file = claimFile(home, id);
  return withMutex(`${file}.reap`, () => {
    if (owner !== null && readClaim(home, id)?.owner !== owner) return false;
    fs.rmSync(file, { force: true });
    return true;
  }, mutexOptions);
}
