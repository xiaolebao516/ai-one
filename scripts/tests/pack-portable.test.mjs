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
    for (const notice of ['agent-hud-third-party.md', 'third-party/THIRD_PARTY_NOTICES.txt', 'third-party/LobeIcons-LICENSE.txt', 'third-party/react-bits-LICENSE.md']) {
      assert.ok(names.includes(notice), notice);
    }
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

test('--no-hud or a missing HUD never takes a stale HUD from the input folder along', () => {
  const skipped = pack((tmp, input) => {
    fs.writeFileSync(path.join(input, 'ai-one-hud.exe'), 'stale');
    return ['--no-hud'];
  });
  const missing = pack((tmp, input) => {
    fs.writeFileSync(path.join(input, 'ai-one-hud.exe'), 'stale');
    return ['--hud', path.join(tmp, 'nope', 'ai-one-hud.exe')];
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
    assert.equal(missing.result.status, 0, missing.result.stderr);
    assert.ok(!zipNames(missing.out).includes('ai-one-hud.exe'));
    assert.equal(twice.result.status, 0, twice.result.stderr);
    assert.equal(zipNames(twice.out).filter((name) => name === 'ai-one-hud.exe').length, 1);
  } finally {
    fs.rmSync(skipped.dir, { recursive: true, force: true });
    fs.rmSync(missing.dir, { recursive: true, force: true });
    fs.rmSync(twice.dir, { recursive: true, force: true });
  }
});

test('the HUD is not shipped without its licences: packaging fails instead', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-portable-nonotice-'));
  try {
    const input = path.join(dir, 'release');
    fs.mkdirSync(input);
    fs.writeFileSync(path.join(input, 'app.exe'), 'app');
    const hud = path.join(dir, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'hud');
    const out = path.join(dir, 'out.zip');
    // Run from a folder that has no agent-hud/ notices at all.
    const result = spawnSync(process.execPath, [script, '--input', input, '--out', out, '--no-prefix', '--hud', hud], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /required notice files are missing/);
    assert.ok(!fs.existsSync(out), 'no zip is written');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--clean-art fails when proprietary clawd-sprites.json is present in HUD assets', () => {
  const proprietaryArt = path.join(root, 'agent-hud', 'src', 'packages', 'hud', 'src', 'assets', 'clawd-sprites.json');
  const wasPresent = fs.existsSync(proprietaryArt);
  if (!wasPresent) {
    fs.mkdirSync(path.dirname(proprietaryArt), { recursive: true });
    fs.writeFileSync(proprietaryArt, '{"test":true}');
  }
  const { dir, out, result } = pack((tmp) => {
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'hud');
    return ['--hud', hud, '--clean-art'];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Packaging aborted: --clean-art was requested for public release/);
    assert.ok(!fs.existsSync(out));
  } finally {
    if (!wasPresent && fs.existsSync(proprietaryArt)) {
      fs.unlinkSync(proprietaryArt);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--clean-art fails when stale binary contains embedded Clawd sprites even if source JSON was removed', () => {
  const proprietaryArt = path.join(root, 'agent-hud', 'src', 'packages', 'hud', 'src', 'assets', 'clawd-sprites.json');
  const backup = path.join(root, 'agent-hud', 'src', 'packages', 'hud', 'src', 'assets', 'clawd-sprites.json.bak');
  const wasPresent = fs.existsSync(proprietaryArt);
  if (wasPresent) {
    fs.renameSync(proprietaryArt, backup);
  }
  const { dir, out, result } = pack((tmp) => {
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'binary content with DancingHappy sprite table embedded');
    return ['--hud', hud, '--clean-art'];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /embedded Clawd sprite table inside HUD binary/);
    assert.ok(!fs.existsSync(out));
  } finally {
    if (wasPresent && fs.existsSync(backup)) {
      fs.renameSync(backup, proprietaryArt);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
