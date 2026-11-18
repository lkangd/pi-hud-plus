// Ported from claude-hud's tests/external-usage.test.js (read side only; writing the snapshot is not ported).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type HudConfig } from "../src/config.ts";
import { getUsageFromExternalSnapshot } from "../src/external-usage.ts";

const UPDATED_AT = Date.UTC(2026, 3, 20, 12, 0, 0);

function withFile(content: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "pi-hud-external-usage-")), "usage.json");
  writeFileSync(file, content, "utf8");
  return file;
}

function makeConfig(externalUsagePath: string, externalUsageFreshnessMs = 300000): HudConfig {
  return { ...DEFAULT_CONFIG, display: { ...DEFAULT_CONFIG.display, externalUsagePath, externalUsageFreshnessMs } };
}

const read = (snapshot: object, now = UPDATED_AT + 60_000, freshnessMs?: number) =>
  getUsageFromExternalSnapshot(makeConfig(withFile(JSON.stringify(snapshot)), freshnessMs), now);

test("returns null without a configured path", () => {
  assert.equal(getUsageFromExternalSnapshot(DEFAULT_CONFIG, Date.now()), null);
});

test("parses a fresh snapshot", () => {
  const usage = read({
    updated_at: new Date(UPDATED_AT).toISOString(),
    five_hour: { used_percentage: 42.4, resets_at: "2026-04-20T15:00:00.000Z" },
    seven_day: { used_percentage: 84.6, resets_at: "2026-04-27T12:00:00.000Z" },
  });
  assert.deepEqual(usage, {
    fiveHour: 42,
    sevenDay: 85,
    monthly: null,
    fiveHourResetAt: new Date("2026-04-20T15:00:00.000Z"),
    sevenDayResetAt: new Date("2026-04-27T12:00:00.000Z"),
    monthlyResetAt: null,
  });
});

test("epoch timestamps: above 1e12 are ms, otherwise seconds; percentages clamp to 0-100", () => {
  const usage = read({
    updated_at: UPDATED_AT / 1000,
    five_hour: { used_percentage: 140, resets_at: UPDATED_AT + 3_600_000 },
    seven_day: { used_percentage: -3, resets_at: (UPDATED_AT + 86_400_000) / 1000 },
  });
  assert.equal(usage?.fiveHour, 100);
  assert.equal(usage?.sevenDay, 0);
  assert.deepEqual(usage?.fiveHourResetAt, new Date(UPDATED_AT + 3_600_000));
  assert.deepEqual(usage?.sevenDayResetAt, new Date(UPDATED_AT + 86_400_000));
});

test("parses optional balance labels", () => {
  assert.deepEqual(read({ updated_at: new Date(UPDATED_AT).toISOString(), balance_label: " ¥6.35 " }), {
    fiveHour: null,
    sevenDay: null,
    monthly: null,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
    monthlyResetAt: null,
    balanceLabel: "¥6.35",
  });
});

test("sanitizes balance labels before rendering", () => {
  const usage = read({
    updated_at: new Date(UPDATED_AT).toISOString(),
    five_hour: { used_percentage: 42 },
    balance_label: "\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007\u202E",
  });
  assert.equal(usage?.balanceLabel, "click");
});

test("cuts long balance labels to 50 characters", () => {
  const usage = read({ updated_at: new Date(UPDATED_AT).toISOString(), balance_label: "x".repeat(60) });
  assert.equal(usage?.balanceLabel, `${"x".repeat(47)}...`);
});

test("ignores stale snapshots", () => {
  const snapshot = { updated_at: new Date(UPDATED_AT).toISOString(), five_hour: { used_percentage: 42, resets_at: "2026-04-20T15:00:00.000Z" } };
  assert.equal(read(snapshot, UPDATED_AT + 1001, 1000), null);
  assert.notEqual(read(snapshot, UPDATED_AT + 1000, 1000), null);
});

test("requires updated_at and some usage value", () => {
  assert.equal(read({ five_hour: { used_percentage: 42 } }), null);
  assert.equal(read({ updated_at: new Date(UPDATED_AT).toISOString(), five_hour: { used_percentage: "42" } }), null);
});

test("rejects the whole snapshot for an invalid resets_at", () => {
  assert.equal(read({ updated_at: new Date(UPDATED_AT).toISOString(), five_hour: { used_percentage: 42, resets_at: "not-a-date" } }, UPDATED_AT + 1), null);
  assert.equal(read({ updated_at: new Date(UPDATED_AT).toISOString(), five_hour: { used_percentage: 42 }, seven_day: { used_percentage: 5, resets_at: -1 } }), null);
});

test("returns null for invalid JSON or a missing file", () => {
  assert.equal(getUsageFromExternalSnapshot(makeConfig(withFile("{")), Date.now()), null);
  assert.equal(getUsageFromExternalSnapshot(makeConfig("/nonexistent/pi-hud-usage.json"), Date.now()), null);
});
