import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_SPRITES,
  validateClawdSprites,
} from '../fetch-clawd-sprites.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(root, 'scripts', 'fetch-clawd-sprites.mjs');

function makeSyntheticValidSprites() {
  const sprites = {};
  for (const name of REQUIRED_SPRITES) {
    sprites[name] = {
      w: 2,
      h: 2,
      palette: ['#ff0000', '#00ff00'],
      base: '01..',
      deltas: [],
      a0: [0, 0, 2, 2],
    };
  }
  return { claude: '2.37337.1', sprites };
}

test('validateClawdSprites accepts valid full 18-action sprite table', () => {
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

test('validateClawdSprites throws on base length mismatch', () => {
  const payload = makeSyntheticValidSprites();
  payload.sprites.Walking.base = '0'; // expects 2*2=4 characters
  assert.throws(
    () => validateClawdSprites(JSON.stringify(payload)),
    /Invalid base frame length for sprite: "Walking"/,
  );
});

test('fetch-clawd-sprites CLI --clean removes existing target file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-sprites-test-'));
  const target = path.join(tmpDir, 'clawd-sprites.json');
  fs.writeFileSync(target, 'dummy');
  try {
    const res = spawnSync(process.execPath, [script, '--clean'], {
      env: { ...process.env, CLAWD_SPRITES_DEST: target },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0);
    assert.ok(!fs.existsSync(target), 'file should be unlinked');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('fetch-clawd-sprites CLI --strict fails when existing file is corrupted', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-sprites-test-'));
  const target = path.join(tmpDir, 'clawd-sprites.json');
  fs.writeFileSync(target, '{ corrupted json ');
  try {
    const res = spawnSync(process.execPath, [script, '--strict'], {
      env: { ...process.env, CLAWD_SPRITES_DEST: target },
      encoding: 'utf8',
    });
    assert.equal(res.status, 1, 'strict mode should exit 1 on corrupted file');
    assert.match(res.stderr, /Error \(strict mode\): Existing clawd-sprites\.json is invalid/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
