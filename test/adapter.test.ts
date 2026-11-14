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

function fakePi(overrides: object = {}) {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    getSessionName: (): string | undefined => undefined,
    ...overrides,
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

/** A session manager over `entries`; push to it to append. */
function fakeSessionManager(entries: object[] = [], startedAt = "2026-05-08T09:14:00.000Z") {
  return {
    entries,
    getEntries: () => [...entries],
    getSessionId: () => "session-1",
    getLeafId: () => (entries.at(-1) as { id?: string } | undefined)?.id ?? null,
    getHeader: () => ({ type: "session", id: "session-1", timestamp: startedAt, cwd: "/" }),
  };
}

function fakeCtx(overrides: object = {}) {
  const footers: (Footer | undefined)[] = [];
  const notices: string[] = [];
  const tui = { renders: 0, requestRender() { this.renders++; } };
  const footerData = {
    getGitBranch: () => null,
    getExtensionStatuses: () => new Map(),
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: "/home/me/code/my-project",
    model: { name: "Claude Opus 4.6", provider: "anthropic", id: "claude-opus-4-6" },
    sessionManager: fakeSessionManager(),
    modelRegistry: { isUsingOAuth: () => false, getProvider: () => undefined },
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

/** A cwd named my-project whose project config file holds `display`. */
function projectWith(display: object): string {
  const cwd = join(mkdtempSync(join(tmpdir(), "pi-hud-cwd-")), "my-project");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "pi-hud-plus.json"), JSON.stringify({ display }));
  return cwd;
}

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number, cost: number) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  totalTokens: input + output + cacheRead + cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
});
let entryId = 0;
const entry = (fields: object, timestamp = "2026-05-08T10:00:00.000Z") => ({ id: `e${++entryId}`, parentId: null, timestamp, ...fields });

test("session tokens and cost sum every usage-bearing entry, like pi's footer", async () => {
  const entries = [
    entry({ type: "usage", kind: "x", provider: "anthropic", model: "m", usage: usage(100, 10, 0, 0, 0.001) }),
    entry({ type: "message", message: { role: "user", content: "hi" } }),
    entry({ type: "message", message: { role: "assistant", usage: usage(1000, 200, 5000, 300, 0.01) } }),
    entry({ type: "message", message: { role: "toolResult", usage: usage(50, 5, 0, 0, 0.0005) } }),
    entry({ type: "message", message: { role: "toolResult" } }),
    entry({ type: "compaction", summary: "", usage: usage(2000, 400, 0, 0, 0.02) }),
    entry({ type: "branch_summary", summary: "" }),
    entry({ type: "custom", usage: usage(9e6, 9e6, 0, 0, 99) }),
  ];
  const { emit } = fakePi();
  const sessionManager = fakeSessionManager(entries);
  const { ctx, tui, footer } = fakeCtx({ cwd: projectWith({ showSessionTokens: true, showCost: true }), sessionManager });
  await emit("session_start", { reason: "startup" }, ctx);
  assert.deepEqual(footer()!.render(120).map(strip), ["[Claude Opus 4.6] │ my-project │ Cost $0.0315", "Tokens 9k (in: 3k, out: 615, cache: 5k)"]);

  // A new reply is picked up when the agent finishes.
  sessionManager.entries.push(entry({ type: "message", message: { role: "assistant", usage: usage(0, 0, 0, 0, 1) } }));
  await emit("agent_end", { messages: [] }, ctx);
  assert.equal(tui.renders, 1);
  assert.deepEqual(footer()!.render(120).map(strip)[0], "[Claude Opus 4.6] │ my-project │ Cost $1.03");
});

test("(sub) follows pi's footer: an OAuth subscription provider, or kimi-coding", async () => {
  const cwd = projectWith({ showCost: true, showModel: false, showProject: false });
  const entries = [entry({ type: "message", message: { role: "assistant", usage: usage(1, 1, 0, 0, 0.5) } })];
  const costFor = async (model: object, modelRegistry: object) => {
    const { emit } = fakePi();
    const { ctx, footer } = fakeCtx({ cwd, model, modelRegistry, sessionManager: fakeSessionManager(entries) });
    await emit("session_start", { reason: "startup" }, ctx);
    return footer()!.render(80).map(strip)[0];
  };
  const claude = { name: "Claude", provider: "anthropic", id: "c" };
  const subscription = { auth: { oauth: { isSubscription: true } } };
  assert.equal(await costFor(claude, { isUsingOAuth: () => true, getProvider: () => subscription }), "Cost $0.500 (sub)");
  assert.equal(await costFor(claude, { isUsingOAuth: () => true, getProvider: () => ({ auth: { oauth: {} } }) }), "Cost $0.500");
  assert.equal(await costFor(claude, { isUsingOAuth: () => false, getProvider: () => subscription }), "Cost $0.500");
  assert.equal(await costFor({ name: "Kimi", provider: "kimi-coding", id: "k" }, { isUsingOAuth: () => false, getProvider: () => undefined }), "Cost $0.500 (sub)");
});

test("start and last reply come from the session header and the latest assistant entry", async () => {
  const startedAt = new Date(2026, 4, 8, 9, 14).toISOString();
  const entries = [
    entry({ type: "message", message: { role: "assistant", usage: usage(1, 1, 0, 0, 0) } }, new Date(2026, 4, 8, 10, 0).toISOString()),
    entry({ type: "message", message: { role: "assistant", usage: usage(1, 1, 0, 0, 0) } }, new Date(2026, 4, 8, 11, 30).toISOString()),
    entry({ type: "message", message: { role: "user", content: "hi" } }, new Date(2026, 4, 8, 11, 40).toISOString()),
  ];
  const { emit } = fakePi();
  const cwd = projectWith({ showSessionStartDate: true, showLastResponseAt: true, timeFormat: "absolute" });
  const { ctx, footer } = fakeCtx({ cwd, sessionManager: fakeSessionManager(entries, startedAt) });
  await emit("session_start", { reason: "startup" }, ctx);
  assert.deepEqual(footer()!.render(120).map(strip)[1], "Started: 2026-05-08 09:14 │ Last reply: 2026-05-08 11:30");
});

test("the session name comes from pi and follows renames", async () => {
  let name: string | undefined = "refactor";
  const { emit } = fakePi({ getSessionName: () => name });
  const { ctx, footer } = fakeCtx({ cwd: projectWith({ showSessionName: true }) });
  await emit("session_start", { reason: "startup" }, ctx);
  assert.deepEqual(footer()!.render(80).map(strip), ["[Claude Opus 4.6] │ my-project │ refactor"]);
  name = "fix-bug";
  await emit("session_info_changed", { name }, ctx);
  assert.deepEqual(footer()!.render(80).map(strip), ["[Claude Opus 4.6] │ my-project │ fix-bug"]);
});

test("speed comes from the streaming reply's output tokens", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1000 });
  const { emit } = fakePi();
  const { ctx, footer } = fakeCtx({ cwd: projectWith({ showSpeed: true, showModel: false, showProject: false }) });
  await emit("session_start", { reason: "startup" }, ctx);
  const streamed = (output: number) => ({ message: { role: "assistant", usage: usage(0, output, 0, 0, 0) }, assistantMessageEvent: { type: "text_delta" } });
  await emit("message_update", streamed(10), ctx);
  assert.deepEqual(footer()!.render(80), []);
  mock.timers.tick(500);
  await emit("message_update", streamed(60), ctx);
  assert.deepEqual(footer()!.render(80).map(strip), ["out: 100.0 tok/s"]);
  // A too-short window has no reading, so the last speed stays.
  await emit("message_update", streamed(70), ctx);
  assert.deepEqual(footer()!.render(80).map(strip), ["out: 100.0 tok/s"]);
});

test("the clock ticks every second only while a ticking Element is on", async () => {
  const start = new Date(2026, 4, 8, 9, 14).getTime();
  mock.timers.enable({ apis: ["setInterval", "Date"], now: start });
  const startedAt = new Date(start).toISOString();
  const display = { showDuration: true, showModel: false, showProject: false };

  const { emit } = fakePi();
  const { ctx, tui, footer } = fakeCtx({ cwd: projectWith(display), sessionManager: fakeSessionManager([], startedAt) });
  await emit("session_start", { reason: "startup" }, ctx);
  assert.deepEqual(footer()!.render(80).map(strip), ["⏱️  <1m"]);
  mock.timers.tick(60_000);
  assert.equal(tui.renders, 60);
  assert.deepEqual(footer()!.render(80).map(strip), ["⏱️  1m"]);

  await emit("session_shutdown", { reason: "quit" }, ctx);
  mock.timers.tick(5000);
  assert.equal(tui.renders, 60, "stops on shutdown");

  // Absolute times don't change with the clock.
  for (const off of [{}, { showSessionStartDate: true, showLastResponseAt: true, timeFormat: "absolute" }]) {
    const idle = fakeCtx({ cwd: projectWith(off), sessionManager: fakeSessionManager([], startedAt) });
    await fakePi().emit("session_start", { reason: "startup" }, idle.ctx);
    mock.timers.tick(5000);
    assert.equal(idle.tui.renders, 0, JSON.stringify(off));
  }

  for (const on of [{ showLastResponseAt: true }, { showSessionStartDate: true, timeFormat: "both" }]) {
    const ticking = fakeCtx({ cwd: projectWith(on), sessionManager: fakeSessionManager([], startedAt) });
    await fakePi().emit("session_start", { reason: "startup" }, ticking.ctx);
    mock.timers.tick(1000);
    assert.equal(ticking.tui.renders, 1, JSON.stringify(on));
  }
});

test("the clock stops while Displaced", async () => {
  mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
  const { emit } = fakePi();
  const { ctx, tui, takeFooter } = fakeCtx({ cwd: projectWith({ showDuration: true }) });
  await emit("session_start", { reason: "startup" }, ctx);
  takeFooter();
  mock.timers.tick(5000);
  assert.equal(tui.renders, 0);
});
