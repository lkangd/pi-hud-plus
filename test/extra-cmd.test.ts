// Ported from claude-hud tests/extra-cmd.test.js. parseExtraCmdArg is gone (the command comes from config),
// and runExtraCmd takes pi.exec, faked here, instead of spawning a shell itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runExtraCmd, sanitize } from "../src/extra-cmd.ts";

// ---- sanitize() ----

test("sanitize strips ANSI CSI sequences", () => {
  assert.equal(sanitize("\x1B[31mRed\x1B[0m Text"), "Red Text");
});

test("sanitize strips OSC sequences", () => {
  assert.equal(sanitize("\x1B]0;Window Title\x07Normal Text"), "Normal Text");
});

test("sanitize strips C0 control characters", () => {
  assert.equal(sanitize("Hello\x00World\x1FTest"), "HelloWorldTest");
});

test("sanitize strips C1 control characters", () => {
  assert.equal(sanitize("Hello\x80World\x9FTest"), "HelloWorldTest");
});

test("sanitize strips bidi control characters", () => {
  assert.equal(sanitize("Hello\u200EWorld\u202ATest\u2069End"), "HelloWorldTestEnd");
});

test("sanitize preserves normal text", () => {
  assert.equal(sanitize("Just normal text 123!"), "Just normal text 123!");
});

test("sanitize handles empty string", () => {
  assert.equal(sanitize(""), "");
});

test("sanitize handles complex mixed escape sequences", () => {
  assert.equal(sanitize("\x1B[1;32mBold Green\x1B[0m \x1B]0;Title\x07 \x00Hidden\x1F"), "Bold Green  Hidden");
});

// ---- runExtraCmd() ----

type Result = { stdout?: string; code?: number; killed?: boolean };

/** A pi.exec fake that records its calls and resolves like pi.exec does, even on a bad exit. */
function fakeExec(result: Result | Error) {
  const calls: { command: string; args: string[]; options?: { timeout?: number } }[] = [];
  const exec = async (command: string, args: string[], options?: { timeout?: number }) => {
    calls.push({ command, args, options });
    if (result instanceof Error) throw result;
    return { stdout: "", stderr: "", code: 0, killed: false, truncated: false, ...result };
  };
  return { exec, calls };
}

const run = (result: Result | Error, timeout?: number) => runExtraCmd(fakeExec(result).exec, "cmd", timeout);

test("runExtraCmd runs the command through sh -c with a timeout", async () => {
  const { exec, calls } = fakeExec({ stdout: '{"label": "test"}' });
  await runExtraCmd(exec, "kubectl config current-context | jq");
  assert.equal(calls[0]!.command, "sh");
  assert.deepEqual(calls[0]!.args, ["-c", "kubectl config current-context | jq"]);
  assert.equal(calls[0]!.options?.timeout, 3000);
  await runExtraCmd(exec, "x", 100);
  assert.equal(calls[1]!.options?.timeout, 100);
});

test("runExtraCmd returns label from valid JSON output", async () => {
  assert.equal(await run({ stdout: '{"label": "test"}\n' }), "test");
});

test("runExtraCmd returns null for non-JSON output", async () => {
  assert.equal(await run({ stdout: "not json\n" }), null);
});

test("runExtraCmd returns null for JSON without label field", async () => {
  assert.equal(await run({ stdout: '{"other": "field"}' }), null);
});

test("runExtraCmd returns null for JSON with non-string label", async () => {
  assert.equal(await run({ stdout: '{"label": 123}' }), null);
});

test("runExtraCmd truncates long labels with ellipsis", async () => {
  const result = await run({ stdout: `{"label": "${"a".repeat(60)}"}` });
  assert.equal(result?.length, 50);
  assert.ok(result?.endsWith("…"));
});

test("runExtraCmd sanitizes output containing escape sequences", async () => {
  assert.equal(await run({ stdout: '{"label": "\\u001b[31mRed\\u001b[0m"}' }), "Red");
});

test("runExtraCmd returns null when command fails", async () => {
  assert.equal(await run({ stdout: '{"label": "partial"}', code: 1 }), null);
});

test("runExtraCmd returns null when command does not exist", async () => {
  assert.equal(await run({ code: 127 }), null);
});

test("runExtraCmd returns null when exec itself throws", async () => {
  assert.equal(await run(new Error("spawn sh ENOENT")), null);
});

test("runExtraCmd handles timeout", async () => {
  assert.equal(await run({ stdout: '{"label": "late"}', code: 143, killed: true }, 100), null);
});

test("runExtraCmd handles empty stdout", async () => {
  assert.equal(await run({ stdout: "\n" }), null);
});

test("runExtraCmd handles JSON array instead of object", async () => {
  assert.equal(await run({ stdout: "[1,2,3]" }), null);
});

test("runExtraCmd handles null JSON", async () => {
  assert.equal(await run({ stdout: "null" }), null);
});

test("runExtraCmd handles valid JSON with extra whitespace", async () => {
  assert.equal(await run({ stdout: '  { "label": "trimmed" }  \n' }), "trimmed");
});
