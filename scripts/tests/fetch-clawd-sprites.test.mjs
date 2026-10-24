import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_FRAME_COUNTS,
  validateClawdSprites,
} from '../fetch-clawd-sprites.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(root, 'scripts', 'fetch-clawd-sprites.mjs');

function makeSyntheticValidSprites() {
  const sprites = {};
  for (const [name, count] of Object.entries(REQUIRED_FRAME_COUNTS)) {
    const deltas = [];
    for (let i = 1; i < count; i += 1) {
      deltas.push('01'); // change pixel 0 to palette color index 1
    }
    sprites[name] = {
      w: 2,
      h: 2,
      palette: ['#ff0000', '#00ff00'],
      base: '01..',
      deltas,
      a0: [0, 0, 2, 2],
    };
  }
  return { claude: '2.37337.1', sprites };
}

test('validateClawdSprites accepts valid full 18-action sprite table matching frame counts', () => {
  const payload = makeSyntheticValidSprites();
  const parsed = validateClawdSprites(JSON.stringify(payload));
  assert.equal(typeof parsed, 'object');
  assert.equal(Object.keys(parsed.sprites).length, 18);
});

test('validateClawdSprites throws on malformed JSON syntax', () => {
  assert.throws(
    () => validateClawdSprites('{ bad json'),
    /Invalid JSON syntax/,
  );
});

test('validateClawdSprites throws on missing sprites object', () => {
  assert.throws(
    () => validateClawdSprites(JSON.stringify({ claude: '2.0' })),
    /Missing or invalid "sprites" property/,
  );
});

test('validateClawdSprites throws on missing required actions', () => {
  const payload = makeSyntheticValidSprites();
  delete payload.sprites.DancingHappy;
  assert.throws(
    () => validateClawdSprites(JSON.stringify(payload)),
    /Missing required action sprite: "DancingHappy"/,
  );
});

test('validateClawdSprites throws on frame count mismatch / missing deltas', () => {
  const payload = makeSyntheticValidSprites();
  // DancingHappy expects 40 frames, set deltas to empty array (1 frame total)
  payload.sprites.DancingHappy.deltas = [];
  assert.throws(
    () => validateClawdSprites(JSON.stringify(payload)),
    /Invalid frame count for sprite "DancingHappy": expected 40, got 1/,
  );
});

test('validateClawdSprites throws on base length mismatch', () => {
  const payload = makeSyntheticValidSprites();
  payload.sprites.Walking.base = '0'; // expects 2*2=4 characters
  assert.throws(
    () => validateClawdSprites(JSON.stringify(payload)),
    /Invalid base frame length for sprite: "Walking"/,
  );
});

test('validateClawdSprites throws on out-of-range delta pixel offset', () => {
  const payload = makeSyntheticValidSprites();
  // Pixel offset 99 is >= 2*2=4
  payload.sprites.Walking.deltas[0] = '990';
  assert.throws(
    () => validateClawdSprites(JSON.stringify(payload)),
    /Delta pixel offset out of range in sprite: "Walking"/,
  );
});

test('validateClawdSprites throws when palette exceeds 36 colors', () => {
  const payload = makeSyntheticValidSprites();
  payload.sprites.Walking.palette = Array.from({ length: 37 }, () => '#112233');
  assert.throws(
    () => validateClawdSprites(JSON.stringify(payload)),
    /Invalid palette length \(must be 1\.\.36\) for sprite: "Walking"/,
  );
});

test('validateClawdSprites throws on non-base36 delta character syntax', () => {
  const payload = makeSyntheticValidSprites();
  payload.sprites.Walking.deltas[0] = '0!0'; // invalid character !
  assert.throws(
    () => validateClawdSprites(JSON.stringify(payload)),
    /Invalid delta pixel offset syntax "0!" in sprite: "Walking"/,
  );
});

test('validateClawdSprites throws when dimensions exceed 65536', () => {
  const payload = makeSyntheticValidSprites();
  payload.sprites.Walking.w = 300;
  payload.sprites.Walking.h = 300;
  assert.throws(
    () => validateClawdSprites(JSON.stringify(payload)),
    /Sprite dimensions exceed 65536 pixel limit for sprite: "Walking"/,
  );
});

test('validateClawdSprites throws on unexpected unknown extra sprite key', () => {
  const payload = makeSyntheticValidSprites();
  payload.sprites.UnexpectedBonusAction = {
    w: 2,
    h: 2,
    palette: ['#112233'],
    base: '0000',
    deltas: [],
  };
  assert.throws(
    () => validateClawdSprites(JSON.stringify(payload)),
    /Unexpected unknown sprite key: "UnexpectedBonusAction"/,
  );
});

test('fetch-clawd-sprites CLI --clean removes target file, isolated dist, and existing provenance markers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-sprites-test-'));
  const target = path.join(tmpDir, 'clawd-sprites.json');
  const distDir = path.join(tmpDir, 'dist');
  const releaseDir = path.join(tmpDir, 'release');
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(target, 'dummy');
  fs.writeFileSync(path.join(distDir, 'dummy.txt'), 'dist content');
  fs.writeFileSync(path.join(releaseDir, 'ai-one-hud.exe'), 'exe content');
  fs.writeFileSync(path.join(releaseDir, '.hud-art-clean'), 'old receipt');
  fs.writeFileSync(path.join(releaseDir, '.hud-art-original'), 'old orig marker');

  try {
    const res = spawnSync(process.execPath, [
      script,
      '--clean',
      '--target', target,
      '--dist-dir', distDir,
      '--release-dir', releaseDir,
    ], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 0);
    assert.ok(!fs.existsSync(target), 'target file should be unlinked');
    assert.ok(!fs.existsSync(distDir), 'isolated dist dir should be unlinked');
    assert.ok(!fs.existsSync(path.join(releaseDir, 'ai-one-hud.exe')), 'isolated exe should be unlinked');
    assert.ok(!fs.existsSync(path.join(releaseDir, '.hud-art-clean')), 'clean marker should be removed on clean');
    assert.ok(!fs.existsSync(path.join(releaseDir, '.hud-art-original')), 'original marker should be removed on clean');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('fetch-clawd-sprites CLI --record-clean writes valid 64-char sha256 and fails if artwork present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-sprites-record-test-'));
  const target = path.join(tmpDir, 'clawd-sprites.json');
  const distDir = path.join(tmpDir, 'dist');
  const releaseDir = path.join(tmpDir, 'release');
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(releaseDir, { recursive: true });
  const exePath = path.join(releaseDir, 'ai-one-hud.exe');
  fs.writeFileSync(exePath, 'compiled binary bytes');

  try {
    // 1. Successful record-clean
    const res = spawnSync(process.execPath, [
      script,
      '--record-clean',
      '--target', target,
      '--dist-dir', distDir,
      '--release-dir', releaseDir,
      exePath,
    ], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    const receiptPath = path.join(releaseDir, '.hud-art-clean');
    assert.ok(fs.existsSync(receiptPath));
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.equal(receipt.clean, true);
    assert.match(receipt.sha256, /^[0-9a-f]{64}$/);
    assert.equal(receipt.exe, 'ai-one-hud.exe');

    // 2. Fails if proprietary artwork target is present
    fs.writeFileSync(target, 'proprietary art payload');
    const resFail = spawnSync(process.execPath, [
      script,
      '--record-clean',
      '--target', target,
      '--dist-dir', distDir,
      '--release-dir', releaseDir,
      exePath,
    ], {
      encoding: 'utf8',
    });
    assert.notEqual(resFail.status, 0);
    assert.match(resFail.stderr, /Cannot record clean build provenance/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('fetch-clawd-sprites CLI --strict fails when existing file has missing frames', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-sprites-test-'));
  const target = path.join(tmpDir, 'clawd-sprites.json');
  const payload = makeSyntheticValidSprites();
  payload.sprites.Walking.deltas = []; // valid JSON but missing frames
  fs.writeFileSync(target, JSON.stringify(payload));
  try {
    const res = spawnSync(process.execPath, [script, '--strict'], {
      env: { ...process.env, CLAWD_SPRITES_DEST: target },
      encoding: 'utf8',
    });
    assert.equal(res.status, 1, 'strict mode should exit 1 on incomplete frames');
    assert.match(res.stderr, /Error \(strict mode\): Existing clawd-sprites\.json is invalid/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
