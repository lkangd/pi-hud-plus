// Ported from claude-hud tests/render.test.js (renderEnvironmentLine and the compact config counts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { renderHud } from "../src/render/index.ts";
import { DEFAULT_CONFIG, type HudConfig } from "../src/config.ts";
import type { HudSnapshot } from "../src/types.ts";

const base: HudSnapshot = { model: null, cwd: "/tmp/my-project", context: null, tools: [] };
const counts = { contextFiles: 2, skills: 5, prompts: 1, mcps: 3 };

function lines(
  environment: HudSnapshot["environment"],
  display: Partial<HudConfig["display"]> = {},
  lineLayout: HudConfig["lineLayout"] = "expanded",
) {
  const config: HudConfig = {
    ...DEFAULT_CONFIG,
    lineLayout,
    display: { ...DEFAULT_CONFIG.display, showConfigCounts: true, ...display },
  };
  return renderHud({ ...base, environment }, config, 200).map(strip);
}

test("the Environment line shows each non-zero count", () => {
  assert.deepEqual(lines(counts), ["my-project", "2 AGENTS.md | 5 skills | 1 prompts | 3 MCPs"]);
  assert.deepEqual(lines({ ...counts, skills: 0, prompts: 0 }), ["my-project", "2 AGENTS.md | 3 MCPs"]);
});

test("no Environment line when showConfigCounts is off, counts are all zero or not read yet", () => {
  assert.deepEqual(lines(counts, { showConfigCounts: false }), ["my-project"]);
  assert.deepEqual(lines({ contextFiles: 0, skills: 0, prompts: 0, mcps: 0 }), ["my-project"]);
  assert.deepEqual(lines(undefined), ["my-project"]);
});

test("environmentThreshold hides the line until the total count reaches it", () => {
  assert.deepEqual(lines(counts, { environmentThreshold: 12 }), ["my-project"]);
  assert.deepEqual(lines(counts, { environmentThreshold: 11 }), ["my-project", "2 AGENTS.md | 5 skills | 1 prompts | 3 MCPs"]);
});

test("compact layout puts the counts inline after the project", () => {
  assert.deepEqual(lines(counts, {}, "compact"), ["my-project | 2 AGENTS.md | 5 skills | 1 prompts | 3 MCPs"]);
  assert.deepEqual(lines(counts, { environmentThreshold: 12 }, "compact"), ["my-project"]);
});
