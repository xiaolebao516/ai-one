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
    if (sprite.w * sprite.h > 65536) {
      throw new Error(`Sprite dimensions exceed 65536 pixel limit for sprite: "${name}"`);
    }
    if (!Array.isArray(sprite.palette) || sprite.palette.length === 0 || sprite.palette.length > 36) {
      throw new Error(`Invalid palette length (must be 1..36) for sprite: "${name}"`);
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
      if (ch === '.') continue;
      if (!/^[0-9a-z]$/i.test(ch)) {
        throw new Error(`Invalid base character "${ch}" in sprite: "${name}"`);
      }
      const idx = parseInt(ch, 36);
      if (Number.isNaN(idx) || idx >= sprite.palette.length) {
        throw new Error(`Invalid base palette index "${ch}" in sprite: "${name}"`);
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
          const pixelText = change.slice(0, -1);
          const colorChar = change.slice(-1);
          if (!/^[0-9a-z]+$/i.test(pixelText)) {
            throw new Error(`Invalid delta pixel offset syntax "${pixelText}" in sprite: "${name}"`);
          }
          if (!/^[0-9a-z.]$/i.test(colorChar)) {
            throw new Error(`Invalid delta color character "${colorChar}" in sprite: "${name}"`);
          }
          const pixel = parseInt(pixelText, 36);
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
  const releaseDir = path.resolve(root, 'agent-hud', 'target', 'release');

  if (isClean) {
    let cleaned = 0;
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      cleaned += 1;
    }
    // Also remove bundled sprite JSON in desktop dist/
    const distDir = path.resolve(root, 'agent-hud', 'src', 'apps', 'desktop', 'dist');
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true });
      cleaned += 1;
    }
    // Also remove built HUD release binary so stale builds cannot be packaged
    const hudExe = path.join(releaseDir, 'ai-one-hud.exe');
    if (fs.existsSync(hudExe)) {
      fs.unlinkSync(hudExe);
      cleaned += 1;
    }
    // Touch clean provenance marker and remove original marker
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(path.join(releaseDir, '.hud-art-clean'), `${Date.now()}`, 'utf8');
    const origMarker = path.join(releaseDir, '.hud-art-original');
    if (fs.existsSync(origMarker)) fs.unlinkSync(origMarker);

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

    // Record provenance marker
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(path.join(releaseDir, '.hud-art-original'), `${Date.now()}`, 'utf8');
    const cleanMarker = path.join(releaseDir, '.hud-art-clean');
    if (fs.existsSync(cleanMarker)) fs.unlinkSync(cleanMarker);

    console.log('[fetch-clawd-sprites] Successfully downloaded, validated and saved clawd-sprites.json.');
  } catch (error) {
    if (strict) {
      console.error(`[fetch-clawd-sprites] Error (strict mode): Could not fetch or validate clawd-sprites.json (${error.message}).`);
      process.exit(1);
    }
    console.warn(`[fetch-clawd-sprites] Note: Could not fetch clawd-sprites.json (${error.message}). Continuing with procedural fallback.`);
  }
}
