import { test } from "node:test";
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

function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const pi = {
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

function fakeCtx(overrides: object = {}) {
  const footers: (Footer | undefined)[] = [];
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
    model: { name: "Claude Opus 4.6", provider: "anthropic" },
    ui: {
      setFooter(factory: ((...args: any[]) => Footer) | undefined) {
        footers.push(factory?.(tui, {}, footerData));
      },
    },
    ...overrides,
  };
  return { ctx, tui, footers, footer: () => footers.at(-1) };
}

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
  const { ctx, tui, footers } = fakeCtx();
  await emit("session_start", { reason: "startup" }, ctx);
  await emit("session_shutdown", { reason: "quit" }, ctx);
  assert.equal(footers.length, 2);
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
