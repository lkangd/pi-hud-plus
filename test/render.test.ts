import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { renderHud } from "../src/render/index.ts";
import { DEFAULT_CONFIG, type HudConfig } from "../src/config.ts";
import type { HudSnapshot } from "../src/types.ts";

const snapshot: HudSnapshot = {
  model: { name: "Claude Opus 4.6" },
  cwd: "/home/me/code/my-project",
  context: { percent: 23 },
  tools: [],
};
const withTools: HudSnapshot = { ...snapshot, tools: [{ name: "Read", status: "completed" }] };

type ConfigPatch = Partial<Omit<HudConfig, "display" | "colors">> & {
  display?: Partial<HudConfig["display"]>;
  colors?: Partial<HudConfig["colors"]>;
};
const cfg = (patch: ConfigPatch = {}): HudConfig => ({
  ...DEFAULT_CONFIG,
  ...patch,
  display: { ...DEFAULT_CONFIG.display, ...patch.display },
  colors: { ...DEFAULT_CONFIG.colors, ...patch.colors },
});
const render = (s: HudSnapshot = snapshot, patch: ConfigPatch = {}, width = 80) =>
  renderHud(s, cfg(patch), width).map(strip);

const PROJECT = "[Claude Opus 4.6] │ my-project";
const CONTEXT = "Context █░░░░░ 23%";

test("expanded layout puts the project and context Elements on their own Lines", () => {
  assert.deepEqual(render(), [PROJECT, CONTEXT]);
});

test("the context bar adapts its width to the HUD width", () => {
  assert.deepEqual(render(snapshot, {}, 120)[1], "Context ██░░░░░░░░ 23%");
  assert.deepEqual(render(snapshot, {}, 50)[1], "Context █░░░ 23%");
});

test("omits the model badge when there is no model, and the context Line when there is no context", () => {
  assert.deepEqual(render({ ...snapshot, model: null, context: null }), ["my-project"]);
});

test("pathLevels keeps that many trailing path segments", () => {
  assert.deepEqual(render(snapshot, { pathLevels: 2 })[0], "[Claude Opus 4.6] │ code/my-project");
});

test("elementOrder sets the order of Lines and drops Elements it omits", () => {
  assert.deepEqual(render(snapshot, { elementOrder: ["context", "project"] }), [CONTEXT, PROJECT]);
  assert.deepEqual(render(snapshot, { elementOrder: ["context"] }), [CONTEXT]);
});

test("a merge group joins adjacent Elements on one Line", () => {
  assert.deepEqual(render(snapshot, { display: { mergeGroups: [["project", "context"]] } }), [`${PROJECT} │ ${CONTEXT}`]);
});

test("a merge group does not join Elements that aren't adjacent in elementOrder", () => {
  const lines = render(withTools, {
    elementOrder: ["project", "tools", "context"],
    display: { showTools: true, mergeGroups: [["project", "context"]] },
  });
  assert.deepEqual(lines, [PROJECT, "✓ Read ×1", CONTEXT]);
});

test("a merged Line too wide for the HUD stacks its Elements instead", () => {
  assert.deepEqual(render(snapshot, { display: { mergeGroups: [["project", "context"]] } }, 40), [PROJECT, "Context █░░░ 23%"]);
});

test("a merge group with only one visible Element renders it alone", () => {
  assert.deepEqual(render({ ...snapshot, context: null }, { display: { mergeGroups: [["project", "context"]] } }), [PROJECT]);
});

test("the tools Line renders only with showTools", () => {
  assert.deepEqual(render(withTools), [PROJECT, CONTEXT]);
  assert.deepEqual(render(withTools, { display: { showTools: true } }), [PROJECT, CONTEXT, "✓ Read ×1"]);
});

test("showSeparators puts a rule, as wide as the widest Line above, before the first activity Line", () => {
  const lines = render(withTools, { showSeparators: true, display: { showTools: true } });
  assert.deepEqual(lines, [PROJECT, CONTEXT, "─".repeat(PROJECT.length), "✓ Read ×1"]);
});

test("the separator is at least 20 wide and never wider than the HUD", () => {
  const narrow = { ...withTools, model: null, context: null };
  assert.deepEqual(render(narrow, { showSeparators: true, display: { showTools: true } }), ["my-project", "─".repeat(20), "✓ Read ×1"]);
  assert.equal(render(withTools, { showSeparators: true, display: { showTools: true } }, 25)[2], "─".repeat(25));
});

test("no separator without activity, or when activity comes first", () => {
  assert.deepEqual(render(snapshot, { showSeparators: true, display: { showTools: true } }), [PROJECT, CONTEXT]);
  const lines = render(withTools, { showSeparators: true, elementOrder: ["tools", "project"], display: { showTools: true } });
  assert.deepEqual(lines, ["✓ Read ×1", PROJECT]);
});

test("compact layout puts everything on one session Line, with activity Lines below", () => {
  assert.deepEqual(render(snapshot, { lineLayout: "compact" }), ["[Claude Opus 4.6] █░░░░░ 23% | my-project"]);
  const lines = render(withTools, { lineLayout: "compact", showSeparators: true, elementOrder: ["project"], display: { showTools: true } });
  assert.deepEqual(lines, ["[Claude Opus 4.6] █░░░░░ 23% | my-project", "─".repeat(41), "✓ Read ×1"]);
});

test("compact layout drops the badge or bar when they are hidden", () => {
  assert.deepEqual(render(snapshot, { lineLayout: "compact", display: { showModel: false } }), ["█░░░░░ 23% | my-project"]);
  assert.deepEqual(render(snapshot, { lineLayout: "compact", display: { showContextBar: false } }), ["[Claude Opus 4.6] 23% | my-project"]);
});

test("the Custom line goes last by default and first with customLinePosition first", () => {
  assert.deepEqual(render(snapshot, { display: { customLine: "ship it" } })[0], `${PROJECT} │ ship it`);
  assert.deepEqual(render(snapshot, { display: { customLine: "ship it", customLinePosition: "first" } })[0], `ship it │ ${PROJECT}`);
  assert.deepEqual(render(snapshot, { lineLayout: "compact", display: { customLine: "ship it" } }), [
    "[Claude Opus 4.6] █░░░░░ 23% | my-project | ship it",
  ]);
  assert.deepEqual(render(snapshot, { lineLayout: "compact", display: { customLine: "ship it", customLinePosition: "first" } }), [
    "ship it | [Claude Opus 4.6] █░░░░░ 23% | my-project",
  ]);
});

test("the Custom line renders even when model and project are hidden", () => {
  const lines = render(snapshot, { display: { showModel: false, showProject: false, customLine: "hi" } });
  assert.deepEqual(lines, ["hi", CONTEXT]);
});

test("display.showModel and display.showProject hide their parts", () => {
  assert.deepEqual(render(snapshot, { display: { showModel: false } }), ["my-project", CONTEXT]);
  assert.deepEqual(render(snapshot, { display: { showProject: false } }), ["[Claude Opus 4.6]", CONTEXT]);
  assert.deepEqual(render(snapshot, { display: { showModel: false, showProject: false } }), [CONTEXT]);
});

test("colour overrides accept named presets, 256-colour indices and hex", () => {
  const [line] = renderHud(snapshot, cfg({ colors: { model: "#ff0000", project: "brightBlue", custom: 33 }, display: { customLine: "x" } }), 80);
  assert.ok(line.startsWith("\x1b[38;2;255;0;0m[Claude Opus 4.6]"), JSON.stringify(line));
  assert.ok(line.includes("\x1b[94mmy-project"), JSON.stringify(line));
  assert.ok(line.includes("\x1b[38;5;33mx"), JSON.stringify(line));
});

test("the Custom line defaults to claude-hud's orange", () => {
  const [line] = renderHud(snapshot, cfg({ display: { customLine: "x" } }), 80);
  assert.ok(line.includes("\x1b[38;5;208mx"), JSON.stringify(line));
});

test("barFilled and barEmpty change the context bar's characters", () => {
  assert.deepEqual(render(snapshot, { colors: { barFilled: "#", barEmpty: "-" } })[1], "Context #----- 23%");
});

test("every Line is truncated to the width with …", () => {
  assert.deepEqual(render(snapshot, {}, 12), ["[Claude Opu…", "Context █░░…"]);
  const compact = render(withTools, { lineLayout: "compact", showSeparators: true, display: { showTools: true } }, 12);
  assert.deepEqual(compact, ["[Claude Opu…", "─".repeat(12), "✓ Read ×1"]);
});

test("returns no Lines for a non-positive width", () => {
  assert.deepEqual(render(snapshot, {}, 0), []);
  assert.deepEqual(render(snapshot, {}, -5), []);
});

test("the Custom line can't inject escape codes", () => {
  const [line] = renderHud(snapshot, cfg({ display: { customLine: "a\x1b]52;c;evil\x07b" } }), 80);
  assert.ok(!line.includes("\x1b]52"), JSON.stringify(line));
  assert.ok(strip(line).endsWith("│ a]52;c;evilb"), JSON.stringify(strip(line)));
});
