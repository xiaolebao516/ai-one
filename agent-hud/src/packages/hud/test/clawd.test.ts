import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeClawdTable,
  drawsClawdSprites,
  isClawdStanding,
} from "../src/bots/clawd.ts";
import { standing } from "../src/bots/clawd-clips.ts";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.resolve(dirname, "../src/assets/clawd-sprites.json");

test("drawsClawdSprites thresholds handle procedural fallback boundary correctly", () => {
  // Small icons (< 2 device pixel grain threshold) fall back to procedural marks
  assert.equal(drawsClawdSprites(10, 1), false);
  assert.equal(drawsClawdSprites(12, 1), false);
  // Standard HUD bot mark sizes render original sprites
  assert.equal(drawsClawdSprites(32, 1), true);
  assert.equal(drawsClawdSprites(24, 2), true);
});

test("decodeClawdTable validates clip completeness and rejects malformed payloads", () => {
  // Incomplete sheet missing required clips throws
  const incomplete = {
    sprites: {
      Standing: {
        w: 1,
        h: 1,
        palette: ["#ff0000"],
        base: "0",
        deltas: [],
      },
    },
  };
  assert.throws(
    () => decodeClawdTable(incomplete as any),
    /Clawd clips do not fit/,
  );

  // Invalid palette index out of range throws
  const invalidIndex = {
    sprites: {
      Standing: {
        w: 1,
        h: 1,
        palette: ["#ff0000"],
        base: "5", // 5 >= palette.length (1)
        deltas: [],
      },
    },
  };
  assert.throws(
    () => decodeClawdTable(invalidIndex as any),
    /Invalid Clawd palette index/,
  );

  // Invalid color format throws
  const invalidColor = {
    sprites: {
      Standing: {
        w: 1,
        h: 1,
        palette: ["not-a-color"],
        base: "0",
        deltas: [],
      },
    },
  };
  assert.throws(
    () => decodeClawdTable(invalidColor as any),
    /Invalid Clawd palette color/,
  );
});

test("clawd-sprites.json decodes into valid ClawdSheet matching clips when present", () => {
  const exists = fs.existsSync(jsonPath);
  if (process.env.CLAWD_SPRITES_REQUIRED === "1") {
    assert.ok(
      exists,
      "clawd-sprites.json must exist when CLAWD_SPRITES_REQUIRED=1",
    );
  }
  if (!exists) {
    // clawd-sprites.json is not committed to the repo to respect Anthropic copyright;
    // it is fetched on demand via scripts/fetch-clawd-sprites.mjs for local builds.
    return;
  }
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(raw.claude, "2.37337.1");
  const sheet = decodeClawdTable(raw);
  assert.equal(Object.keys(sheet).length, 18);
  const expectedActions = [
    "DancingHappy", "Desktop", "Dizzy", "Excited", "Facepalm",
    "JumpingHappy", "Laptop", "Lightbulb", "LookingAround", "LookingAroundEyesOnly",
    "Meditating", "Pointing", "Spark", "Swaying", "Thinking",
    "Turning", "Walking", "Waving"
  ];
  for (const action of expectedActions) {
    assert.ok(sheet[action], `${action} sprite exists`);
    assert.ok(sheet[action].frames.length > 0, `${action} has frames`);
  }

  assert.equal(isClawdStanding(sheet, standing), true);
});
