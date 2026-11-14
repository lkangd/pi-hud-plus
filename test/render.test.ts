import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { renderHud } from "../src/render/index.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { HudSnapshot } from "../src/types.ts";

const snapshot: HudSnapshot = {
  model: { name: "Claude Opus 4.6" },
  cwd: "/home/me/code/my-project",
};

const render = (s: HudSnapshot, width = 80) => renderHud(s, DEFAULT_CONFIG, width).map(strip);

test("renders the model badge and project on one Line", () => {
  assert.deepEqual(render(snapshot), ["[Claude Opus 4.6] │ my-project"]);
});

test("omits the model badge when there is no model", () => {
  assert.deepEqual(render({ ...snapshot, model: null }), ["my-project"]);
});

test("truncates each Line to the width", () => {
  assert.deepEqual(render(snapshot, 12), ["[Claude Opu…"]);
});

test("returns no Lines for a non-positive width", () => {
  assert.deepEqual(render(snapshot, 0), []);
  assert.deepEqual(render(snapshot, -5), []);
});

test("colours the model with the configured override", () => {
  const [line] = renderHud(snapshot, { ...DEFAULT_CONFIG, colors: { model: "#ff0000" } }, 80);
  assert.ok(line.startsWith("\x1b[38;2;255;0;0m[Claude Opus 4.6]"), JSON.stringify(line));
});
