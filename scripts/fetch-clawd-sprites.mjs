// Fetches the original Clawd sprite table from upstream on demand for local HUD builds.
// Avoids committing proprietary third-party artwork to the repository while honoring
// user acceptance feedback (#168 "以原版图像为准").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(root, 'agent-hud', 'src', 'packages', 'hud', 'src', 'assets', 'clawd-sprites.json');
const UPSTREAM_URL = 'https://raw.githubusercontent.com/jazzenchen/agent-hud-open/5c1f93e9457cb0f5fd3d69042144ffa63e51851b/src/packages/hud/src/assets/clawd-sprites.json';

const strict = process.argv.includes('--strict') || process.env.CLAWD_SPRITES_STRICT === '1';

if (fs.existsSync(target)) {
  console.log('[fetch-clawd-sprites] clawd-sprites.json already present.');
  process.exit(0);
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
  // Basic validation that it is JSON and has the expected shape
  const parsed = JSON.parse(text);
  if (!parsed.sprites || typeof parsed.sprites !== 'object') {
    throw new Error('Invalid sprite table downloaded');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, 'utf8');
  console.log('[fetch-clawd-sprites] Successfully downloaded and saved clawd-sprites.json.');
} catch (error) {
  if (strict) {
    console.error(`[fetch-clawd-sprites] Error (strict mode): Could not fetch clawd-sprites.json (${error.message}).`);
    process.exit(1);
  }
  console.warn(`[fetch-clawd-sprites] Note: Could not fetch clawd-sprites.json (${error.message}). Continuing with procedural fallback.`);
}
