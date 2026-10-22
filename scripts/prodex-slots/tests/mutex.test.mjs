import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withMutex } from '../slots.mjs';

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prodex-mutex-'));

function withPlatform(platform, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
}

function codedError(code) {
  return Object.assign(new Error(`simulated ${code} from exclusive open`), { code });
}

function mockMutexOpen(t, file, outcome) {
  const originalWriteFileSync = fs.writeFileSync;
  let attempts = 0;
  t.mock.method(fs, 'writeFileSync', function (filePath, data, options) {
    if (filePath === file && options?.flag === 'wx') {
      attempts += 1;
      const result = outcome(attempts);
      if (result instanceof Error) throw result;
    }
    return originalWriteFileSync.call(fs, filePath, data, options);
  });
  return () => attempts;
}

test('withMutex retries a transient Windows EPERM from wx open and acquires the mutex', (t) => {
  const file = path.join(tempHome(), 'slots.json.lock');
  t.mock.method(Atomics, 'wait', () => 'timed-out');
  const attempts = mockMutexOpen(t, file, (attempt) => (attempt === 1 ? codedError('EPERM') : undefined));

  const result = withPlatform('win32', () => withMutex(file, () => 'acquired', { timeoutMs: 100 }));

  assert.equal(result, 'acquired');
  assert.equal(attempts(), 2);
  assert.equal(fs.existsSync(file), false, 'the mutex is released after the callback');
});

test('withMutex stops retrying persistent Windows EPERM at the deadline and preserves the error', (t) => {
  const file = path.join(tempHome(), 'slot-2.json.reap');
  let now = 1_000;
  const waits = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(Atomics, 'wait', (_view, _index, _value, timeout) => {
    waits.push(timeout);
    now += timeout;
    return 'timed-out';
  });
  const attempts = mockMutexOpen(t, file, () => codedError('EPERM'));

  assert.throws(
    () => withPlatform('win32', () => withMutex(file, () => assert.fail('callback must not run'), { timeoutMs: 75 })),
    (error) => error.code === 'EPERM',
  );
  assert.equal(attempts(), 3, 'there is no open attempt after the deadline');
  assert.deepEqual(waits, [25, 25, 25]);
  assert.equal(now, 1_075, 'retry waiting is bounded by timeoutMs');
  assert.equal(fs.existsSync(file), false, 'a failed open never creates or removes a mutex');
});

test('withMutex does not retry unrelated Windows EACCES errors', (t) => {
  const file = path.join(tempHome(), 'slots.json.lock');
  const denied = codedError('EACCES');
  const attempts = mockMutexOpen(t, file, () => denied);

  assert.throws(
    () => withPlatform('win32', () => withMutex(file, () => assert.fail('callback must not run'), { timeoutMs: 100 })),
    (error) => error === denied,
  );
  assert.equal(attempts(), 1);
});

test('withMutex preserves non-Windows EPERM behavior', (t) => {
  const file = path.join(tempHome(), 'slots.json.lock');
  const denied = codedError('EPERM');
  const attempts = mockMutexOpen(t, file, () => denied);

  assert.throws(
    () => withPlatform('linux', () => withMutex(file, () => assert.fail('callback must not run'), { timeoutMs: 100 })),
    (error) => error === denied,
  );
  assert.equal(attempts(), 1);
});
