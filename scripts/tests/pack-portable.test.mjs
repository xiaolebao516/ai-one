import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(root, 'scripts', 'pack-portable.mjs');

/** Names in a zip, read from its central directory (the script writes classic, non-Zip64 archives). */
function zipNames(zipPath) {
  const data = fs.readFileSync(zipPath);
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of central directory');
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(data.readUInt32LE(offset), 0x02014b50);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    names.push(data.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function pack(args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-portable-'));
  const input = path.join(dir, 'release');
  fs.mkdirSync(input);
  fs.writeFileSync(path.join(input, 'app.exe'), 'app');
  const out = path.join(dir, 'out.zip');
  const result = spawnSync(process.execPath, [script, '--input', input, '--out', out, '--no-prefix', ...args(dir, input)], {
    cwd: root,
    encoding: 'utf8',
  });
  return { dir, input, out, result };
}

test('a built HUD ships next to the app with its notices', () => {
  const { dir, out, result } = pack((tmp) => {
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'hud');
    return ['--hud', hud];
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    const names = zipNames(out);
    assert.ok(names.includes('app.exe'));
    assert.ok(names.includes('ai-one-hud.exe'), 'HUD beside the app');
    assert.ok(names.includes('NOTICE.md'));
    assert.ok(names.includes('LICENSE-ai-one-hud.txt'));
    assert.equal(names.filter((name) => name === 'ai-one-hud.exe').length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('without a built HUD the zip is still made, with a note', () => {
  const { dir, out, result } = pack((tmp) => ['--hud', path.join(tmp, 'missing', 'ai-one-hud.exe')]);
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Quota HUD not included/);
    const names = zipNames(out);
    assert.ok(names.includes('app.exe'));
    assert.ok(!names.includes('ai-one-hud.exe'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--no-hud skips it, and a HUD in the input folder is neither mistaken for the app nor added twice', () => {
  const skipped = pack((tmp) => {
    fs.writeFileSync(path.join(tmp, 'ai-one-hud.exe'), 'hud');
    return ['--no-hud'];
  });
  const twice = pack((tmp, input) => {
    fs.writeFileSync(path.join(input, 'ai-one-hud.exe'), 'old');
    const hud = path.join(tmp, 'new-hud.exe');
    fs.writeFileSync(hud, 'new');
    return ['--hud', hud];
  });
  try {
    assert.equal(skipped.result.status, 0, skipped.result.stderr);
    assert.ok(!zipNames(skipped.out).includes('ai-one-hud.exe'));
    assert.equal(twice.result.status, 0, twice.result.stderr);
    assert.equal(zipNames(twice.out).filter((name) => name === 'ai-one-hud.exe').length, 1);
  } finally {
    fs.rmSync(skipped.dir, { recursive: true, force: true });
    fs.rmSync(twice.dir, { recursive: true, force: true });
  }
});
