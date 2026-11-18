// Ported from claude-hud's tests/format-reset-time.test.js; `now` is passed in, as the HUD renders against the snapshot's clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatResetTime } from "../src/render/format-reset-time.ts";
import { setLanguage } from "../src/i18n/index.ts";

const NOW = Date.UTC(2026, 3, 20, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const future = (ms: number) => new Date(NOW + ms);

test("returns empty string for null", () => {
  assert.equal(formatResetTime(null, "relative", NOW), "");
  assert.equal(formatResetTime(null, "absolute", NOW), "");
  assert.equal(formatResetTime(null, "both", NOW), "");
});

test("returns empty string for a date in the past", () => {
  const past = new Date(NOW - HOUR);
  assert.equal(formatResetTime(past, "relative", NOW), "");
  assert.equal(formatResetTime(past, "absolute", NOW), "");
  assert.equal(formatResetTime(past, "both", NOW), "");
});

test("relative: shows minutes when < 1 hour", () => {
  assert.equal(formatResetTime(future(30 * MINUTE), "relative", NOW), "30m");
});

test("relative: shows hours + minutes when < 24 hours", () => {
  assert.equal(formatResetTime(future(2 * HOUR + 30 * MINUTE), "relative", NOW), "2h 30m");
});

test("relative: shows hours only when minutes == 0", () => {
  assert.equal(formatResetTime(future(3 * HOUR), "relative", NOW), "3h");
});

test("relative: shows days + hours for durations >= 24 hours", () => {
  assert.equal(formatResetTime(future(6 * DAY + 7 * HOUR), "relative", NOW), "6d 7h");
});

test("relative: shows days only when remaining hours == 0", () => {
  assert.equal(formatResetTime(future(3 * DAY), "relative", NOW), "3d");
});

test("relative: rounds partial minutes up", () => {
  assert.equal(formatResetTime(future(90 * MINUTE + 1), "relative", NOW), "1h 31m");
});

test("relative is the default mode", () => {
  assert.equal(formatResetTime(future(90 * MINUTE)), formatResetTime(future(90 * MINUTE), "relative"));
});

test("absolute: the time with an \"at \" prefix, same day", () => {
  const resetAt = future(2 * HOUR);
  const time = resetAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const sameDay = resetAt.toDateString() === new Date(NOW).toDateString();
  const result = formatResetTime(resetAt, "absolute", NOW);
  assert.ok(result.startsWith("at "), result);
  assert.ok(result.endsWith(time), result);
  if (sameDay) assert.equal(result, `at ${time}`);
});

test("absolute: includes date component when reset is tomorrow or later", () => {
  const resetAt = future(30 * HOUR);
  const date = resetAt.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = resetAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  assert.equal(formatResetTime(resetAt, "absolute", NOW), `at ${date} ${time}`);
});

test("absolute: zh-Hans drops the \"at\" prefix (format.resets carries it)", () => {
  const resetAt = future(30 * HOUR);
  setLanguage("zh-Hans");
  try {
    assert.ok(!formatResetTime(resetAt, "absolute", NOW).startsWith("at"));
  } finally {
    setLanguage("en");
  }
});

test("both: format is \"<relative>, <absolute>\"", () => {
  assert.match(formatResetTime(future(2 * HOUR + 30 * MINUTE), "both", NOW), /^2h 30m, at .+$/);
});
