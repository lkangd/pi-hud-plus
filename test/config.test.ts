// Ported from claude-hud's tests/config.test.js, minus dropped fields (maxWidth, usage, agents, todos, ...) and legacy migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, mergeConfig, DEFAULT_CONFIG, DEFAULT_ELEMENT_ORDER } from "../src/config.ts";

test("mergeConfig({}) returns the defaults", () => {
  assert.deepEqual(mergeConfig({}), DEFAULT_CONFIG);
});

test("mergeConfig tolerates non-object input", () => {
  for (const value of [null, undefined, 5, "x", []]) assert.deepEqual(mergeConfig(value), DEFAULT_CONFIG);
});

test("default display toggles match claude-hud's minus dropped fields", () => {
  const { display, gitStatus } = mergeConfig({});
  for (const key of ["showModel", "showProject", "showContextBar", "showTokenBreakdown", "showExtensionStatuses"] as const) {
    assert.equal(display[key], true, key);
  }
  for (const key of [
    "showConfigCounts", "showCost", "showDuration", "showSpeed", "showTools", "showVersion", "showThinkingLevel",
    "showMemoryUsage", "showPromptCache", "showSessionTokens", "showSessionName", "showSessionStartDate", "showLastResponseAt",
  ] as const) {
    assert.equal(display[key], false, key);
  }
  assert.equal(gitStatus.enabled, true);
  assert.equal(gitStatus.showDirty, true);
  assert.equal(gitStatus.showAheadBehind, false);
  assert.equal(gitStatus.showFileStats, false);
});

test("top-level defaults", () => {
  const config = mergeConfig({});
  assert.equal(config.language, "en");
  assert.equal(config.lineLayout, "expanded");
  assert.equal(config.showSeparators, false);
  assert.equal(config.pathLevels, 1);
  assert.equal(config.extraCommand, "");
});

test("dropped fields are not part of the config", () => {
  const config = mergeConfig({ maxWidth: 50, forceMaxWidth: true, display: { showUsage: true, showAgents: true } }) as any;
  assert.equal(config.maxWidth, undefined);
  assert.equal(config.forceMaxWidth, undefined);
  assert.equal(config.display.showUsage, undefined);
  assert.equal(config.display.showAgents, undefined);
  assert.equal(config.colors.usage, undefined);
});

test("unknown fields are ignored silently", () => {
  assert.deepEqual(mergeConfig({ banana: 1, display: { banana: true }, colors: { banana: "red" } }), DEFAULT_CONFIG);
});

test("renamed fields: showVersion and showThinkingLevel, with no aliases", () => {
  assert.equal(mergeConfig({ display: { showVersion: true } }).display.showVersion, true);
  assert.equal(mergeConfig({ display: { showThinkingLevel: true } }).display.showThinkingLevel, true);
  const old = mergeConfig({ display: { showClaudeCodeVersion: true, showEffortLevel: true } });
  assert.equal(old.display.showVersion, false);
  assert.equal(old.display.showThinkingLevel, false);
});

test("extraCommand keeps strings and falls back to empty otherwise", () => {
  assert.equal(mergeConfig({ extraCommand: "echo hi" }).extraCommand, "echo hi");
  assert.equal(mergeConfig({ extraCommand: 42 }).extraCommand, "");
});

test("showExtensionStatuses accepts booleans only", () => {
  assert.equal(mergeConfig({ display: { showExtensionStatuses: false } }).display.showExtensionStatuses, false);
  assert.equal(mergeConfig({ display: { showExtensionStatuses: "no" } }).display.showExtensionStatuses, true);
});

test("booleans keep explicit values and fall back to the default otherwise", () => {
  const config = mergeConfig({
    showSeparators: true,
    gitStatus: { enabled: false, showAheadBehind: true },
    display: { showModel: false, showSessionName: true, showMemoryUsage: true, showPromptCache: true, showCost: true, showProject: "no" },
  });
  assert.equal(config.showSeparators, true);
  assert.equal(config.gitStatus.enabled, false);
  assert.equal(config.gitStatus.showAheadBehind, true);
  assert.equal(config.display.showModel, false);
  assert.equal(config.display.showSessionName, true);
  assert.equal(config.display.showMemoryUsage, true);
  assert.equal(config.display.showPromptCache, true);
  assert.equal(config.display.showCost, true);
  assert.equal(config.display.showProject, true);
});

test("language accepts en, zh and zh-Hans only, canonicalising zh to zh-Hans", () => {
  assert.equal(mergeConfig({ language: "zh" }).language, "zh-Hans");
  assert.equal(mergeConfig({ language: "zh-Hans" }).language, "zh-Hans");
  assert.equal(mergeConfig({ language: "fr" }).language, "en");
});

test("lineLayout and pathLevels fall back on invalid values", () => {
  assert.equal(mergeConfig({ lineLayout: "compact" }).lineLayout, "compact");
  assert.equal(mergeConfig({ lineLayout: "wide" }).lineLayout, "expanded");
  assert.equal(mergeConfig({ pathLevels: 3 }).pathLevels, 3);
  assert.equal(mergeConfig({ pathLevels: 4 }).pathLevels, 1);
});

test("mergeConfig defaults promptCacheTtlSeconds to 300", () => {
  assert.equal(mergeConfig({}).display.promptCacheTtlSeconds, 300);
});

test("mergeConfig preserves valid promptCacheTtlSeconds values", () => {
  assert.equal(mergeConfig({ display: { promptCacheTtlSeconds: 3600 } }).display.promptCacheTtlSeconds, 3600);
});

test("mergeConfig falls back to default promptCacheTtlSeconds for invalid values", () => {
  assert.equal(mergeConfig({ display: { promptCacheTtlSeconds: 0 } }).display.promptCacheTtlSeconds, 300);
  assert.equal(mergeConfig({ display: { promptCacheTtlSeconds: -1 } }).display.promptCacheTtlSeconds, 300);
  assert.equal(mergeConfig({ display: { promptCacheTtlSeconds: "fast" } }).display.promptCacheTtlSeconds, 300);
});

test("tool display limits accept non-negative integers only", () => {
  assert.equal(mergeConfig({}).display.toolNameMaxLength, 0);
  assert.equal(mergeConfig({}).display.toolsMaxVisible, 4);
  assert.equal(mergeConfig({ display: { toolsMaxVisible: 2 } }).display.toolsMaxVisible, 2);
  assert.equal(mergeConfig({ display: { toolsMaxVisible: -1 } }).display.toolsMaxVisible, 4);
  assert.equal(mergeConfig({ display: { toolNameMaxLength: 1.5 } }).display.toolNameMaxLength, 0);
});

test("environmentThreshold clamps to 0-100", () => {
  assert.equal(mergeConfig({}).display.environmentThreshold, 0);
  assert.equal(mergeConfig({ display: { environmentThreshold: 150 } }).display.environmentThreshold, 100);
  assert.equal(mergeConfig({ display: { environmentThreshold: "x" } }).display.environmentThreshold, 0);
});

test("mergeConfig defaults git push thresholds to disabled", () => {
  const config = mergeConfig({});
  assert.equal(config.gitStatus.branchOverflow, "truncate");
  assert.equal(config.gitStatus.pushWarningThreshold, 0);
  assert.equal(config.gitStatus.pushCriticalThreshold, 0);
});

test("mergeConfig preserves explicit git push thresholds", () => {
  const config = mergeConfig({ gitStatus: { pushWarningThreshold: 15, pushCriticalThreshold: 30 } });
  assert.equal(config.gitStatus.pushWarningThreshold, 15);
  assert.equal(config.gitStatus.pushCriticalThreshold, 30);
});

test("mergeConfig defaults context thresholds to 70/85", () => {
  const config = mergeConfig({});
  assert.equal(config.display.contextWarningThreshold, 70);
  assert.equal(config.display.contextCriticalThreshold, 85);
});

test("mergeConfig preserves explicit context thresholds", () => {
  const config = mergeConfig({ display: { contextWarningThreshold: 30, contextCriticalThreshold: 50 } });
  assert.equal(config.display.contextWarningThreshold, 30);
  assert.equal(config.display.contextCriticalThreshold, 50);
});

test("mergeConfig clamps context thresholds to 0-100", () => {
  const config = mergeConfig({ display: { contextWarningThreshold: -10, contextCriticalThreshold: 150 } });
  assert.equal(config.display.contextWarningThreshold, 0);
  assert.equal(config.display.contextCriticalThreshold, 100);
});

test("mergeConfig falls back to defaults for invalid context thresholds", () => {
  const config = mergeConfig({ display: { contextWarningThreshold: "high", contextCriticalThreshold: null } });
  assert.equal(config.display.contextWarningThreshold, 70);
  assert.equal(config.display.contextCriticalThreshold, 85);
});

test("mergeConfig preserves valid git branch overflow modes", () => {
  assert.equal(mergeConfig({ gitStatus: { branchOverflow: "wrap" } }).gitStatus.branchOverflow, "wrap");
  assert.equal(mergeConfig({ gitStatus: { branchOverflow: "truncate" } }).gitStatus.branchOverflow, "truncate");
});

test("mergeConfig falls back to truncate for invalid git branch overflow values", () => {
  assert.equal(mergeConfig({ gitStatus: { branchOverflow: "full" } }).gitStatus.branchOverflow, "truncate");
  assert.equal(mergeConfig({ gitStatus: { branchOverflow: null } }).gitStatus.branchOverflow, "truncate");
});

test("mergeConfig preserves customLine and truncates long values", () => {
  const customLine = "x".repeat(120);
  assert.equal(mergeConfig({ display: { customLine } }).display.customLine, customLine.slice(0, 80));
});

test("customLinePosition defaults to last and falls back on invalid values", () => {
  assert.equal(mergeConfig({}).display.customLinePosition, "last");
  assert.equal(mergeConfig({ display: { customLinePosition: "first" } }).display.customLinePosition, "first");
  assert.equal(mergeConfig({ display: { customLinePosition: "middle" } }).display.customLinePosition, "last");
});

test("timeFormat defaults to relative and falls back on invalid values", () => {
  assert.equal(mergeConfig({}).display.timeFormat, "relative");
  assert.equal(mergeConfig({ display: { timeFormat: "elapsedAndAbsolute" } }).display.timeFormat, "elapsedAndAbsolute");
  assert.equal(mergeConfig({ display: { timeFormat: "soon" } }).display.timeFormat, "relative");
});

test("mergeConfig defaults modelFormat to full", () => {
  assert.equal(mergeConfig({}).display.modelFormat, "full");
});

test("mergeConfig preserves valid modelFormat values", () => {
  assert.equal(mergeConfig({ display: { modelFormat: "compact" } }).display.modelFormat, "compact");
  assert.equal(mergeConfig({ display: { modelFormat: "short" } }).display.modelFormat, "short");
  assert.equal(mergeConfig({ display: { modelFormat: "full" } }).display.modelFormat, "full");
});

test("mergeConfig falls back to full for invalid modelFormat", () => {
  assert.equal(mergeConfig({ display: { modelFormat: "invalid" } }).display.modelFormat, "full");
  assert.equal(mergeConfig({ display: { modelFormat: 123 } }).display.modelFormat, "full");
  assert.equal(mergeConfig({ display: { modelFormat: null } }).display.modelFormat, "full");
});

test("mergeConfig preserves modelOverride and truncates long values", () => {
  assert.equal(mergeConfig({}).display.modelOverride, "");
  const override = "x".repeat(120);
  assert.equal(mergeConfig({ display: { modelOverride: override } }).display.modelOverride, override.slice(0, 80));
});

test("mergeConfig falls back to empty for non-string modelOverride", () => {
  assert.equal(mergeConfig({ display: { modelOverride: 123 } }).display.modelOverride, "");
  assert.equal(mergeConfig({ display: { modelOverride: null } }).display.modelOverride, "");
  assert.equal(mergeConfig({ display: { modelOverride: true } }).display.modelOverride, "");
});

test("contextValue accepts percent, tokens, remaining and both", () => {
  assert.equal(mergeConfig({}).display.contextValue, "percent");
  for (const value of ["tokens", "remaining", "both"]) {
    assert.equal(mergeConfig({ display: { contextValue: value } }).display.contextValue, value);
  }
  assert.equal(mergeConfig({ display: { contextValue: "invalid-mode" } }).display.contextValue, "percent");
});

test("elementOrder defaults to the surviving Elements", () => {
  assert.deepEqual(mergeConfig({}).elementOrder, [
    "project", "context", "promptCache", "memory", "environment", "tools", "sessionTime",
  ]);
  assert.deepEqual(DEFAULT_ELEMENT_ORDER, mergeConfig({}).elementOrder);
});

test("mergeGroups defaults to none", () => {
  assert.deepEqual(mergeConfig({}).display.mergeGroups, []);
});

test("mergeConfig preserves explicit empty mergeGroups to disable merged lines", () => {
  assert.deepEqual(mergeConfig({ display: { mergeGroups: [] } }).display.mergeGroups, []);
});

test("mergeConfig accepts valid mergeGroups and filters invalid entries", () => {
  const config = mergeConfig({
    display: {
      mergeGroups: [
        ["project", "context", "usage"],
        ["tools", "todos", "tools", "sessionTime"],
        ["memory"],
        ["agents", "unknown", "environment", "context", "promptCache"],
      ],
    },
  });
  assert.deepEqual(config.display.mergeGroups, [
    ["project", "context"],
    ["tools", "sessionTime"],
    ["environment", "promptCache"],
  ]);
});

test("mergeConfig falls back to default mergeGroups when value is invalid", () => {
  assert.deepEqual(mergeConfig({ display: { mergeGroups: "context,usage" } }).display.mergeGroups, []);
  assert.deepEqual(mergeConfig({ display: { mergeGroups: [["context"], ["unknown"]] } }).display.mergeGroups, []);
  assert.deepEqual(mergeConfig({ display: { mergeGroups: [null] } }).display.mergeGroups, []);
});

test("mergeConfig preserves valid custom elementOrder", () => {
  const order = ["tools", "project", "memory", "context", "environment"];
  assert.deepEqual(mergeConfig({ elementOrder: order }).elementOrder, order);
});

test("mergeConfig filters unknown and dropped entries and de-duplicates elementOrder", () => {
  const config = mergeConfig({
    elementOrder: ["project", "agents", "project", "banana", "usage", "memory", "tools", "context"],
  });
  assert.deepEqual(config.elementOrder, ["project", "memory", "tools", "context"]);
});

test("mergeConfig falls back to default when elementOrder is empty or invalid", () => {
  assert.deepEqual(mergeConfig({ elementOrder: [] }).elementOrder, DEFAULT_ELEMENT_ORDER);
  assert.deepEqual(mergeConfig({ elementOrder: ["unknown"] }).elementOrder, DEFAULT_ELEMENT_ORDER);
  assert.deepEqual(mergeConfig({ elementOrder: "project" }).elementOrder, DEFAULT_ELEMENT_ORDER);
});

test("mergeConfig defaults colors to expected semantic palette", () => {
  assert.deepEqual(mergeConfig({}).colors, {
    context: "green",
    warning: "yellow",
    critical: "red",
    model: "cyan",
    project: "yellow",
    git: "magenta",
    gitBranch: "cyan",
    label: "dim",
    custom: 208,
    barFilled: "█",
    barEmpty: "░",
  });
});

test("mergeConfig accepts valid color overrides and filters invalid values", () => {
  const config = mergeConfig({
    colors: {
      context: "cyan",
      warning: "brightBlue",
      critical: "not-a-color",
      model: 214,
      project: "#33ff00",
      git: "cyan",
      gitBranch: "not-a-color",
      label: "dim",
      custom: "#ff6600",
    },
  });
  assert.equal(config.colors.context, "cyan");
  assert.equal(config.colors.warning, "brightBlue");
  assert.equal(config.colors.critical, DEFAULT_CONFIG.colors.critical);
  assert.equal(config.colors.model, 214);
  assert.equal(config.colors.project, "#33ff00");
  assert.equal(config.colors.git, "cyan");
  assert.equal(config.colors.gitBranch, DEFAULT_CONFIG.colors.gitBranch);
  assert.equal(config.colors.label, "dim");
  assert.equal(config.colors.custom, "#ff6600");
});

test("mergeConfig accepts 256-color index values", () => {
  const config = mergeConfig({ colors: { context: 82, warning: 220, critical: 196, label: 250 } });
  assert.equal(config.colors.context, 82);
  assert.equal(config.colors.warning, 220);
  assert.equal(config.colors.critical, 196);
  assert.equal(config.colors.label, 250);
});

test("mergeConfig accepts hex color strings", () => {
  const config = mergeConfig({ colors: { context: "#33ff00", warning: "#ff87d7", label: "#ABCDEF" } });
  assert.equal(config.colors.context, "#33ff00");
  assert.equal(config.colors.warning, "#ff87d7");
  assert.equal(config.colors.label, "#ABCDEF");
});

test("mergeConfig rejects invalid 256-color indices", () => {
  const config = mergeConfig({ colors: { context: 256, model: -1, warning: 1.5 } });
  assert.equal(config.colors.context, DEFAULT_CONFIG.colors.context);
  assert.equal(config.colors.model, DEFAULT_CONFIG.colors.model);
  assert.equal(config.colors.warning, DEFAULT_CONFIG.colors.warning);
});

test("mergeConfig rejects invalid hex strings", () => {
  const config = mergeConfig({ colors: { context: "#fff", model: "#gggggg", warning: "ff0000" } });
  assert.equal(config.colors.context, DEFAULT_CONFIG.colors.context);
  assert.equal(config.colors.model, DEFAULT_CONFIG.colors.model);
  assert.equal(config.colors.warning, DEFAULT_CONFIG.colors.warning);
});

const barFilled = (value: unknown) => mergeConfig({ colors: { barFilled: value } }).colors.barFilled;

test("mergeConfig accepts single-grapheme bar chars", () => {
  for (const ch of ["●", "○", "🟢", "中", "★"]) assert.equal(barFilled(ch), ch);
  const config = mergeConfig({ colors: { barFilled: "●", barEmpty: "○" } });
  assert.equal(config.colors.barEmpty, "○");
});

test("mergeConfig rejects unsafe or multi-grapheme bar chars", () => {
  const rejected = [
    "\n", "\x1b", "\x80", "\x9f", // control
    "ab", "##", "", // not one grapheme
    "\u202e", "\u200e", "\u200f", "\u202a", "\u202b", "\u202c", "\u202d", "\u2066", "\u2069", // bidi
    "\u200b", "\u200c", "\u200d", "\ufeff", // zero-width
    "\ufe00", "\ufe0f", String.fromCodePoint(0xe0100), // variation selectors
    "\u00ad", "\u061c", "\u2060", // other format chars
    "\u{1F468}\u200d\u{1F469}\u200d\u{1F467}\u200d\u{1F466}", // ZWJ sequence
    "a\u202e", "\u2b50\ufe0f", // invisible code points attached
    "\u2028", "\u2029", // line/paragraph separators
    "\ufdd0", "\ufffe", "\uffff", // noncharacters
    123, true,
  ];
  for (const value of rejected) assert.equal(barFilled(value), DEFAULT_CONFIG.colors.barFilled, JSON.stringify(value));
});

test("mergeConfig independently validates barFilled and barEmpty", () => {
  const config = mergeConfig({ colors: { barFilled: "█", barEmpty: "\u202e" } });
  assert.equal(config.colors.barFilled, "█");
  assert.equal(config.colors.barEmpty, DEFAULT_CONFIG.colors.barEmpty);
});

// --- loadConfig: only the global <agentDir>/pi-hud-plus.json ---

function configDirs(global?: unknown, project?: unknown) {
  const root = mkdtempSync(join(tmpdir(), "pi-hud-config-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "repo");
  mkdirSync(agentDir);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  const write = (file: string, value: unknown) =>
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  if (global !== undefined) write(join(agentDir, "pi-hud-plus.json"), global);
  if (project !== undefined) write(join(cwd, ".pi", "pi-hud-plus.json"), project);
  return { cwd, agentDir };
}

test("loadConfig with no files returns the defaults", () => {
  const { cwd, agentDir } = configDirs();
  assert.deepEqual(loadConfig(agentDir), DEFAULT_CONFIG);
});

test("loadConfig reads the global file", () => {
  const { cwd, agentDir } = configDirs({ lineLayout: "compact", display: { showSpeed: true } });
  const config = loadConfig(agentDir);
  assert.equal(config.lineLayout, "compact");
  assert.equal(config.display.showSpeed, true);
});

test("a project file is ignored, including its extraCommand", () => {
  const { cwd, agentDir } = configDirs({ extraCommand: "date" }, { extraCommand: "rm -rf ~", display: { showSpeed: true } });
  const config = loadConfig(agentDir);
  assert.equal(config.extraCommand, "date");
  assert.equal(config.display.showSpeed, false);
});

test("a file that does not parse is treated as empty", () => {
  const broken = configDirs("{ not json");
  assert.deepEqual(loadConfig(broken.agentDir), DEFAULT_CONFIG);
  const notObject = configDirs([1, 2]);
  assert.deepEqual(loadConfig(notObject.agentDir), DEFAULT_CONFIG);
});
