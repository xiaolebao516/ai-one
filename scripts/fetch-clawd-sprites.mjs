// Fetches the original Clawd sprite table from upstream on demand for local HUD builds.
// Avoids committing proprietary third-party artwork to the repository while honoring
// user acceptance feedback (#168 "以原版图像为准").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_TARGET = path.resolve(root, 'agent-hud', 'src', 'packages', 'hud', 'src', 'assets', 'clawd-sprites.json');
export const UPSTREAM_URL = 'https://raw.githubusercontent.com/jazzenchen/agent-hud-open/5c1f93e9457cb0f5fd3d69042144ffa63e51851b/src/packages/hud/src/assets/clawd-sprites.json';

export const REQUIRED_SPRITES = [
  'DancingHappy', 'Desktop', 'Dizzy', 'Excited', 'Facepalm',
  'JumpingHappy', 'Laptop', 'Lightbulb', 'LookingAround', 'LookingAroundEyesOnly',
  'Meditating', 'Pointing', 'Spark', 'Swaying', 'Thinking',
  'Turning', 'Walking', 'Waving'
];

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
  for (const name of REQUIRED_SPRITES) {
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
    if (typeof sprite.base !== 'string' || sprite.base.length !== sprite.w * sprite.h) {
      throw new Error(`Invalid base frame length for sprite: "${name}"`);
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
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      console.log('[fetch-clawd-sprites] Removed clawd-sprites.json for clean build.');
    } else {
      console.log('[fetch-clawd-sprites] Already clean (clawd-sprites.json not present).');
    }
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
