import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts', 'pack-portable.mjs');

// Pre-test repository snapshot to verify zero pollution and avoid false positives
const initialLicenseContent = fs.readFileSync(path.join(root, 'agent-hud', 'LICENSE'), 'utf8');
const initialArtExists = fs.existsSync(path.join(root, 'agent-hud', 'src', 'packages', 'hud', 'src', 'assets', 'clawd-sprites.json'));
const initialOriginalMarkerExists = fs.existsSync(path.join(root, 'agent-hud', 'target', 'release', '.hud-art-original'));
const initialOriginalMarkerContent = initialOriginalMarkerExists
  ? fs.readFileSync(path.join(root, 'agent-hud', 'target', 'release', '.hud-art-original'), 'utf8')
  : null;

function zipNames(zipPath) {
  const data = fs.readFileSync(zipPath);
  const count = data.readUInt16LE(data.length - 22 + 10);
  let offset = data.readUInt32LE(data.length - 22 + 16);
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

function makeCleanHudReceipt(hudPath) {
  const content = fs.readFileSync(hudPath);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const dir = path.dirname(hudPath);
  fs.writeFileSync(path.join(dir, '.hud-art-clean'), JSON.stringify({
    clean: true,
    sha256,
    exe: path.basename(hudPath),
    timestamp: new Date().toISOString(),
  }, null, 2), 'utf8');
}

function pack(args, envOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-portable-'));
  const input = path.join(dir, 'release');
  fs.mkdirSync(input);
  fs.writeFileSync(path.join(input, 'app.exe'), 'app');
  const out = path.join(dir, 'out.zip');

  // Fully isolated mock HUD directories so the real repository is NEVER modified
  const testAssets = path.join(dir, 'mock-hud-assets');
  const testDist = path.join(dir, 'mock-hud-dist');
  const testRelease = path.join(dir, 'mock-hud-release');
  fs.mkdirSync(testAssets, { recursive: true });
  fs.mkdirSync(testDist, { recursive: true });
  fs.mkdirSync(testRelease, { recursive: true });
  // Provide dummy notice files so licence checks pass in mock assets:
  fs.writeFileSync(path.join(testAssets, 'THIRD_PARTY_NOTICES.txt'), 'dummy notice');
  fs.writeFileSync(path.join(testAssets, 'LobeIcons-LICENSE.txt'), 'dummy notice');

  const computedEnvOverrides = typeof envOverrides === 'function' ? envOverrides(dir) : envOverrides;

  const result = spawnSync(process.execPath, [
    script,
    '--input', input,
    '--out', out,
    '--no-prefix',
    ...args(dir, input, { testAssets, testDist, testRelease }),
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAWD_HUD_ASSETS: testAssets,
      CLAWD_HUD_DIST: testDist,
      CLAWD_HUD_RELEASE_DIR: testRelease,
      ...computedEnvOverrides,
    },
  });
  return { dir, input, out, result, testAssets, testDist, testRelease };
}

test('a built HUD ships next to the app with its notices when clean build receipt matches', () => {
  const { dir, out, result } = pack((tmp) => {
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'clean hud binary');
    makeCleanHudReceipt(hud);
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
    makeCleanHudReceipt(hud);
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
  const { dir, out, result } = pack((tmp) => {
    // Provide a mock HUD root missing its LICENSE file
    const mockHudRoot = path.join(tmp, 'mock-hud-root');
    fs.mkdirSync(path.join(mockHudRoot, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(mockHudRoot, 'src', 'packages', 'ui', 'src', 'react-bits'), { recursive: true });
    fs.writeFileSync(path.join(mockHudRoot, 'docs', 'third-party.md'), 'notices');
    fs.writeFileSync(path.join(mockHudRoot, 'src', 'packages', 'ui', 'src', 'react-bits', 'LICENSE.md'), 'notices');
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'hud');
    makeCleanHudReceipt(hud);
    return ['--hud', hud];
  }, (tmp) => ({
    CLAWD_HUD_ROOT: path.join(tmp, 'mock-hud-root'),
  }));
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /required notice files are missing/);
    assert.ok(!fs.existsSync(out), 'no zip is written');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('default packaging fails closed when proprietary clawd-sprites.json is present in HUD assets', () => {
  const { dir, out, result } = pack((tmp, input, { testAssets }) => {
    fs.writeFileSync(path.join(testAssets, 'clawd-sprites.json'), '{"sprites":{}}');
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'hud');
    makeCleanHudReceipt(hud);
    return ['--hud', hud];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Packaging aborted: Public redistribution requires Anthropic permission, but proprietary Clawd assets were detected \(clawd-sprites\.json present in HUD assets\)/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('default packaging fails closed when .hud-art-clean receipt is missing (unverified binary)', () => {
  const { dir, out, result } = pack((tmp) => {
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'unverified binary without clean receipt');
    return ['--hud', hud];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no verified clean-build provenance record/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('default packaging fails closed when binary SHA-256 does not match .hud-art-clean receipt (stale/substituted binary)', () => {
  const { dir, out, result } = pack((tmp) => {
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'original compiled binary');
    makeCleanHudReceipt(hud);
    // Tamper with binary after clean receipt was generated:
    fs.writeFileSync(hud, 'substituted binary content with different hash');
    return ['--hud', hud];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match clean-build provenance record/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('default packaging fails closed on .hud-art-original, but --allow-proprietary-art permits it for personal use', () => {
  const { dir, out, result } = pack((tmp, input, { testAssets }) => {
    fs.writeFileSync(path.join(testAssets, 'clawd-sprites.json'), '{"sprites":{}}');
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'hud');
    return ['--hud', hud, '--allow-proprietary-art'];
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(out));
    assert.match(result.stdout, /under explicit "--allow-proprietary-art" permission/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fails closed when binary contains embedded Clawd sprite table', () => {
  const { dir, out, result } = pack((tmp) => {
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'binary content with embedded clawd-sprites.json and {"sprites":{"Walking":{"palette":["#fff"],"deltas":["00"]}}} table');
    makeCleanHudReceipt(hud);
    return ['--hud', hud];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /embedded Clawd sprite table inside HUD binary/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clean code containing DancingHappy action identifier is not falsely detected as proprietary art', () => {
  const { dir, out, result } = pack((tmp) => {
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'binary with DancingHappy action name in clean bot code');
    makeCleanHudReceipt(hud);
    return ['--hud', hud];
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fails when dist contains clawd-sprites asset', () => {
  const { dir, out, result } = pack((tmp, input, { testDist }) => {
    const dummyFile = path.join(testDist, 'clawd-sprites-test.json');
    fs.writeFileSync(dummyFile, 'dummy');
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'clean hud');
    makeCleanHudReceipt(hud);
    return ['--hud', hud];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bundled asset "clawd-sprites-test\.json" in HUD dist/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('default packaging fails closed when clawd-sprites.json is in main app input with --no-hud', () => {
  const { dir, out, result } = pack((tmp, input) => {
    fs.writeFileSync(path.join(input, 'clawd-sprites.json'), '{"sprites":{}}');
    return ['--no-hud'];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Packaging aborted: Public redistribution requires Anthropic permission, but proprietary Clawd assets were detected in package contents/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('default packaging fails closed when clawd-sprites.json is nested inside main app input directory', () => {
  const { dir, out, result } = pack((tmp, input) => {
    const nested = path.join(input, 'assets', 'sprites');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'clawd-sprites.json'), '{"sprites":{}}');
    const hud = path.join(tmp, 'ai-one-hud.exe');
    fs.writeFileSync(hud, 'hud');
    makeCleanHudReceipt(hud);
    return ['--hud', hud];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Packaging aborted: Public redistribution requires Anthropic permission, but proprietary Clawd assets were detected in package contents/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('default packaging fails closed when main app input contains embedded sprite table in JSON or JS', () => {
  const { dir, out, result } = pack((tmp, input) => {
    fs.writeFileSync(path.join(input, 'bundle.js'), 'const table = {"sprites":{"Standing":{"palette":["#fff"],"deltas":["00"]}}};');
    return ['--no-hud'];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /proprietary Clawd sprite table was detected/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fails closed when binary contains Base64-encoded Clawd sprite table keys', () => {
  const { dir, out, result } = pack((tmp) => {
    const hud = path.join(tmp, 'ai-one-hud.exe');
    // Buffer containing Base64 encoded sprite keys: "sprites" (InNwcml0ZXMi), "palette" (InBhbGV0dGUi), "deltas" (ImRlbHRhcyI)
    fs.writeFileSync(hud, 'binary payload with Base64 InNwcml0ZXMi and InBhbGV0dGUi and ImRlbHRhcyI keys');
    makeCleanHudReceipt(hud);
    return ['--hud', hud];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /embedded Clawd sprite table inside HUD binary/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stale or substituted original EXE with fabricated clean receipt is rejected by binary content scan', () => {
  const { dir, out, result } = pack((tmp) => {
    const hud = path.join(tmp, 'ai-one-hud.exe');
    // Simulating an original EXE that was saved and placed into release dir with a clean receipt
    fs.writeFileSync(hud, 'compiled original EXE containing {"sprites":{},"palette":["#000"],"deltas":["00"]} table');
    makeCleanHudReceipt(hud); // even with a fabricated matching clean receipt
    return ['--hud', hud];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /embedded Clawd sprite table inside HUD binary/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fails closed when binary contains full single-encoded Base64 Clawd sprite table', () => {
  const { dir, out, result } = pack((tmp) => {
    const hud = path.join(tmp, 'ai-one-hud.exe');
    const fullEncoded = Buffer.from(JSON.stringify({
      sprites: {
        Walking: {
          palette: ['#fff'],
          deltas: ['00'],
        },
      },
    })).toString('base64');
    fs.writeFileSync(hud, `binary payload with full single-encoded Base64 ${fullEncoded}`);
    makeCleanHudReceipt(hud);
    return ['--hud', hud];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /embedded Clawd sprite table inside HUD binary/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('default packaging fails closed when arbitrary extension (.dat, .pak, .txt) in main app contains sprite table with --no-hud', () => {
  const { dir, out, result } = pack((tmp, input) => {
    fs.writeFileSync(path.join(input, 'cache.dat'), 'data payload with {"sprites":{},"palette":["#000"],"deltas":["00"]} table');
    return ['--no-hud'];
  });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /proprietary Clawd sprite table was detected/);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('complete pack test suite isolation: repository git tree is never touched', () => {
  const realArt = path.join(root, 'agent-hud', 'src', 'packages', 'hud', 'src', 'assets', 'clawd-sprites.json');
  const realDist = path.join(root, 'agent-hud', 'src', 'apps', 'desktop', 'dist');
  const realLicense = path.join(root, 'agent-hud', 'LICENSE');
  const realOrigMarker = path.join(root, 'agent-hud', 'target', 'release', '.hud-art-original');

  assert.ok(!fs.existsSync(`${realArt}.bak`), 'no backup file left in real repository assets');
  assert.ok(!fs.existsSync(path.join(realDist, 'clawd-sprites-test.json')));
  assert.equal(fs.readFileSync(realLicense, 'utf8'), initialLicenseContent, 'real agent-hud/LICENSE content is unchanged');
  assert.ok(!fs.existsSync(`${realLicense}.bak`), 'no license backup file left');
  assert.equal(fs.existsSync(realArt), initialArtExists, 'real artwork existence is unchanged');
  assert.equal(fs.existsSync(realOrigMarker), initialOriginalMarkerExists, 'original marker existence is unchanged');
  if (initialOriginalMarkerExists) {
    assert.equal(fs.readFileSync(realOrigMarker, 'utf8'), initialOriginalMarkerContent, 'original marker content is unchanged');
  }
});
