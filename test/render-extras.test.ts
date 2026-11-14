// The Extra command's label and the Extension-status Line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { renderHud } from "../src/render/index.ts";
import { DEFAULT_CONFIG, type HudConfig } from "../src/config.ts";
import type { HudSnapshot } from "../src/types.ts";

const snapshot: HudSnapshot = {
  model: { name: "Claude Opus 4.6" },
  cwd: "/home/me/code/my-project",
  context: null,
  tools: [],
  version: "1.5.2",
  speed: 42,
};

const render = (s: Partial<HudSnapshot>, config: Partial<HudConfig> = {}, display: Partial<HudConfig["display"]> = {}) =>
  renderHud({ ...snapshot, ...s }, { ...DEFAULT_CONFIG, ...config, display: { ...DEFAULT_CONFIG.display, ...display } }, 120);

const on = { showVersion: true, showSpeed: true, customLine: "ship it" };

test("the Extra command's label goes after the version on the project Line", () => {
  assert.equal(strip(render({ extraLabel: "k8s:prod" }, {}, on)[0]!), "[Claude Opus 4.6] │ my-project │ pi v1.5.2 │ k8s:prod │ out: 42.0 tok/s │ ship it");
  assert.equal(strip(render({ extraLabel: null }, {}, on)[0]!), "[Claude Opus 4.6] │ my-project │ pi v1.5.2 │ out: 42.0 tok/s │ ship it");
});

test("the Extra command's label goes after speed on the compact Line", () => {
  assert.equal(strip(render({ extraLabel: "k8s:prod" }, { lineLayout: "compact" }, on)[0]!), "[Claude Opus 4.6] | my-project | pi v1.5.2 | out: 42.0 tok/s | k8s:prod | ship it");
});

const statuses = new Map([
  ["zeta", "z-status"],
  ["alpha", "a\tstatus\n two"],
]);

test("Extension statuses render as one dimmed Line, sorted by key, always last", () => {
  for (const config of [{}, { lineLayout: "compact" as const }]) {
    const lines = render({ extensionStatuses: statuses, tools: [{ name: "Read", status: "completed" }] }, { ...config, showSeparators: true }, { showTools: true, customLine: "ship it" });
    assert.equal(lines.at(-1), "\x1b[2ma status two z-status\x1b[0m", JSON.stringify(config));
    assert.equal(strip(lines.at(-2)!), "✓ Read ×1");
  }
});

test("the Extension-status Line is hidden when there are none or showExtensionStatuses is false", () => {
  const without = render({}).map(strip);
  assert.deepEqual(render({ extensionStatuses: new Map() }).map(strip), without);
  assert.deepEqual(render({ extensionStatuses: new Map([["x", " \n "]]) }).map(strip), without);
  assert.deepEqual(render({ extensionStatuses: statuses }, {}, { showExtensionStatuses: false }).map(strip), without);
});

test("the Extension-status Line is truncated to the width", () => {
  const lines = renderHud({ ...snapshot, extensionStatuses: new Map([["a", "x".repeat(50)]]) }, DEFAULT_CONFIG, 20);
  assert.equal(strip(lines.at(-1)!), "x".repeat(19) + "…");
});
