import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { claimSlot, claimOwnership, loadConfig, normalizeOwnership, readClaim, slotsHome, slotDefinition, writeClosure } from '../prodex-slots/slots.mjs';
import { archiveConversation } from './browser-ui.mjs';

export const digest = (url) => crypto.createHash('sha256').update(url).digest('hex');
export const canonicalThread = (url) => normalizeOwnership({ threadUrl: url }).threadUrl;
const storageDir = (home) => path.join(home, 'archive');
const storageFile = (home) => path.join(storageDir(home), 'statuses.json');

const policyFile = (home) => path.join(storageDir(home), 'policy.json');

export function getArchivePolicy(home) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(policyFile(home), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, mode: 'auto' };
    throw new Error('Archive policy unreadable; manual recovery required', { cause: error });
  }
  if (config?.version !== 1 || !['auto', 'manual'].includes(config.mode))
    throw new Error('Archive policy is invalid; expected version 1 and mode auto or manual');
  return { version: 1, mode: config.mode };
}

export async function setArchivePolicy(home, mode) {
  if (!['auto', 'manual'].includes(mode))
    throw new Error('Archive mode must be auto or manual');
  return withLock(path.join(storageDir(home), 'policy.lock'), async () => {
    getArchivePolicy(home); // Refuse to overwrite a corrupt policy silently.
    const file = policyFile(home);
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify({ version: 1, mode }, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    return getArchivePolicy(home);
  });
}


export function validateHandoffUrl(url, task) {
  let u;
  try { u = new URL(url); } catch (error) { throw new Error('A GitHub Handoff comment URL is required', { cause: error }); }
  const pathMatch = /^\/xiaolebao516\/ai-one\/issues\/([1-9]\d*)$/.exec(u.pathname);
  const commentMatch = /^#issuecomment-(\d+)$/.exec(u.hash);
  if (u.origin !== 'https://github.com' || !pathMatch || !commentMatch ||
      pathMatch[1] !== String(task) || u.search || u.username || u.password) {
    throw new Error('Handoff URL must identify a comment on this exact task issue');
  }
  return commentMatch[1];
}

export function verifyHandoff({ task, threadUrl, requestId, handoffUrl }, runner = spawnSync) {
  const id = validateHandoffUrl(handoffUrl, task);
  const res = runner('gh', ['api', 'repos/xiaolebao516/ai-one/issues/comments/' + id], {
    encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 262144,
  });
  if (res.error || res.status !== 0) throw new Error('Could not verify GitHub Handoff; check gh login/network');
  let body;
  let issueUrl;
  try { ({ body, issue_url: issueUrl } = JSON.parse(res.stdout)); } catch { throw new Error('Invalid GitHub Handoff API response'); }
  // The comment must really belong to the task issue, not just carry its number in the text.
  if (typeof issueUrl !== 'string' || !new RegExp('/repos/xiaolebao516/ai-one/issues/' + String(task) + '$').test(issueUrl))
    throw new Error('Handoff comment does not belong to the task issue; refuse to archive');
  if (typeof body !== 'string') throw new Error('Handoff comment has no body');
  const expected = ['Archive-ready: true', 'Task: #' + task,
    'Thread-SHA256: ' + digest(threadUrl), 'Request-ID: ' + requestId,
    'Reply-verified: true', 'Artifacts-saved: true', 'No-followups: true'];
  const lines = new Set(body.split(/\r?\n/).map((line) => line.trim()));
  if (!expected.every((line) => lines.has(line)))
    throw new Error('Handoff does not attest this exact finished thread/request; refuse to archive');
  return true;
}

// Compatible with Prodex lock publication: create a complete temp file, hard-link it
// atomically into place, and remove only our own inode. Never forcibly reap a busy lock.
export async function withLock(file, action) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, String(process.pid) + '\n', { flag: 'wx' });
  let owned = false;
  let result;
  let operationFailed = false;
  let operationError;
  try {
    try { fs.linkSync(temp, file); owned = true; }
    catch (error) {
      if (error.code === 'EEXIST')
        throw new Error('Archive/send lock is busy; do not interrupt the other operation', { cause: error });
      throw error;
    }
    result = await action();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  // Cleanup is deliberately outside finally: cleanup failures must not silently
  // replace an action error, and an identity mismatch must never delete another lock.
  let cleanupFailed = false;
  let cleanupError;
  if (owned) {
    try {
      const a = fs.statSync(temp), b = fs.statSync(file);
      if (a.dev !== b.dev || a.ino !== b.ino) {
        cleanupFailed = true;
        cleanupError = new Error('Lock identity changed: not releasing another owner');
      } else {
        fs.rmSync(file);
      }
    } catch (error) {
      cleanupFailed = true;
      cleanupError = error;
    }
  }
  try { fs.rmSync(temp, { force: true }); }
  catch (error) {
    if (cleanupFailed) cleanupError = new AggregateError([cleanupError, error], 'Multiple lock cleanup failures');
    else { cleanupFailed = true; cleanupError = error; }
  }

  if (operationFailed && cleanupFailed)
    throw new AggregateError([operationError, cleanupError], 'Archive action and lock cleanup both failed');
  if (operationFailed) throw operationError;
  if (cleanupFailed) throw cleanupError;
  return result;
}

function readJournal(home) {
  try {
    const x = JSON.parse(fs.readFileSync(storageFile(home), 'utf8'));
    if (x?.version !== 1 || !x.items || typeof x.items !== 'object' || Array.isArray(x.items))
      throw new Error('Invalid archive journal');
    return x;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, items: {} };
    throw new Error('Archive journal corrupt or unreadable; manual recovery required', { cause: error });
  }
}
export function statusFor(home, threadUrl) {
  return readJournal(home).items[digest(canonicalThread(threadUrl))] ?? null;
}
export async function setStatus(home, threadUrl, value) {
  const id = digest(canonicalThread(threadUrl));
  return withLock(path.join(storageDir(home), 'journal.lock'), async () => {
    const data = readJournal(home);
    if (data.items[id]?.status === 'archived' && value.status !== 'archived') return data.items[id];
    const record = {
      status: value.status, task: String(value.task), slot: value.slot ?? null,
      updatedAt: new Date().toISOString(),
    };
    if (value.reason) record.reason = String(value.reason).replace(/https?:\/\/\S+/g, '[url]').slice(0, 180);
    data.items[id] = record;
    const temp = storageFile(home) + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, storageFile(home));
    } finally { fs.rmSync(temp, { force: true }); }
    return record;
  });
}
function otherClaims(home, ownSlot, url) {
  for (const slot of loadConfig(home).slots) {
    if (slot.id === ownSlot) continue;
    const claim = readClaim(home, slot.id);
    if (!claim) continue;
    const thread = claimOwnership(claim).threadUrl;
    if (!thread || thread === url)
      throw new Error('Other slot has active or unknown thread ownership; refuse archive');
  }
}
export function validateFinish({ task, slot, threadUrl, requestId, handoffUrl }) {
  if (!/^[1-9]\d*$/.test(String(task))) throw new Error('Task must be a positive issue number');
  if (!Number.isSafeInteger(slot) || slot < 1) throw new Error('Slot must be a positive integer');
  const url = canonicalThread(threadUrl);
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9._:-]{6,128}$/.test(requestId))
    throw new Error('Verified Prodex request ID is required');
  validateHandoffUrl(handoffUrl, task);
  return { task: String(task), slot, threadUrl: url, requestId, handoffUrl };
}

// finish = scheduler's explicit lifecycle transition, NOT end of one ask.
// Handoff verification is mandatory; slot release remains independent from archive success.
export async function finish(args, { home = slotsHome(), verify = verifyHandoff, archive = archiveConversation } = {}) {
  const input = validateFinish(args);
  const { task, slot, threadUrl } = input;
  if (!loadConfig(home).slots.some((item) => item.id === slot)) throw new Error('Slot not registered');
  const previous = statusFor(home, threadUrl);
  if (previous?.status === 'archived') return { status: 'archived', alreadyArchived: true };
  if (previous?.status === 'skipped' && !args.retry) throw new Error('Thread was skipped; retry explicitly to override');
  verify(input);
  return withLock(path.join(storageDir(home), 'thread-' + digest(threadUrl) + '.lock'), async () => {
    if (statusFor(home, threadUrl)?.status === 'archived')
      return { status: 'archived', alreadyArchived: true };
    await setStatus(home, threadUrl, { status: 'pending', task, slot });
    const claim = claimSlot(home, slot, { meta: { task, threadUrl } });
    if (!claim.ok) {
      await setStatus(home, threadUrl, { status: 'failed', task, slot, reason: 'Slot is busy' });
      throw new Error('Slot occupied; wait for owner to finish');
    }
    const definition = slotDefinition(slot, home);
    let outcome = 'failed';
    let result;
    let operationFailed = false;
    let operationError;
    try {
      otherClaims(home, slot, threadUrl);
      await withLock(definition.lockFile ?? path.join(home, 'browser-send.lock'), async () => {
        otherClaims(home, slot, threadUrl);
        await archive({ port: definition.port, threadUrl });
      });
      outcome = 'archived';
      await setStatus(home, threadUrl, { status: outcome, task, slot });
      result = { status: outcome };
    } catch (error) {
      operationFailed = true;
      operationError = error;
      try {
        await setStatus(home, threadUrl, { status: 'failed', task, slot, reason: error?.message });
      } catch (statusError) {
        operationError = new AggregateError([error, statusError], 'Archive failed and failure status could not be recorded');
      }
    }

    const cleanupErrors = [];
    let released = false;
    try {
      released = claim.release();
      if (!released) cleanupErrors.push(new Error('Slot claim could not be released; check prodex-slots list'));
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (released) {
      try {
        writeClosure(home, slot, { ownership: { task, threadUrl }, note: 'thread closed; archive ' + outcome });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (operationFailed && cleanupErrors.length > 0)
      throw new AggregateError([operationError, ...cleanupErrors], 'Archive operation and slot cleanup failed');
    if (operationFailed) throw operationError;
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, 'Slot cleanup failed');
    return result;
  });
}

export async function skip({ task, threadUrl }, { home = slotsHome() } = {}) {
  if (!/^[1-9]\d*$/.test(String(task))) throw new Error('Invalid task');
  return setStatus(home, canonicalThread(threadUrl), { status: 'skipped', task, slot: null });
}
