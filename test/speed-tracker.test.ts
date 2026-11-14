import { test } from "node:test";
import assert from "node:assert/strict";
import { createSpeedTracker } from "../src/speed-tracker.ts";

test("computes tokens per second within the window", () => {
  const speed = createSpeedTracker();
  assert.equal(speed(10, 1000), null);
  assert.equal(speed(20, 1500), 20);
});

test("ignores sub-window bursts to avoid inflated rates", () => {
  const speed = createSpeedTracker();
  speed(10, 1000);
  assert.equal(speed(70, 1050), null);
});

test("accumulates repeated short windows until the sample matures", () => {
  const speed = createSpeedTracker();
  speed(10, 1000);
  assert.equal(speed(40, 1200), null);
  assert.equal(speed(70, 1400), null);
  assert.equal(speed(100, 1600), 150);
});

test("ignores stale windows", () => {
  const speed = createSpeedTracker();
  speed(10, 1000);
  assert.equal(speed(30, 8000), null);
  assert.equal(speed(40, 8500), 20);
});

test("restarts when the output count drops (a new reply)", () => {
  const speed = createSpeedTracker();
  speed(500, 1000);
  assert.equal(speed(5, 1500), null);
  assert.equal(speed(25, 2000), 40);
});

test("trackers are independent", () => {
  const a = createSpeedTracker();
  const b = createSpeedTracker();
  a(100, 1000);
  assert.equal(b(5, 1600), null);
  assert.equal(a(200, 1500), 200);
});
