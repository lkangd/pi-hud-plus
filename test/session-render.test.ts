import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { renderHud } from "../src/render/index.ts";
import { DEFAULT_CONFIG, type HudConfig } from "../src/config.ts";
import type { HudSnapshot } from "../src/types.ts";

// Local times, so the absolute formats don't depend on the machine's time zone.
const START = new Date(2026, 4, 8, 9, 14).getTime();
const LAST_REPLY = new Date(2026, 4, 8, 11, 30).getTime();
const NOW = LAST_REPLY + 5 * 60_000;

const snapshot: HudSnapshot = {
  model: { name: "Claude Opus 4.6" },
  cwd: "/home/me/code/my-project",
  context: null,
  tools: [],
  now: NOW,
  session: {
    startedAt: START,
    lastReplyAt: LAST_REPLY,
    totals: { input: 12_000, output: 3_400, cacheRead: 250_000, cacheWrite: 40_000, cost: 0.4321 },
    subscription: false,
  },
};

type Display = Partial<HudConfig["display"]>;
const cfg = (display: Display, patch: Partial<HudConfig> = {}): HudConfig => ({
  ...DEFAULT_CONFIG,
  ...patch,
  display: { ...DEFAULT_CONFIG.display, ...display },
});
const render = (display: Display, s: HudSnapshot = snapshot, patch: Partial<HudConfig> = {}) =>
  renderHud(s, cfg(display, patch), 200).map(strip);
const compact = (display: Display, s: HudSnapshot = snapshot) =>
  render({ showModel: false, showProject: false, ...display }, s, { lineLayout: "compact" });

const PROJECT = "[Claude Opus 4.6] │ my-project";

test("the sessionTime Element shows the start and last reply, relative by default", () => {
  assert.deepEqual(render({ showSessionStartDate: true, showLastResponseAt: true }), [
    PROJECT,
    "Started: 2h 21m ago │ Last reply: 5m ago",
  ]);
});

test("timeFormat absolute and both render wall-clock times", () => {
  const display = { showSessionStartDate: true, showLastResponseAt: true };
  assert.deepEqual(render({ ...display, timeFormat: "absolute" })[1], "Started: 2026-05-08 09:14 │ Last reply: 2026-05-08 11:30");
  assert.deepEqual(render({ ...display, timeFormat: "both" })[1], "Started: 2h 21m ago, 2026-05-08 09:14 │ Last reply: 5m ago, 2026-05-08 11:30");
  assert.deepEqual(render({ ...display, timeFormat: "elapsed" })[1], "Started: 2h 21m ago │ Last reply: 5m ago");
  assert.deepEqual(render({ ...display, timeFormat: "elapsedAndAbsolute" })[1], "Started: 2h 21m ago, 2026-05-08 09:14 │ Last reply: 5m ago, 2026-05-08 11:30");
});

test("relative times scale from seconds to days", () => {
  const at = (ago: number) => render({ showLastResponseAt: true }, { ...snapshot, now: LAST_REPLY + ago })[1];
  assert.equal(at(45_000), "Last reply: 45s ago");
  assert.equal(at((2 * 60 + 30) * 60_000), "Last reply: 2h 30m ago");
  assert.equal(at(2 * 86_400_000), "Last reply: 2d ago");
  assert.equal(at(-1000), "Last reply: just now");
});

test("the sessionTime Element is off by default and hides parts it has no data for", () => {
  assert.deepEqual(render({}), [PROJECT]);
  assert.deepEqual(render({ showSessionStartDate: true, showLastResponseAt: true }, { ...snapshot, session: { ...snapshot.session!, lastReplyAt: undefined } })[1], "Started: 2h 21m ago");
  assert.deepEqual(render({ showLastResponseAt: true }, { ...snapshot, session: undefined }), [PROJECT]);
});

const named: HudSnapshot = { ...snapshot, speed: 45.24, session: { ...snapshot.session!, name: "refactor" } };

test("session name, duration, cost and speed go on the project Line, each behind its toggle", () => {
  assert.deepEqual(render({}, named), [PROJECT]);
  assert.deepEqual(render({ showSessionName: true, showDuration: true, showCost: true, showSpeed: true }, named), [
    `${PROJECT} │ refactor │ ⏱️  2h 21m │ Cost $0.432 │ out: 45.2 tok/s`,
  ]);
});

test("cost shows (sub) on a subscription, and hides at zero cost otherwise, like pi's footer", () => {
  const withCost = (cost: number, subscription: boolean) =>
    render(
      { showCost: true, showProject: false, showModel: false },
      { ...snapshot, session: { ...snapshot.session!, totals: { ...snapshot.session!.totals, cost }, subscription } },
    );
  assert.deepEqual(withCost(1.5, true), ["Cost $1.50 (sub)"]);
  assert.deepEqual(withCost(0, true), ["Cost $0.0000 (sub)"]);
  assert.deepEqual(withCost(0.01234, false), ["Cost $0.0123"]);
  assert.deepEqual(withCost(0, false), []);
});

test("duration is <1m for a fresh session", () => {
  assert.deepEqual(render({ showDuration: true, showModel: false, showProject: false }, { ...snapshot, now: START + 30_000 }), ["⏱️  <1m"]);
});

test("the session name can't inject escape codes", () => {
  const evil = { ...snapshot, session: { ...snapshot.session!, name: "a\x1b[31mb" } };
  assert.deepEqual(render({ showSessionName: true, showModel: false, showProject: false }, evil), ["a[31mb"]);
});

test("showSessionTokens adds a session tokens Line after the Elements in expanded layout", () => {
  assert.deepEqual(render({ showSessionTokens: true }), [PROJECT, "Tokens 305k (in: 12k, out: 3k, cache: 290k)"]);
  const noCache = { ...snapshot, session: { ...snapshot.session!, totals: { input: 1_500_000, output: 900, cacheRead: 0, cacheWrite: 0, cost: 0 } } };
  assert.deepEqual(render({ showSessionTokens: true }, noCache)[1], "Tokens 1.5M (in: 1.5M, out: 900)");
  const empty = { ...snapshot, session: { ...snapshot.session!, totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } } };
  assert.deepEqual(render({ showSessionTokens: true }, empty), [PROJECT]);
});

test("compact layout puts the session Elements inline, in claude-hud's order", () => {
  assert.deepEqual(
    compact({ showSessionName: true, showSessionTokens: true, showDuration: true, showLastResponseAt: true, showCost: true, showSpeed: true }, named),
    ["refactor | tok: 305k (in: 12k, out: 3k) | ⏱️  2h 21m | Last reply: 5m ago | Cost $0.432 | out: 45.2 tok/s"],
  );
});
