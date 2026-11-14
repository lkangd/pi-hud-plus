// Ported from claude-hud's tests/prompt-cache.test.js and the memory/prompt-cache cases in tests/render.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { renderHud } from "../src/render/index.ts";
import { formatPromptCacheCountdown } from "../src/render/lines/prompt-cache.ts";
import { DEFAULT_CONFIG, type HudConfig } from "../src/config.ts";
import type { HudSnapshot } from "../src/types.ts";

const NOW = Date.UTC(2024, 0, 1, 0, 5, 0);
const GB = 1024 ** 3;

const snapshot: HudSnapshot = {
  model: { name: "Opus" },
  cwd: "/tmp/my-project",
  context: null,
  tools: [],
  now: NOW,
  session: { lastReplyAt: NOW - 45_000, totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, subscription: false },
  memory: { totalBytes: 16 * GB, usedBytes: 10 * GB, freeBytes: 6 * GB, usedPercent: 63 },
};

type Display = Partial<HudConfig["display"]>;
const render = (display: Display, s: HudSnapshot = snapshot, patch: Partial<HudConfig> = {}) =>
  renderHud(s, { ...DEFAULT_CONFIG, ...patch, display: { ...DEFAULT_CONFIG.display, showModel: false, showProject: false, ...display } }, 200);
const lastReply = (agoMs: number): HudSnapshot => ({ ...snapshot, session: { ...snapshot.session!, lastReplyAt: NOW - agoMs } });

test("formatPromptCacheCountdown formats minutes and seconds", () => {
  assert.equal(formatPromptCacheCountdown(272_000), "4m 32s");
});

test("formatPromptCacheCountdown formats hours when needed", () => {
  assert.equal(formatPromptCacheCountdown(3_632_000), "1h 0m 32s");
});

test("formatPromptCacheCountdown returns expired when countdown has elapsed", () => {
  assert.equal(formatPromptCacheCountdown(0), "expired");
  assert.equal(formatPromptCacheCountdown(-1000), "expired");
});

test("the prompt cache Element counts down from the last reply with promptCacheTtlSeconds", () => {
  assert.deepEqual(render({ showPromptCache: true }).map(strip), ["Cache ⏱ 4m 15s"]);
  assert.deepEqual(render({ showPromptCache: true, promptCacheTtlSeconds: 3600 }).map(strip), ["Cache ⏱ 59m 15s"]);
});

test("the prompt cache shows warning and expired states", () => {
  assert.deepEqual(render({ showPromptCache: true }, lastReply(280_000)).map(strip), ["Cache ⏱ 0m 20s"]);
  assert.deepEqual(render({ showPromptCache: true }, lastReply(301_000)).map(strip), ["Cache ⏱ expired"]);
  // Warning is yellow, expired is the dim label colour.
  assert.ok(render({ showPromptCache: true }, lastReply(280_000))[0].includes("\x1b[33m⏱ 0m 20s"));
  assert.ok(render({ showPromptCache: true }, lastReply(301_000))[0].includes("\x1b[2m⏱ expired"));
});

test("the prompt cache is off by default and hidden without a last reply", () => {
  assert.deepEqual(render({}), []);
  assert.deepEqual(render({ showPromptCache: true }, { ...snapshot, session: undefined }), []);
});

test("the compact session line includes the prompt cache countdown", () => {
  assert.deepEqual(render({ showPromptCache: true }, snapshot, { lineLayout: "compact" }).map(strip), ["Cache ⏱ 4m 15s"]);
});

test("the memory Element shows approximate system RAM usage in expanded layout", () => {
  assert.deepEqual(render({ showMemoryUsage: true }).map(strip), ["Approx RAM ██████░░░░ 10 GB / 16 GB (63%)"]);
});

test("memory is off by default, hidden without a sample, and stays hidden in compact layout", () => {
  assert.deepEqual(render({}), []);
  assert.deepEqual(render({ showMemoryUsage: true }, { ...snapshot, memory: null }), []);
  assert.deepEqual(render({ showMemoryUsage: true }, snapshot, { lineLayout: "compact" }), []);
});

test("memory and prompt cache follow elementOrder", () => {
  const display = { showMemoryUsage: true, showPromptCache: true };
  assert.deepEqual(render(display).map(strip), ["Cache ⏱ 4m 15s", "Approx RAM ██████░░░░ 10 GB / 16 GB (63%)"]);
  assert.deepEqual(render(display, snapshot, { elementOrder: ["memory", "promptCache"] }).map(strip), [
    "Approx RAM ██████░░░░ 10 GB / 16 GB (63%)",
    "Cache ⏱ 4m 15s",
  ]);
  assert.deepEqual(render(display, snapshot, { elementOrder: ["memory"] }).map(strip), ["Approx RAM ██████░░░░ 10 GB / 16 GB (63%)"]);
});

test("the memory label honours the label colour override", () => {
  const colors = { ...DEFAULT_CONFIG.colors, label: "#abcdef" as const };
  assert.ok(render({ showMemoryUsage: true }, snapshot, { colors })[0].includes("\x1b[38;2;171;205;239mApprox RAM\x1b[0m"));
});
