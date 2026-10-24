import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeClawdTable, isClawdStanding } from "../src/bots/clawd.ts";
import { standing } from "../src/bots/clawd-clips.ts";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.resolve(dirname, "../src/assets/clawd-sprites.json");

test("clawd-sprites.json decodes into valid ClawdSheet matching clips when present", () => {
  if (!fs.existsSync(jsonPath)) {
    // clawd-sprites.json is not committed to the repo to respect Anthropic copyright;
    // it is fetched on demand via scripts/fetch-clawd-sprites.mjs for local builds.
    return;
  }
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(raw.claude, "2.37337.1");
  const sheet = decodeClawdTable(raw);
  assert.equal(Object.keys(sheet).length, 18);
  assert.ok(sheet.DancingHappy, "DancingHappy sprite exists");
  assert.ok(sheet.Desktop, "Desktop sprite exists");
  assert.ok(sheet.Excited, "Excited sprite exists");
  assert.ok(sheet.Facepalm, "Facepalm sprite exists");
  assert.ok(sheet.JumpingHappy, "JumpingHappy sprite exists");
  assert.ok(sheet.Laptop, "Laptop sprite exists");

  assert.equal(isClawdStanding(sheet, standing), true);
});
