import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { createDebug } from "../src/debug.ts";
import { runExtraCmd } from "../src/extra-cmd.ts";

const agentDir = mkdtempSync(join(tmpdir(), "pi-hud-debug-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const logFile = join(agentDir, "pi-hud-plus-debug.log");
const readLog = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");

test("logs nothing unless DEBUG names pi-hud-plus or is *", () => {
  rmSync(logFile, { force: true });
  for (const value of [undefined, "", "claude-hud", "pi-hud"]) {
    if (value === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = value;
    createDebug("test")("hidden");
  }
  assert.equal(readLog(), "");
});

test("DEBUG=pi-hud-plus or * appends namespaced lines to the agent dir's log file", () => {
  rmSync(logFile, { force: true });
  process.env.DEBUG = "pi-hud-plus,other";
  createDebug("config")("first %d", 1, { a: 2 });
  process.env.DEBUG = "*";
  createDebug("git")("second");
  const lines = readLog().trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^\d{4}-\d\d-\d\dT\S+ \[pi-hud-plus:config\] first 1 \{ a: 2 \}$/);
  assert.match(lines[1]!, /\[pi-hud-plus:git\] second$/);
});

test("the Extra command and config reading log why they fell back", async () => {
  rmSync(logFile, { force: true });
  process.env.DEBUG = "pi-hud-plus";
  const exec = async () => ({ stdout: "not json", stderr: "", code: 0, killed: false, truncated: false });
  assert.equal(await runExtraCmd(exec as never, "echo hi"), null);
  const killed = async () => ({ stdout: "", stderr: "", code: 1, killed: true, truncated: false });
  assert.equal(await runExtraCmd(killed as never, "sleep 9", 50), null);
  writeFileSync(join(agentDir, "pi-hud-plus.json"), "{ broken");
  loadConfig(agentDir);
  writeFileSync(join(agentDir, "pi-hud-plus.json"), "[1]");
  loadConfig(agentDir);
  rmSync(join(agentDir, "pi-hud-plus.json"));
  loadConfig(agentDir);
  const log = readLog();
  assert.match(log, /\[pi-hud-plus:extra-cmd\] Failed to parse JSON output\n/);
  assert.match(log, /\[pi-hud-plus:extra-cmd\] Command timed out after 50ms\n/);
  assert.ok(!log.includes("sleep 9") && !log.includes("echo hi") && !log.includes("not json"), "the command or its output may hold secrets");
  assert.match(log, /\[pi-hud-plus:config\] Failed to read .*pi-hud-plus\.json: /);
  assert.match(log, /\[pi-hud-plus:config\] Ignoring .*pi-hud-plus\.json: not a JSON object/);
  assert.equal(log.match(/pi-hud-plus:config/g)?.length, 2, "a missing file is normal, not logged");
  assert.equal(statSync(logFile).mode & 0o777, 0o600, "only the user can read the log");
});
