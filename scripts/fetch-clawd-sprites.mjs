// Fetches the original Clawd sprite table from upstream on demand for local HUD builds.
// Avoids committing proprietary third-party artwork to the repository while honoring
// user acceptance feedback (#168 "以原版图像为准").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_TARGET = path.resolve(root, 'agent-hud', 'src', 'packages', 'hud', 'src', 'assets', 'clawd-sprites.json');
export const UPSTREAM_URL = 'https://raw.githubusercontent.com/jazzenchen/agent-hud-open/5c1f93e9457cb0f5fd3d69042144ffa63e51851b/src/packages/hud/src/assets/clawd-sprites.json';

export const REQUIRED_FRAME_COUNTS = {
  DancingHappy: 40,
  Desktop: 88,
  Dizzy: 41,
  Excited: 23,
  Facepalm: 35,
  JumpingHappy: 21,
  Laptop: 43,
  Lightbulb: 50,
  LookingAround: 31,
  LookingAroundEyesOnly: 42,
  Meditating: 60,
  Pointing: 43,
  Spark: 73,
  Swaying: 49,
  Thinking: 38,
  Turning: 29,
  Walking: 28,
  Waving: 17,
};

export const REQUIRED_SPRITES = Object.keys(REQUIRED_FRAME_COUNTS);

export function validateClawdSprites(rawContent) {
  let parsed;
  try {
    parsed = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
  } catch (err) {
    throw new Error(`Invalid JSON syntax: ${err.message}`, { cause: err });
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Root must be an object');
  }
  if (!parsed.sprites || typeof parsed.sprites !== 'object') {
    throw new Error('Missing or invalid "sprites" property');
  }
  for (const [name, expectedCount] of Object.entries(REQUIRED_FRAME_COUNTS)) {
    const sprite = parsed.sprites[name];
    if (!sprite || typeof sprite !== 'object') {
      throw new Error(`Missing required action sprite: "${name}"`);
    }
    if (!Number.isInteger(sprite.w) || !Number.isInteger(sprite.h) || sprite.w <= 0 || sprite.h <= 0) {
      throw new Error(`Invalid dimensions for sprite: "${name}"`);
    }
    if (!Array.isArray(sprite.palette) || sprite.palette.length === 0) {
      throw new Error(`Invalid palette for sprite: "${name}"`);
    }
    for (const color of sprite.palette) {
      if (typeof color !== 'string' || !/^#[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/i.test(color)) {
        throw new Error(`Invalid palette color "${color}" in sprite: "${name}"`);
      }
    }
    if (typeof sprite.base !== 'string' || sprite.base.length !== sprite.w * sprite.h) {
      throw new Error(`Invalid base frame length for sprite: "${name}"`);
    }
    for (let i = 0; i < sprite.base.length; i += 1) {
      const ch = sprite.base[i];
      if (ch !== '.') {
        const idx = parseInt(ch, 36);
        if (Number.isNaN(idx) || idx >= sprite.palette.length) {
          throw new Error(`Invalid base palette index "${ch}" in sprite: "${name}"`);
        }
      }
    }
    if (!Array.isArray(sprite.deltas)) {
      throw new Error(`Missing deltas array for sprite: "${name}"`);
    }
    const frameCount = 1 + sprite.deltas.length;
    if (frameCount !== expectedCount) {
      throw new Error(`Invalid frame count for sprite "${name}": expected ${expectedCount}, got ${frameCount}`);
    }
    for (const delta of sprite.deltas) {
      if (typeof delta !== 'string') {
        throw new Error(`Invalid delta entry in sprite: "${name}"`);
      }
      for (const change of delta.split(',')) {
        if (change.length >= 2) {
          const pixel = parseInt(change.slice(0, -1), 36);
          const colorChar = change.slice(-1);
          const colorIdx = colorChar === '.' ? 255 : parseInt(colorChar, 36);
          if (!Number.isInteger(pixel) || pixel < 0 || pixel >= sprite.w * sprite.h) {
            throw new Error(`Delta pixel offset out of range in sprite: "${name}"`);
          }
          if (colorIdx !== 255 && (Number.isNaN(colorIdx) || colorIdx >= sprite.palette.length)) {
            throw new Error(`Delta palette index "${colorChar}" out of range in sprite: "${name}"`);
          }
        }
      }
    }
  }
  return parsed;
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const isClean = process.argv.includes('--clean');
  const strict = process.argv.includes('--strict') || process.env.CLAWD_SPRITES_STRICT === '1';
  const target = process.env.CLAWD_SPRITES_DEST ? path.resolve(process.env.CLAWD_SPRITES_DEST) : DEFAULT_TARGET;

  if (isClean) {
    let cleaned = 0;
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      cleaned += 1;
    }
    // Also clean bundled sprite JSON in desktop dist/assets if present
    const distAssets = path.resolve(root, 'agent-hud', 'src', 'apps', 'desktop', 'dist', 'assets');
    if (fs.existsSync(distAssets)) {
      for (const file of fs.readdirSync(distAssets)) {
        if (/^clawd-sprites.*\.json$/i.test(file)) {
          fs.unlinkSync(path.join(distAssets, file));
          cleaned += 1;
        }
      }
    }
    // Also clean any existing HUD release binary to prevent stale packaging
    const hudExe = path.resolve(root, 'agent-hud', 'target', 'release', 'ai-one-hud.exe');
    if (fs.existsSync(hudExe)) {
      fs.unlinkSync(hudExe);
      cleaned += 1;
    }
    console.log(`[fetch-clawd-sprites] Cleaned ${cleaned} proprietary asset(s) and build artifact(s).`);
    process.exit(0);
  }

  // Check if already present and valid
  if (fs.existsSync(target)) {
    try {
      const existing = fs.readFileSync(target, 'utf8');
      validateClawdSprites(existing);
      console.log('[fetch-clawd-sprites] Valid clawd-sprites.json already present.');
      process.exit(0);
    } catch (err) {
      const msg = `Existing clawd-sprites.json is invalid: ${err.message}`;
      if (strict) {
        console.error(`[fetch-clawd-sprites] Error (strict mode): ${msg}`);
        process.exit(1);
      }
      console.warn(`[fetch-clawd-sprites] Warning: ${msg}. Attempting re-download.`);
    }
  }

  console.log('[fetch-clawd-sprites] Downloading original Clawd sprite table from upstream commit 5c1f93e...');
  try {
    const response = await fetch(UPSTREAM_URL);
    if (!response.ok) {
      const message = `Upstream responded with status ${response.status}.`;
      if (strict) {
        console.error(`[fetch-clawd-sprites] Error (strict mode): ${message}`);
        process.exit(1);
      }
      console.warn(`[fetch-clawd-sprites] Warning: ${message} Continuing without original sprites (HUD will fall back to procedural bot).`);
      process.exit(0);
    }
    const text = await response.text();
    validateClawdSprites(text);

    // Atomic write via temp file
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, target);
    console.log('[fetch-clawd-sprites] Successfully downloaded, validated and saved clawd-sprites.json.');
  } catch (error) {
    if (strict) {
      console.error(`[fetch-clawd-sprites] Error (strict mode): Could not fetch or validate clawd-sprites.json (${error.message}).`);
      process.exit(1);
    }
    console.warn(`[fetch-clawd-sprites] Note: Could not fetch clawd-sprites.json (${error.message}). Continuing with procedural fallback.`);
  }
}
