// Ported from claude-hud's usage cases in tests/render.test.js (renderUsageLine = expanded, renderSessionLine = compact), plus Monthly.
// Dropped: Bedrock/Enterprise/plan-name cases (no Pi equivalent) and invalid timeFormat (mergeConfig already rejects it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { renderHud } from "../src/render/index.ts";
import { DEFAULT_CONFIG, type HudConfig } from "../src/config.ts";
import type { HudSnapshot, UsageLimit } from "../src/types.ts";

const NOW = Date.UTC(2026, 3, 20, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW + ms);

const usage = (patch: Partial<UsageLimit>): UsageLimit => ({
  fiveHour: null,
  sevenDay: null,
  monthly: null,
  fiveHourResetAt: null,
  sevenDayResetAt: null,
  monthlyResetAt: null,
  ...patch,
});

type Display = Partial<HudConfig["display"]>;
type Colors = Partial<HudConfig["colors"]>;

/** The usage Line alone: model, project and context off; text-only usage as in claude-hud's baseContext. */
function raw(usageLimit: UsageLimit | null, display: Display = {}, patch: Partial<HudConfig> = {}, colors: Colors = {}): string[] {
  const snapshot: HudSnapshot = { model: null, cwd: "/tmp/p", context: null, tools: [], now: NOW, usageLimit };
  const config: HudConfig = {
    ...DEFAULT_CONFIG,
    ...patch,
    display: { ...DEFAULT_CONFIG.display, showModel: false, showProject: false, usageBarEnabled: false, ...display },
    colors: { ...DEFAULT_CONFIG.colors, ...colors },
  };
  return renderHud(snapshot, config, 200);
}
const expanded = (u: UsageLimit | null, display: Display = {}, colors: Colors = {}) => raw(u, display, {}, colors).map(strip);
const compact = (u: UsageLimit | null, display: Display = {}, colors: Colors = {}) => raw(u, display, { lineLayout: "compact" }, colors).map(strip);

const zh = (u: UsageLimit, display: Display = {}) => raw(u, display, { language: "zh-Hans" }).map(strip);

// ---- Expanded: renderUsageLine ----

test("the usage Line translates labels when Chinese is enabled", () => {
  const lines = zh(usage({ fiveHour: 25, sevenDay: 10, fiveHourResetAt: at(HOUR) }));
  assert.deepEqual(lines, ["用量 5h 25% (重置剩余 1h)"]);
});

test("the usage Line shows 5h, and Weekly only from sevenDayThreshold", () => {
  assert.deepEqual(expanded(usage({ fiveHour: 6, sevenDay: 13 })), ["Usage 5h 6%"]);
  assert.deepEqual(expanded(usage({ fiveHour: 45, sevenDay: 85, sevenDayResetAt: at(28 * HOUR) })), ["Usage 5h 45% | Weekly 85% (resets in 1d 4h)"]);
  assert.deepEqual(expanded(usage({ fiveHour: 10, sevenDay: 5 }), { sevenDayThreshold: 0 }), ["Usage 5h 10% | Weekly 5%"]);
});

test("the usage Line shows the reset countdown in days when >= 24 hours (bar mode)", () => {
  const lines = expanded(usage({ fiveHour: 45, sevenDay: 20, fiveHourResetAt: at(151 * HOUR + 59 * MINUTE) }), { usageBarEnabled: true });
  assert.deepEqual(lines, ["Usage █████░░░░░ 45% (resets in 6d 7h)"]);
});

test("the usage Line supports remaining-based display with used-percent colours", () => {
  const [line] = raw(usage({ fiveHour: 25, sevenDay: 85 }), { usageValue: "remaining" }, {}, { usage: "cyan", usageWarning: "magenta" });
  assert.equal(strip(line!), "Usage 5h 75% | Weekly 15%");
  assert.ok(line!.includes("\x1b[36m75%\x1b[0m"), JSON.stringify(line));
  assert.ok(line!.includes("\x1b[35m15%\x1b[0m"), JSON.stringify(line));
});

test("the usage Line shows a Balance instead of Limit windows", () => {
  assert.deepEqual(expanded(usage({ balanceLabel: "¥6.35" })), ["Usage ¥6.35"]);
  assert.deepEqual(compact(usage({ balanceLabel: "¥6.35" })), ["Usage ¥6.35"]);
});

test("the usage Line can hide the reset label, in text and bar mode", () => {
  const u = usage({ fiveHour: 45, sevenDay: 85, sevenDayResetAt: at(28 * HOUR) });
  assert.deepEqual(expanded(u, { showResetLabel: false }), ["Usage 5h 45% | Weekly 85% (1d 4h)"]);
  assert.deepEqual(expanded(u, { showResetLabel: false, usageBarEnabled: true }), ["Usage █████░░░░░ 45% | Weekly █████████░ 85% (1d 4h)"]);
});

test("the usage Line translates Weekly when Chinese is enabled", () => {
  const lines = zh(usage({ fiveHour: 45, sevenDay: 85, sevenDayResetAt: at(28 * HOUR) }));
  assert.deepEqual(lines, ["用量 5h 45% | 本周 85% (重置剩余 1d 4h)"]);
});

test("the usage Line shows the 7d reset countdown in bar mode above the threshold", () => {
  const lines = expanded(usage({ fiveHour: 45, sevenDay: 85, sevenDayResetAt: at(28 * HOUR) }), { usageBarEnabled: true });
  assert.deepEqual(lines, ["Usage █████░░░░░ 45% | Weekly █████████░ 85% (resets in 1d 4h)"]);
});

test("the usage Line shows weekly-only usage without a ghost 5h section", () => {
  assert.deepEqual(expanded(usage({ sevenDay: 13 })), ["Usage Weekly 13%"]);
});

test("the usage Line shows limit reached with its reset", () => {
  assert.deepEqual(expanded(usage({ fiveHour: 100, sevenDay: 45, fiveHourResetAt: at(151 * HOUR + 59 * MINUTE) })), ["Usage ⚠ Limit reached (resets in 6d 7h)"]);
  assert.deepEqual(expanded(usage({ fiveHour: 40, sevenDay: 100, sevenDayResetAt: at(2 * HOUR) })), ["Usage ⚠ Limit reached (resets in 2h)"]);
  assert.deepEqual(expanded(usage({ fiveHour: 100 }), { showResetLabel: false }), ["Usage ⚠ Limit reached"]);
});

test("the usage Line shows -- for null usage values", () => {
  assert.deepEqual(expanded(usage({})), ["Usage 5h --"]);
});

test("the usage Line uses custom usage palette overrides", () => {
  const [line] = raw(usage({ fiveHour: 25, sevenDay: 80 }), { usageBarEnabled: true }, {}, { usage: "cyan", usageWarning: "magenta" });
  assert.ok(line!.includes("\x1b[36m███"), JSON.stringify(line));
  assert.ok(line!.includes("\x1b[36m25%\x1b[0m"), JSON.stringify(line));
  assert.ok(line!.includes("\x1b[35m████████"), JSON.stringify(line));
  assert.ok(line!.includes("\x1b[35m80%\x1b[0m"), JSON.stringify(line));
});

test("the usage bar uses custom barFilled and barEmpty characters", () => {
  assert.deepEqual(expanded(usage({ fiveHour: 50 }), { usageBarEnabled: true }, { barFilled: "●", barEmpty: "○" }), ["Usage ●●●●●○○○○○ 50%"]);
});

test("usageThreshold hides the Line until 5h or Weekly reaches it", () => {
  assert.deepEqual(expanded(usage({ fiveHour: 30, sevenDay: 40 }), { usageThreshold: 50 }), []);
  assert.deepEqual(expanded(usage({ fiveHour: 30, sevenDay: 60 }), { usageThreshold: 50 }), ["Usage 5h 30%"]);
  assert.deepEqual(compact(usage({ fiveHour: 30, sevenDay: 40 }), { usageThreshold: 50 }), []);
});

test("the usage Element is hidden with showUsage off or no usage data", () => {
  assert.deepEqual(expanded(usage({ fiveHour: 25 }), { showUsage: false }), []);
  assert.deepEqual(compact(usage({ fiveHour: 25 }), { showUsage: false }), []);
  assert.deepEqual(expanded(null), []);
  assert.deepEqual(compact(null), []);
});

test("usageCompact shows the short 5h: / 7d: form", () => {
  assert.deepEqual(expanded(usage({ fiveHour: 25, sevenDay: 85, fiveHourResetAt: at(2 * HOUR) }), { usageCompact: true }), ["5h: 25% (2h) | 7d: 85%"]);
  assert.deepEqual(expanded(usage({ fiveHour: 25, sevenDay: 85 }), { usageCompact: true, usageValue: "remaining" }), ["5h: 75% | 7d: 15%"]);
  assert.deepEqual(expanded(usage({ sevenDay: 13 }), { usageCompact: true }), ["7d: 13%"]);
  assert.deepEqual(expanded(usage({ fiveHour: 100, fiveHourResetAt: at(HOUR) }), { usageCompact: true }), ["⚠ Limit (1h)"]);
});

// ---- Expanded: timeFormat ----

test("the usage Line says \"resets in\" for relative and \"resets at\" for absolute", () => {
  const u = usage({ fiveHour: 45, sevenDay: 20, fiveHourResetAt: at(2 * HOUR) });
  assert.deepEqual(expanded(u, { usageBarEnabled: true }), ["Usage █████░░░░░ 45% (resets in 2h)"]);
  const [absolute] = expanded(u, { usageBarEnabled: true, timeFormat: "absolute" });
  assert.match(absolute!, /^Usage █████░░░░░ 45% \(resets at .+\)$/);
});

test("the usage Line shows relative and absolute time when timeFormat is \"both\"", () => {
  const [line] = expanded(usage({ fiveHour: 45, sevenDay: 20, fiveHourResetAt: at(2.5 * HOUR) }), { timeFormat: "both" });
  assert.match(line!, /^Usage 5h 45% \(resets in 2h 30m, at .+\)$/);
});

test("the usage Line shows the elapsed share of the window when timeFormat is \"elapsed\"", () => {
  assert.deepEqual(expanded(usage({ fiveHour: 31, sevenDay: 20, fiveHourResetAt: at(4 * HOUR) }), { timeFormat: "elapsed" }), ["Usage 5h 31% (20% elapsed)"]);
  assert.deepEqual(expanded(usage({ sevenDay: 85, sevenDayResetAt: at(5.5 * DAY) }), { timeFormat: "elapsed" }), ["Usage Weekly 85% (21% elapsed)"]);
  assert.deepEqual(expanded(usage({ fiveHour: 31, fiveHourResetAt: at(-1000) }), { timeFormat: "elapsed" }), ["Usage 5h 31% (100% elapsed)"]);
  assert.deepEqual(expanded(usage({ fiveHour: 31, fiveHourResetAt: at(6 * HOUR) }), { timeFormat: "elapsed" }), ["Usage 5h 31% (0% elapsed)"]);
});

test("the usage Line shows elapsed and the reset clock when timeFormat is \"elapsedAndAbsolute\"", () => {
  const u = usage({ fiveHour: 31, sevenDay: 20, fiveHourResetAt: at(4 * HOUR) });
  assert.match(expanded(u, { timeFormat: "elapsedAndAbsolute" })[0]!, /^Usage 5h 31% \(20% elapsed, at .+\)$/);
  assert.match(expanded(u, { timeFormat: "elapsedAndAbsolute", showResetLabel: false })[0]!, /^Usage 5h 31% \(20% elapsed, at .+\)$/);
});

test("limit reached says \"resets in\" for relative and \"resets at\" for absolute", () => {
  const u = usage({ fiveHour: 100, sevenDay: 45, fiveHourResetAt: at(2 * HOUR) });
  assert.deepEqual(expanded(u), ["Usage ⚠ Limit reached (resets in 2h)"]);
  assert.match(expanded(u, { timeFormat: "absolute" })[0]!, /^Usage ⚠ Limit reached \(resets at .+\)$/);
});

// ---- Expanded: Monthly ----

test("Monthly is a third part after Weekly, gated by sevenDayThreshold", () => {
  const glm = usage({ fiveHour: 7, sevenDay: 4, monthly: 2 });
  assert.deepEqual(expanded(glm), ["Usage 5h 7%"]);
  assert.deepEqual(expanded(glm, { sevenDayThreshold: 0 }), ["Usage 5h 7% | Weekly 4% | Monthly 2%"]);
  assert.deepEqual(expanded(usage({ fiveHour: 7, sevenDay: 4, monthly: 85, monthlyResetAt: at(3 * DAY) })), ["Usage 5h 7% | Monthly 85% (resets in 3d)"]);
  assert.deepEqual(expanded(usage({ fiveHour: 7, monthly: 2 }), { usageCompact: true, sevenDayThreshold: 0 }), ["5h: 7% | mo: 2%"]);
});

test("Monthly-only uses the weekly-only form; with Weekly alone it still waits for the threshold", () => {
  assert.deepEqual(expanded(usage({ monthly: 2 })), ["Usage Monthly 2%"]);
  assert.deepEqual(expanded(usage({ monthly: 2 }), { usageCompact: true }), ["mo: 2%"]);
  assert.deepEqual(expanded(usage({ sevenDay: 13, monthly: 2 })), ["Usage Weekly 13%"]);
  assert.deepEqual(expanded(usage({ sevenDay: 13, monthly: 90 })), ["Usage Weekly 13% | Monthly 90%"]);
});

test("a full monthly window is limit reached, with the monthly reset", () => {
  assert.deepEqual(expanded(usage({ fiveHour: 7, sevenDay: 4, monthly: 100, monthlyResetAt: at(3 * DAY) })), ["Usage ⚠ Limit reached (resets in 3d)"]);
});

test("Monthly translates to 本月", () => {
  assert.deepEqual(zh(usage({ monthly: 2 })), ["用量 本月 2%"]);
});

test("context and usage share a Line by default, as in claude-hud", () => {
  const snapshot: HudSnapshot = {
    model: null, cwd: "/tmp/p", context: { tokens: 46_000, window: 200_000, percent: 23 }, tools: [], now: NOW, usageLimit: usage({ fiveHour: 6 }),
  };
  const config = { ...DEFAULT_CONFIG, display: { ...DEFAULT_CONFIG.display, showModel: false, showProject: false } };
  assert.deepEqual(renderHud(snapshot, config, 200).map(strip), ["Context ██░░░░░░░░ 23% │ Usage █░░░░░░░░░ 6%"]);
});

// ---- Compact layout: renderSessionLine ----

test("the session line shows 5h, and Weekly from sevenDayThreshold", () => {
  assert.deepEqual(compact(usage({ fiveHour: 6, sevenDay: 13 })), ["Usage 5h 6%"]);
  assert.deepEqual(compact(usage({ fiveHour: 45, sevenDay: 85 })), ["Usage 5h 45% | Weekly 85%"]);
  assert.deepEqual(compact(usage({ fiveHour: 10, sevenDay: 5 }), { sevenDayThreshold: 0 }), ["Usage 5h 10% | Weekly 5%"]);
});

test("the session line supports remaining-based usage, full and compact", () => {
  assert.deepEqual(compact(usage({ fiveHour: 25, sevenDay: 85 }), { usageValue: "remaining" }), ["Usage 5h 75% | Weekly 15%"]);
  assert.deepEqual(compact(usage({ fiveHour: 25, sevenDay: 85 }), { usageValue: "remaining", usageCompact: true }), ["5h: 75% | 7d: 15%"]);
});

test("the session line shows reset countdowns", () => {
  assert.deepEqual(compact(usage({ fiveHour: 45, sevenDay: 85, sevenDayResetAt: at(28 * HOUR) })), ["Usage 5h 45% | Weekly 85% (resets in 1d 4h)"]);
  assert.deepEqual(compact(usage({ fiveHour: 45, sevenDay: 20, fiveHourResetAt: at(2 * HOUR) })), ["Usage 5h 45% (resets in 2h)"]);
});

test("the session line's bar mode keeps claude-hud's (duration / window) reset", () => {
  assert.deepEqual(compact(usage({ fiveHour: 45, fiveHourResetAt: at(2 * HOUR) }), { usageBarEnabled: true }), ["Usage █████░░░░░ 45% (2h / 5h)"]);
  assert.match(compact(usage({ fiveHour: 45, fiveHourResetAt: at(2 * HOUR) }), { usageBarEnabled: true, timeFormat: "absolute" })[0]!, /^Usage █████░░░░░ 45% \(resets at .+\)$/);
});

test("the session line's weekly-only part has no Usage label (claude-hud's copy)", () => {
  assert.deepEqual(compact(usage({ sevenDay: 13 })), ["Weekly 13%"]);
});

test("the session line shows limit reached without the Usage label", () => {
  assert.deepEqual(compact(usage({ fiveHour: 100, sevenDay: 45, fiveHourResetAt: at(HOUR) })), ["⚠ Limit reached (resets in 1h)"]);
  assert.deepEqual(compact(usage({ fiveHour: 100, fiveHourResetAt: at(HOUR) }), { usageCompact: true }), ["⚠ Limit (1h)"]);
});

test("the session line shows -- for null usage values", () => {
  assert.deepEqual(compact(usage({})), ["Usage 5h --"]);
});

test("the session line uses custom critical colours for limit reached", () => {
  const [line] = raw(usage({ fiveHour: 100, sevenDay: 45, fiveHourResetAt: at(HOUR) }), {}, { lineLayout: "compact" }, { critical: "magenta" });
  assert.ok(line!.includes("\x1b[35m⚠ Limit reached"), JSON.stringify(line));
});

test("the session line passes elapsed timeFormats straight to formatResetTime, as claude-hud's copy does", () => {
  assert.match(compact(usage({ fiveHour: 31, fiveHourResetAt: at(4 * HOUR) }), { timeFormat: "elapsed" })[0]!, /^Usage 5h 31% \(resets in 4h, at .+\)$/);
});

test("the session line shows Monthly after Weekly, gated by sevenDayThreshold", () => {
  assert.deepEqual(compact(usage({ fiveHour: 7, sevenDay: 4, monthly: 85 })), ["Usage 5h 7% | Monthly 85%"]);
  assert.deepEqual(compact(usage({ monthly: 2 })), ["Monthly 2%"]);
  assert.deepEqual(compact(usage({ fiveHour: 7, sevenDay: 4, monthly: 2 }), { usageCompact: true, sevenDayThreshold: 0 }), ["5h: 7% | 7d: 4% | mo: 2%"]);
});

test("the session line puts usage after the model badge and before session tokens", () => {
  const snapshot: HudSnapshot = {
    model: { name: "Opus" }, cwd: "/tmp/p", context: null, tools: [], now: NOW, usageLimit: usage({ fiveHour: 6 }),
    session: { totals: { input: 1500, output: 250, cacheRead: 0, cacheWrite: 0, cost: 0 }, subscription: false },
  };
  const config: HudConfig = {
    ...DEFAULT_CONFIG,
    lineLayout: "compact",
    display: { ...DEFAULT_CONFIG.display, showProject: false, usageBarEnabled: false, showSessionTokens: true },
  };
  const [line] = renderHud(snapshot, config, 200).map(strip);
  assert.match(line!, /^\[Opus\] \| Usage 5h 6% \| /);
});
