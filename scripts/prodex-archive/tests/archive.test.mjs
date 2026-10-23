import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { main, parseArgs } from '../cli.mjs';
import { canonicalThread, digest, finish, getArchivePolicy, setArchivePolicy, skip, statusFor, validateFinish,
  validateHandoffUrl, verifyHandoff, withLock } from '../archive.mjs';
import { inspectPage, inspectSidebarRemoval, selectExactTab } from '../browser-ui.mjs';
import { addSlots, claimSlot, readClaim } from '../../prodex-slots/slots.mjs';

const A = 'https://chatgpt.com/c/6ad9e501-da24-83e9-81f9-8b5aae1f7013';
const B = 'https://chatgpt.com/c/7bd8e501-1234-83e9-9ad7-429cd3782b79';
const handoff = 'https://github.com/xiaolebao516/ai-one/issues/94#issuecomment-12345';
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'));
const input = () => ({ task: '94', slot: 1, threadUrl: A, requestId: 'req-12345', handoffUrl: handoff });

test('canonical target and handoff checks refuse credentials, fragments and wrong issue', () => {
  assert.equal(canonicalThread(A), A);
  assert.throws(() => canonicalThread(A + '?token=private'), /thread-url/);
  assert.throws(() => canonicalThread('https://evil.test/c/6ad9e501-da24-83e9-81f9-8b5aae1f7013'), /thread-url/);
  assert.throws(() => validateHandoffUrl(handoff.replace('/94#', '/95#'), '94'));
  assert.throws(() => validateFinish({ ...input(), requestId: '' }));
  assert.equal(validateFinish(input()).threadUrl, A);
});
test('the Handoff must actually exist and attest the exact thread/request and completion', () => {
  const values = [
    'Archive-ready: true', 'Task: #94', 'Thread-SHA256: ' + digest(A),
    'Request-ID: req-12345', 'Reply-verified: true', 'Artifacts-saved: true', 'No-followups: true',
  ];
  const fetchComment = (issue = 94) => () => ({ status: 0, stdout: JSON.stringify({ body: values.join('\n'), issue_url: 'https://api.github.com/repos/xiaolebao516/ai-one/issues/' + issue }) });
  assert.equal(verifyHandoff(input(), fetchComment()), true);
  assert.throws(() => verifyHandoff(input(), fetchComment(95)), /does not belong to the task issue/);
  assert.throws(() => verifyHandoff(input(), () => ({ status: 0, stdout: JSON.stringify({ body: values.join('\n') }) })), /does not belong/);
  assert.throws(() => verifyHandoff({ ...input(), threadUrl: B }, fetchComment()), /refuse/);
  assert.throws(() => verifyHandoff(input(), () => ({ status: 1, error: 'network' })), /Could not verify/);
});
test('finish archives only with a verified Handoff, writes status and closes slot independently', async () => {
  const home = temp();
  let calls = 0;
  const r = await finish(input(), { home, verify: () => true, archive: async ({ port, threadUrl }) => {
    assert.equal(port, 9333); assert.equal(threadUrl, A); calls++;
  } });
  assert.equal(r.status, 'archived');
  assert.equal(statusFor(home, A).status, 'archived');
  assert.equal(readClaim(home, 1), null);
  const second = await finish(input(), { home, verify: () => { throw new Error('not needed'); } });
  assert.equal(second.alreadyArchived, true);
  assert.equal(calls, 1);
});
test('request mismatch/failed UI keeps retryable status and does not hold a slot', async () => {
  const home = temp();
  await assert.rejects(finish(input(), { home, verify: () => true,
    archive: async () => { throw new Error('request_mismatch'); } }), /request_mismatch/);
  assert.equal(statusFor(home, A).status, 'failed');
  assert.equal(readClaim(home, 1), null);
  const done = await finish({ ...input(), retry: true }, { home, verify: () => true, archive: async () => {} });
  assert.equal(done.status, 'archived');
});
test('no proof means no browser interaction, no claim, no status', async () => {
  const home = temp();
  await assert.rejects(finish(input(), { home, verify: () => { throw new Error('handoff missing'); },
    archive: async () => { throw new Error('MUST NOT CALL'); } }), /handoff missing/);
  assert.equal(readClaim(home, 1), null);
  assert.equal(statusFor(home, A), null);
});
test('skip protects a thread until explicit retry', async () => {
  const home = temp();
  await skip({ task: 94, threadUrl: A }, { home });
  assert.equal(statusFor(home, A).status, 'skipped');
  await assert.rejects(finish(input(), { home, verify: () => true, archive: async () => {} }), /skipped/);
  assert.equal((await finish({ ...input(), retry: true }, { home, verify: () => true, archive: async () => {} })).status, 'archived');
});
test('a concurrent claim on same thread blocks archive', async () => {
  const home = temp();
  addSlots(home, 1);
  const other = claimSlot(home, 2, { meta: { task: '94', threadUrl: A } });
  try {
    await assert.rejects(finish(input(), { home, verify: () => true, archive: async () => {
      throw new Error('MUST NOT CALL'); } }), /Other slot/);
    assert.equal(statusFor(home, A).status, 'failed');
    assert.equal(readClaim(home, 1), null);
  } finally { other.release(); }
});
test('another slot busy with a different or unregistered chat does not block archive', async () => {
  const home = temp();
  addSlots(home, 2);
  const unregistered = claimSlot(home, 2, { meta: { task: '99' } });
  const different = claimSlot(home, 3, { meta: { task: '98', threadUrl: B } });
  try {
    const r = await finish(input(), { home, verify: () => true, archive: async () => {} });
    assert.equal(r.status, 'archived');
  } finally { unregistered.release(); different.release(); }
});
test('held browser send lock prevents archive (do not steal another process lock)', async () => {
  const home = temp();
  const lock = path.join(home, 'browser-send.lock');
  await withLock(lock, async () => {
    await assert.rejects(finish(input(), { home, verify: () => true, archive: async () => {
      throw new Error('MUST NOT CALL'); } }), /busy/);
  });
  assert.equal(statusFor(home, A).status, 'failed');
  assert.equal(readClaim(home, 1), null);
});
test('two concurrent attempts cannot archive the same thread twice', async () => {
  const home = temp();
  let resolve;
  const gate = new Promise((r) => { resolve = r; });
  let entered;
  const waitEntry = new Promise((r) => { entered = r; });
  const first = finish(input(), { home, verify: () => true, archive: async () => {
    entered(); await gate;
  } });
  await waitEntry;
  await assert.rejects(finish(input(), { home, verify: () => true, archive: async () => {} }), /busy/);
  resolve();
  await first;
});
test('CDP selection never chooses a different visible chat', () => {
  const tabs = [
    { type: 'page', url: B, webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/b' },
    { type: 'page', url: A, webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/a' },
  ];
  assert.equal(selectExactTab(tabs, A).url, A);
  assert.throws(() => selectExactTab([tabs[0]], A), /No unique/);
  assert.throws(() => selectExactTab([tabs[1], tabs[1]], A), /No unique/);
});
test('archive policy defaults to auto, persists manual mode, and refuses invalid values', async () => {
  const home = temp();
  assert.deepEqual(getArchivePolicy(home), { version: 1, mode: 'auto' });
  assert.deepEqual(await setArchivePolicy(home, 'manual'), { version: 1, mode: 'manual' });
  assert.equal(getArchivePolicy(home).mode, 'manual');
  await assert.rejects(setArchivePolicy(home, 'sometimes'), /auto or manual/);
});

test('auto-finish obeys manual policy while explicit finish remains available', async () => {
  const home = temp();
  await setArchivePolicy(home, 'manual');
  const args = ['--slot', '1', '--task', '94', '--thread-url', A,
    '--request-id', 'req-12345', '--handoff-url', handoff];
  let calls = 0;
  const common = { home, runFinish: async () => { calls++; return { status: 'archived' }; },
    out: () => {}, err: () => {} };
  assert.equal(await main(['auto-finish', ...args], common), 0);
  assert.equal(calls, 0);
  assert.equal(await main(['finish', ...args], common), 0);
  assert.equal(calls, 1);
});

test('auto-finish calls the guarded lifecycle under the default auto policy', async () => {
  const home = temp();
  let called = false;
  const args = ['auto-finish', '--slot', '1', '--task', '94', '--thread-url', A,
    '--request-id', 'req-12345', '--handoff-url', handoff];
  const code = await main(args, { home,
    runFinish: async (input) => { called = input.retry === false && input.threadUrl === A; return { status: 'archived' }; },
    out: () => {}, err: () => {},
  });
  assert.equal(code, 0);
  assert.equal(called, true);
});

test('Chat actions is recognized as the row menu and an offscreen target is scrolled into view', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const dom = new JSDOM('<main><div id="prompt-textarea" contenteditable="true"></div></main>' +
    '<nav><div id="row"><a href="' + A + '">target</a>' +
    '<button aria-label="Chat actions">actions</button><button aria-label="Pin chat">pin</button></div></nav>',
    { url: A, pretendToBeVisual: true });
  const link = dom.window.document.querySelector('a[href]');
  const actions = dom.window.document.querySelector('[aria-label="Chat actions"]');
  const pin = dom.window.document.querySelector('[aria-label="Pin chat"]');
  let scrollCalls = 0;
  let rowRect = { left: 10, top: -62, right: 90, bottom: -22, width: 80, height: 40 };
  link.getBoundingClientRect = () => rowRect;
  link.scrollIntoView = (options) => {
    scrollCalls++;
    assert.deepEqual(options, { block: 'center', inline: 'nearest', behavior: 'instant' });
    rowRect = { left: 10, top: 100, right: 90, bottom: 140, width: 80, height: 40 };
  };
  actions.getBoundingClientRect = () => ({ left: 500, top: 100, right: 540, bottom: 140, width: 40, height: 40 });
  pin.getBoundingClientRect = () => ({ left: 700, top: 100, right: 740, bottom: 140, width: 40, height: 40 });
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: dom.window.location });
    const result = inspectPage(A);
    assert.equal(result.ok, true);
    assert.deepEqual(result.row, { x: 50, y: 120 });
    assert.deepEqual(result.menu, { x: 520, y: 120 });
    assert.equal(scrollCalls, 1);
  } finally {
    dom.window.close();
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete globalThis.location;
  }
});

test('sidebar disappearance is not confirmed when the sidebar is empty or the target remains', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const setDocument = (document) => Object.defineProperty(globalThis, 'document', {
    configurable: true, writable: true, value: document,
  });
  const noSidebar = new JSDOM('<main></main>', { url: A, pretendToBeVisual: true });
  const empty = new JSDOM('<main></main><nav></nav>', { url: A, pretendToBeVisual: true });
  const present = new JSDOM('<main></main><nav><a href="' + A + '">target</a><a href="' + B + '">other</a></nav>',
    { url: A, pretendToBeVisual: true });
  const removed = new JSDOM('<main></main><nav><a href="' + B + '">other</a></nav>',
    { url: A, pretendToBeVisual: true });
  try {
    setDocument(noSidebar.window.document);
    assert.equal(inspectSidebarRemoval(A), false);
    setDocument(empty.window.document);
    assert.equal(inspectSidebarRemoval(A), false);
    setDocument(present.window.document);
    assert.equal(inspectSidebarRemoval(A), false);
    setDocument(removed.window.document);
    assert.equal(inspectSidebarRemoval(A), true);
  } finally {
    noSidebar.window.close();
    empty.window.close();
    present.window.close();
    removed.window.close();
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  }
});

test('CLI requires explicit completion evidence and refuses ambiguous options', () => {
  const args = ['finish', '--slot', '1', '--task', '94', '--thread-url', A,
    '--request-id', 'req-12345', '--handoff-url', handoff];
  assert.equal(parseArgs(args).options.slot, 1);
  assert.throws(() => parseArgs(['finish', '--task', '94']), /Incorrect/);
  assert.throws(() => parseArgs(args.concat(['--slot', '2'])), /Duplicate/);
});
