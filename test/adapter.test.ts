import { beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piHud from "../src/index.ts";

// Isolate from the real ~/.pi/agent: getAgentDir() honours PI_CODING_AGENT_DIR.
const agentDir = mkdtempSync(join(tmpdir(), "pi-hud-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

type Handler = (event: any, ctx: any) => unknown;
type Footer = { render(width: number): string[]; dispose?(): void };

function fakePi(exec: (...args: any[]) => Promise<unknown> = () => Promise.reject(new Error("unexpected exec"))) {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    exec,
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
  piHud(pi as unknown as ExtensionAPI);
  const emit = async (event: string, payload: object, ctx: object) => {
    for (const h of handlers.get(event) ?? []) await h({ type: event, ...payload }, ctx);
  };
  return { emit };
}

beforeEach(() => {
  // The once-per-process notice flag lives on globalThis so it survives /reload's module re-import.
  delete (globalThis as any)[Symbol.for("pi-hud-plus.displacedNoticeShown")];
  mock.timers.reset();
});

/** footerData with a settable branch and a working onBranchChange. */
function fakeFooterData(branch: string | null) {
  const listeners = new Set<() => void>();
  return {
    branch,
    listeners,
    getGitBranch() {
      return this.branch;
    },
    getExtensionStatuses: () => new Map(),
    getAvailableProviderCount: () => 1,
    onBranchChange(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    changeBranch(next: string) {
      this.branch = next;
      for (const cb of listeners) cb();
    },
  };
}

function fakeCtx(overrides: object = {}, footerData = fakeFooterData(null)) {
  const footers: (Footer | undefined)[] = [];
  const notices: string[] = [];
  const tui = { renders: 0, requestRender() { this.renders++; } };
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: "/home/me/code/my-project",
    model: { name: "Claude Opus 4.6", provider: "anthropic" },
    ui: {
      // Like pi: dispose the current footer, then install the new one (last writer wins).
      setFooter(factory: ((...args: any[]) => Footer) | undefined) {
        footers.at(-1)?.dispose?.();
        footers.push(factory?.(tui, {}, footerData));
      },
      notify(message: string) {
        notices.push(message);
      },
    },
    ...overrides,
  };
  // Another extension (e.g. pi-powerbar) installing its own footer.
  const takeFooter = () => ctx.ui.setFooter(() => ({ render: () => [], invalidate() {} }));
  return { ctx, tui, footers, notices, takeFooter, footer: () => footers.at(-1) };
}

const NOTICE_DELAY_MS = 1000;

test("session_start in the TUI installs a footer rendering the HUD", async () => {
  const { emit } = fakePi();
  const { ctx, footer } = fakeCtx();
  await emit("session_start", { reason: "startup" }, ctx);
  assert.deepEqual(footer()!.render(80).map(strip), ["[Claude Opus 4.6] │ my-project"]);
});

test("nothing is installed without a TUI", async () => {
  const { emit } = fakePi();
  for (const overrides of [{ hasUI: false }, { mode: "rpc" }, { mode: "print", hasUI: false }]) {
    const { ctx, footers } = fakeCtx(overrides);
    await emit("session_start", { reason: "startup" }, ctx);
    assert.equal(footers.length, 0, JSON.stringify(overrides));
  }
});

test("a model change updates the snapshot and requests a render", async () => {
  const { emit } = fakePi();
  const { ctx, tui, footer } = fakeCtx();
  await emit("session_start", { reason: "startup" }, ctx);
  await emit("model_select", { model: { name: "GPT-5" }, source: "set" }, ctx);
  assert.equal(tui.renders, 1);
  assert.deepEqual(footer()!.render(80).map(strip), ["[GPT-5] │ my-project"]);
});

test("session_shutdown restores pi's footer and later events are ignored", async () => {
  const { emit } = fakePi();
  const { ctx, tui, footers, notices } = fakeCtx();
  await emit("session_start", { reason: "startup" }, ctx);
  await emit("session_shutdown", { reason: "quit" }, ctx);
  assert.equal(footers.length, 2);
  assert.equal(notices.length, 0);
  assert.equal(footers[1], undefined);
  await emit("model_select", { model: { name: "GPT-5" }, source: "set" }, ctx);
  assert.equal(tui.renders, 0);
});

test("a new session ignores the previous session's TUI", async () => {
  const { emit } = fakePi();
  const first = fakeCtx();
  const second = fakeCtx({ cwd: "/work/other" });
  await emit("session_start", { reason: "startup" }, first.ctx);
  await emit("session_start", { reason: "new" }, second.ctx);
  await emit("model_select", { model: { name: "GPT-5" }, source: "set" }, second.ctx);
  assert.equal(first.tui.renders, 0);
  assert.equal(second.tui.renders, 1);
  assert.deepEqual(second.footer()!.render(80).map(strip), ["[GPT-5] │ other"]);
});

test("session_start reads the global and project config files", async () => {
  const cwd = join(mkdtempSync(join(tmpdir(), "pi-hud-cwd-")), "my-repo");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  const globalFile = join(agentDir, "pi-hud-plus.json");
  writeFileSync(globalFile, JSON.stringify({ display: { showModel: false, showProject: false } }));
  writeFileSync(join(cwd, ".pi", "pi-hud-plus.json"), JSON.stringify({ display: { showProject: true } }));
  try {
    const { emit } = fakePi();
    const { ctx, footer } = fakeCtx({ cwd });
    await emit("session_start", { reason: "startup" }, ctx);
    assert.deepEqual(footer()!.render(80).map(strip), ["my-repo"]);

    // Edits apply on the next session_start (/reload), not before.
    writeFileSync(globalFile, "{}");
    assert.deepEqual(footer()!.render(80).map(strip), ["my-repo"]);
    await emit("session_start", { reason: "reload" }, ctx);
    assert.deepEqual(footer()!.render(80).map(strip), ["[Claude Opus 4.6] │ my-repo"]);
  } finally {
    writeFileSync(globalFile, "{}");
  }
});

test("another extension taking the footer displaces the HUD with one notice", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { emit } = fakePi();
  const { ctx, tui, footers, notices, takeFooter } = fakeCtx();
  await emit("session_start", { reason: "startup" }, ctx);
  takeFooter();
  mock.timers.tick(NOTICE_DELAY_MS);
  assert.equal(notices.length, 1);
  assert.match(notices[0]!, /another extension/i);
  assert.match(notices[0]!, /disable/i);

  await emit("model_select", { model: { name: "GPT-5" }, source: "set" }, ctx);
  assert.equal(tui.renders, 0);

  const before = footers.length;
  await emit("session_shutdown", { reason: "quit" }, ctx);
  assert.equal(footers.length, before, "must not wipe the other extension's footer");
});

test("the notice fires once per process across /new and /reload", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { emit } = fakePi();
  const { ctx, footers, notices, takeFooter } = fakeCtx();
  await emit("session_start", { reason: "startup" }, ctx);
  takeFooter();
  mock.timers.tick(NOTICE_DELAY_MS);

  await emit("session_shutdown", { reason: "new" }, ctx);
  await emit("session_start", { reason: "new" }, ctx);
  assert.deepEqual(footers.at(-1)!.render(80).map(strip), ["[Claude Opus 4.6] │ my-project"], "the next session tries setFooter again");
  takeFooter();
  mock.timers.tick(NOTICE_DELAY_MS);

  // /reload re-imports the extension: a fresh instance in the same process.
  await emit("session_shutdown", { reason: "reload" }, ctx);
  const reloaded = fakePi();
  await reloaded.emit("session_start", { reason: "reload" }, ctx);
  takeFooter();
  mock.timers.tick(NOTICE_DELAY_MS);

  assert.equal(notices.length, 1);
});

test("pi resetting the footer on /reload before session_shutdown is not displacement", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { emit } = fakePi();
  const { ctx, footer, notices } = fakeCtx();
  await emit("session_start", { reason: "startup" }, ctx);
  ctx.ui.setFooter(undefined); // pi's resetExtensionUI(), which runs before session_shutdown on /reload
  await emit("session_shutdown", { reason: "reload" }, ctx);
  mock.timers.tick(NOTICE_DELAY_MS);
  assert.equal(notices.length, 0);

  const reloaded = fakePi();
  await reloaded.emit("session_start", { reason: "reload" }, ctx);
  assert.deepEqual(footer()!.render(80).map(strip), ["[Claude Opus 4.6] │ my-project"]);
});

// ---- Git job ----

/** A pi.exec fake: records each git call; while held, calls stay pending until released. */
function fakeExec(stdout = " M file.txt\n") {
  const calls: { args: string[]; cwd?: string; release(): void }[] = [];
  let held = false;
  const exec = (_command: string, args: string[], options?: { cwd?: string }) =>
    new Promise((resolve) => {
      const release = () => resolve({ stdout, stderr: "", code: 0, killed: false, truncated: false });
      calls.push({ args, cwd: options?.cwd, release });
      if (!held) release();
    });
  return { exec, calls, hold: (value: boolean) => (held = value) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const THROTTLE_MS = 2000;
const BACKSTOP_MS = 30_000;

async function gitSetup(opts: { branch?: string | null; cwd?: string } = {}) {
  mock.timers.reset();
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const git = fakeExec();
  const footerData = fakeFooterData(opts.branch === undefined ? "main" : opts.branch);
  const { emit } = fakePi(git.exec);
  const env = fakeCtx({ cwd: opts.cwd ?? "/home/me/code/my-project" }, footerData);
  await emit("session_start", { reason: "startup" }, env.ctx);
  await flush();
  return { ...env, emit, git, footerData };
}

test("session_start runs git status in the cwd and shows the branch and dirty state", async () => {
  const { git, footer } = await gitSetup();
  assert.equal(git.calls.length, 1);
  assert.ok(git.calls[0]!.args.includes("--no-optional-locks") && git.calls[0]!.args.includes("status"));
  assert.equal(git.calls[0]!.cwd, "/home/me/code/my-project");
  assert.deepEqual(footer()!.render(80).map(strip), ["[Claude Opus 4.6] │ my-project git:(main*)"]);
});

test("no git command runs outside a repo or when gitStatus.enabled is false", async () => {
  const outside = await gitSetup({ branch: null });
  assert.equal(outside.git.calls.length, 0);

  const cwd = mkdtempSync(join(tmpdir(), "pi-hud-cwd-"));
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(join(cwd, ".pi", "pi-hud-plus.json"), JSON.stringify({ gitStatus: { enabled: false } }));
  const off = await gitSetup({ cwd });
  off.footerData.changeBranch("dev");
  await off.emit("agent_end", {}, off.ctx);
  mock.timers.tick(BACKSTOP_MS);
  await flush();
  assert.equal(off.git.calls.length, 0);
});

test("triggers during a run are coalesced into one throttled follow-up run", async () => {
  const { git, emit, ctx } = await gitSetup();
  git.hold(true);
  mock.timers.tick(THROTTLE_MS);
  await emit("agent_end", {}, ctx);
  assert.equal(git.calls.length, 2, "a trigger after the throttle window runs at once");
  await emit("tool_execution_end", {}, ctx);
  await emit("tool_execution_end", {}, ctx);
  await emit("agent_end", {}, ctx);
  assert.equal(git.calls.length, 2, "at most one run in flight");

  git.hold(false);
  git.calls[1]!.release();
  await flush();
  mock.timers.tick(THROTTLE_MS - 1);
  await flush();
  assert.equal(git.calls.length, 2, "the follow-up waits for the throttle");
  mock.timers.tick(1);
  await flush();
  assert.equal(git.calls.length, 3, "one follow-up for all coalesced triggers");
});

test("runs are spaced by the throttle", async () => {
  const { git, emit, ctx } = await gitSetup();
  await emit("agent_end", {}, ctx);
  await emit("tool_execution_end", {}, ctx);
  assert.equal(git.calls.length, 1);
  mock.timers.tick(THROTTLE_MS);
  await flush();
  assert.equal(git.calls.length, 2);
});

test("a 30s backstop refreshes git without any trigger", async () => {
  const { git } = await gitSetup();
  mock.timers.tick(BACKSTOP_MS - 1);
  await flush();
  assert.equal(git.calls.length, 1);
  mock.timers.tick(1);
  await flush();
  assert.equal(git.calls.length, 2);
});

test("a branch change refreshes git and shows the new branch", async () => {
  const { git, footerData, footer, tui } = await gitSetup();
  mock.timers.tick(THROTTLE_MS);
  const renders = tui.renders;
  footerData.changeBranch("feature/x");
  await flush();
  assert.equal(git.calls.length, 2);
  assert.ok(tui.renders > renders);
  assert.deepEqual(footer()!.render(80).map(strip), ["[Claude Opus 4.6] │ my-project git:(feature/x*)"]);
});

test("rendering never runs git", async () => {
  const { git, footer } = await gitSetup();
  mock.timers.tick(THROTTLE_MS);
  for (let i = 0; i < 5; i++) footer()!.render(80);
  await flush();
  assert.equal(git.calls.length, 1);
});

test("nothing runs while Displaced or after shutdown", async () => {
  const displaced = await gitSetup();
  displaced.takeFooter();
  displaced.footerData.changeBranch("dev");
  await displaced.emit("agent_end", {}, displaced.ctx);
  mock.timers.tick(BACKSTOP_MS * 2);
  await flush();
  assert.equal(displaced.git.calls.length, 1);
  assert.equal(displaced.footerData.listeners.size, 0, "branch listener unsubscribed");

  const shut = await gitSetup();
  shut.git.hold(true);
  mock.timers.tick(THROTTLE_MS);
  await shut.emit("agent_end", {}, shut.ctx); // in flight across shutdown
  await shut.emit("tool_execution_end", {}, shut.ctx); // pending follow-up
  await shut.emit("session_shutdown", { reason: "quit" }, shut.ctx);
  shut.git.calls[1]!.release();
  shut.footerData.changeBranch("dev");
  mock.timers.tick(BACKSTOP_MS * 2);
  await flush();
  assert.equal(shut.git.calls.length, 2);
  assert.equal(shut.footerData.listeners.size, 0);
});
