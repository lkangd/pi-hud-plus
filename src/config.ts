import * as fs from "node:fs";
import * as path from "node:path";
import { createDebug } from "./debug.ts";
import type { Language } from "./i18n/types.ts";

export type LineLayoutType = "compact" | "expanded";
export type ContextValueMode = "percent" | "tokens" | "remaining" | "both";
export type UsageValueMode = "percent" | "remaining";
export type GitBranchOverflowMode = "truncate" | "wrap";

/**
 * Controls how the model name is displayed in the HUD badge.
 *
 *   full:    Show the raw display name as-is (e.g. "Opus 4.6 (1M context)")
 *   compact: Strip redundant context-window suffix (e.g. "Opus 4.6")
 *   short:   Strip context suffix AND "Claude " prefix (e.g. "Opus 4.6")
 */
export type ModelFormatMode = "full" | "compact" | "short";
export type TimeFormatMode = "relative" | "absolute" | "both" | "elapsed" | "elapsedAndAbsolute";
export type CustomLinePosition = "first" | "last";
export type HudElement = "project" | "context" | "usage" | "promptCache" | "memory" | "environment" | "tools" | "sessionTime";

export type HudColorName =
  | "dim"
  | "red"
  | "green"
  | "yellow"
  | "magenta"
  | "cyan"
  | "brightBlue"
  | "brightMagenta";

/** A color value: named preset, 256-color index (0-255), or hex string (#rrggbb). */
export type HudColorValue = HudColorName | number | string;

export interface HudColorOverrides {
  context: HudColorValue;
  usage: HudColorValue;
  warning: HudColorValue;
  usageWarning: HudColorValue;
  critical: HudColorValue;
  model: HudColorValue;
  project: HudColorValue;
  git: HudColorValue;
  gitBranch: HudColorValue;
  label: HudColorValue;
  custom: HudColorValue;
  barFilled: string;
  barEmpty: string;
}

export const DEFAULT_ELEMENT_ORDER: HudElement[] = [
  "project",
  "context",
  "usage",
  "promptCache",
  "memory",
  "environment",
  "tools",
  "sessionTime",
];

export const DEFAULT_MERGE_GROUPS: HudElement[][] = [["context", "usage"]];

const KNOWN_ELEMENTS = new Set<HudElement>(DEFAULT_ELEMENT_ORDER);

export interface HudConfig {
  language: Language;
  lineLayout: LineLayoutType;
  showSeparators: boolean;
  pathLevels: 1 | 2 | 3;
  elementOrder: HudElement[];
  /** Shell command whose output is shown as an Extra command Line. "" = off. */
  extraCommand: string;
  gitStatus: {
    enabled: boolean;
    showDirty: boolean;
    showAheadBehind: boolean;
    showFileStats: boolean;
    branchOverflow: GitBranchOverflowMode;
    pushWarningThreshold: number;
    pushCriticalThreshold: number;
  };
  display: {
    showModel: boolean;
    showProject: boolean;
    showContextBar: boolean;
    contextValue: ContextValueMode;
    showConfigCounts: boolean;
    showCost: boolean;
    showDuration: boolean;
    showSpeed: boolean;
    showTokenBreakdown: boolean;
    showUsage: boolean;
    usageValue: UsageValueMode;
    usageBarEnabled: boolean;
    showResetLabel: boolean;
    usageCompact: boolean;
    showTools: boolean;
    toolNameMaxLength: number;
    toolsMaxVisible: number;
    showSessionName: boolean;
    showVersion: boolean;
    showThinkingLevel: boolean;
    showMemoryUsage: boolean;
    showPromptCache: boolean;
    promptCacheTtlSeconds: number;
    showSessionTokens: boolean;
    showSessionStartDate: boolean;
    showLastResponseAt: boolean;
    showExtensionStatuses: boolean;
    mergeGroups: HudElement[][];
    contextWarningThreshold: number;
    contextCriticalThreshold: number;
    usageThreshold: number;
    /** Shows the Weekly part at or above this % used; it gates the Monthly part too. */
    sevenDayThreshold: number;
    environmentThreshold: number;
    /** The External usage snapshot file. "" = off. */
    externalUsagePath: string;
    externalUsageFreshnessMs: number;
    modelFormat: ModelFormatMode;
    modelOverride: string;
    customLine: string;
    customLinePosition: CustomLinePosition;
    timeFormat: TimeFormatMode;
  };
  colors: HudColorOverrides;
}

export const DEFAULT_CONFIG: HudConfig = {
  language: "en",
  lineLayout: "expanded",
  showSeparators: false,
  pathLevels: 1,
  elementOrder: [...DEFAULT_ELEMENT_ORDER],
  extraCommand: "",
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: false,
    showFileStats: false,
    branchOverflow: "truncate",
    pushWarningThreshold: 0,
    pushCriticalThreshold: 0,
  },
  display: {
    showModel: true,
    showProject: true,
    showContextBar: true,
    contextValue: "percent",
    showConfigCounts: false,
    showCost: false,
    showDuration: false,
    showSpeed: false,
    showTokenBreakdown: true,
    showUsage: true,
    usageValue: "percent",
    usageBarEnabled: true,
    showResetLabel: true,
    usageCompact: false,
    showTools: false,
    toolNameMaxLength: 0,
    toolsMaxVisible: 4,
    showSessionName: false,
    showVersion: false,
    showThinkingLevel: false,
    showMemoryUsage: false,
    showPromptCache: false,
    promptCacheTtlSeconds: 300,
    showSessionTokens: false,
    showSessionStartDate: false,
    showLastResponseAt: false,
    showExtensionStatuses: true,
    mergeGroups: DEFAULT_MERGE_GROUPS.map((group) => [...group]),
    contextWarningThreshold: 70,
    contextCriticalThreshold: 85,
    usageThreshold: 0,
    sevenDayThreshold: 80,
    environmentThreshold: 0,
    externalUsagePath: "",
    externalUsageFreshnessMs: 300000,
    modelFormat: "full",
    modelOverride: "",
    customLine: "",
    customLinePosition: "last",
    timeFormat: "relative",
  },
  colors: {
    context: "green",
    usage: "brightBlue",
    warning: "yellow",
    usageWarning: "brightMagenta",
    critical: "red",
    model: "cyan",
    project: "yellow",
    git: "magenta",
    gitBranch: "cyan",
    label: "dim",
    custom: 208,
    barFilled: "█",
    barEmpty: "░",
  },
};

export type Raw = Record<string, unknown>;

export function isObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

const COLOR_NAMES: readonly HudColorName[] = ["dim", "red", "green", "yellow", "magenta", "cyan", "brightBlue", "brightMagenta"];
// Stricter than sanitize(): a bar glyph is rejected, not stripped, if any codepoint is a control, format, variation selector or unassigned.
const UNSAFE_CODEPOINT = /[\p{Cc}\p{Cf}\p{Variation_Selector}\p{Zl}\p{Zp}\p{Cn}]/u;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function validateBarChar(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  if (Array.from(segmenter.segment(value)).length !== 1) return false;

  for (const ch of value) {
    if (UNSAFE_CODEPOINT.test(ch)) return false;
  }
  return true;
}

function validateColorValue(value: unknown): value is HudColorValue {
  if (COLOR_NAMES.includes(value as HudColorName)) return true;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) return true;
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

function validateElementOrder(value: unknown): HudElement[] {
  if (!Array.isArray(value)) return [...DEFAULT_ELEMENT_ORDER];
  const elementOrder = [...new Set(value.filter((item): item is HudElement => KNOWN_ELEMENTS.has(item)))];
  return elementOrder.length > 0 ? elementOrder : [...DEFAULT_ELEMENT_ORDER];
}

function validateMergeGroups(value: unknown): HudElement[][] {
  if (!Array.isArray(value)) return DEFAULT_MERGE_GROUPS.map((group) => [...group]);
  if (value.length === 0) return [];

  const usedElements = new Set<HudElement>();
  const mergeGroups: HudElement[][] = [];

  for (const group of value) {
    if (!Array.isArray(group)) continue;
    const normalizedGroup = [
      ...new Set(group.filter((item): item is HudElement => KNOWN_ELEMENTS.has(item) && !usedElements.has(item))),
    ];
    if (normalizedGroup.length >= 2) {
      normalizedGroup.forEach((element) => usedElements.add(element));
      mergeGroups.push(normalizedGroup);
    }
  }

  return mergeGroups.length > 0 ? mergeGroups : DEFAULT_MERGE_GROUPS.map((group) => [...group]);
}

function validateThreshold(value: unknown, max = 100): number {
  if (typeof value !== "number") return 0;
  return Math.max(0, Math.min(max, value));
}

function validateContextThreshold(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, value));
}

function validateCountThreshold(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function validateDurationSeconds(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function validateNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return fallback;
  return value;
}

function validateFreshnessMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CONFIG.display.externalUsageFreshnessMs;
  return Math.max(0, Math.floor(value));
}

function truncatedString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.slice(0, 80) : fallback;
}

/** Validates a parsed user config field by field. Invalid values fall back to the field's default; unknown fields are dropped. */
export function mergeConfig(userConfig: unknown): HudConfig {
  const user = isObject(userConfig) ? userConfig : {};
  const git = isObject(user.gitStatus) ? user.gitStatus : {};
  const display = isObject(user.display) ? user.display : {};
  const colors = isObject(user.colors) ? user.colors : {};
  const D = DEFAULT_CONFIG;

  const color = (key: Exclude<keyof HudColorOverrides, "barFilled" | "barEmpty">) =>
    validateColorValue(colors[key]) ? colors[key] : D.colors[key];
  const barChar = (key: "barFilled" | "barEmpty") => (validateBarChar(colors[key]) ? colors[key] : D.colors[key]);
  const displayBool = (key: { [K in keyof HudConfig["display"]]: HudConfig["display"][K] extends boolean ? K : never }[keyof HudConfig["display"]]) =>
    bool(display[key], D.display[key]);

  return {
    language: user.language === "zh" ? "zh-Hans" : oneOf(user.language, ["en", "zh-Hans"] as const, D.language),
    lineLayout: oneOf(user.lineLayout, ["compact", "expanded"] as const, D.lineLayout),
    showSeparators: bool(user.showSeparators, D.showSeparators),
    pathLevels: oneOf(user.pathLevels, [1, 2, 3] as const, D.pathLevels),
    elementOrder: validateElementOrder(user.elementOrder),
    extraCommand: typeof user.extraCommand === "string" ? user.extraCommand : D.extraCommand,
    gitStatus: {
      enabled: bool(git.enabled, D.gitStatus.enabled),
      showDirty: bool(git.showDirty, D.gitStatus.showDirty),
      showAheadBehind: bool(git.showAheadBehind, D.gitStatus.showAheadBehind),
      showFileStats: bool(git.showFileStats, D.gitStatus.showFileStats),
      branchOverflow: oneOf(git.branchOverflow, ["truncate", "wrap"] as const, D.gitStatus.branchOverflow),
      pushWarningThreshold: validateCountThreshold(git.pushWarningThreshold),
      pushCriticalThreshold: validateCountThreshold(git.pushCriticalThreshold),
    },
    display: {
      showModel: displayBool("showModel"),
      showProject: displayBool("showProject"),
      showContextBar: displayBool("showContextBar"),
      contextValue: oneOf(display.contextValue, ["percent", "tokens", "remaining", "both"] as const, D.display.contextValue),
      showConfigCounts: displayBool("showConfigCounts"),
      showCost: displayBool("showCost"),
      showDuration: displayBool("showDuration"),
      showSpeed: displayBool("showSpeed"),
      showTokenBreakdown: displayBool("showTokenBreakdown"),
      showUsage: displayBool("showUsage"),
      usageValue: oneOf(display.usageValue, ["percent", "remaining"] as const, D.display.usageValue),
      usageBarEnabled: displayBool("usageBarEnabled"),
      showResetLabel: displayBool("showResetLabel"),
      usageCompact: displayBool("usageCompact"),
      showTools: displayBool("showTools"),
      toolNameMaxLength: validateNonNegativeInteger(display.toolNameMaxLength, D.display.toolNameMaxLength),
      toolsMaxVisible: validateNonNegativeInteger(display.toolsMaxVisible, D.display.toolsMaxVisible),
      showSessionName: displayBool("showSessionName"),
      showVersion: displayBool("showVersion"),
      showThinkingLevel: displayBool("showThinkingLevel"),
      showMemoryUsage: displayBool("showMemoryUsage"),
      showPromptCache: displayBool("showPromptCache"),
      promptCacheTtlSeconds: validateDurationSeconds(display.promptCacheTtlSeconds, D.display.promptCacheTtlSeconds),
      showSessionTokens: displayBool("showSessionTokens"),
      showSessionStartDate: displayBool("showSessionStartDate"),
      showLastResponseAt: displayBool("showLastResponseAt"),
      showExtensionStatuses: displayBool("showExtensionStatuses"),
      mergeGroups: validateMergeGroups(display.mergeGroups),
      contextWarningThreshold: validateContextThreshold(display.contextWarningThreshold, D.display.contextWarningThreshold),
      contextCriticalThreshold: validateContextThreshold(display.contextCriticalThreshold, D.display.contextCriticalThreshold),
      usageThreshold: validateThreshold(display.usageThreshold, 100),
      // claude-hud's validateThreshold turns an absent key into 0 too, against its documented default of 80.
      sevenDayThreshold: display.sevenDayThreshold === undefined ? D.display.sevenDayThreshold : validateThreshold(display.sevenDayThreshold, 100),
      environmentThreshold: validateThreshold(display.environmentThreshold, 100),
      externalUsagePath: typeof display.externalUsagePath === "string" ? display.externalUsagePath.trim() : "",
      externalUsageFreshnessMs: validateFreshnessMs(display.externalUsageFreshnessMs),
      modelFormat: oneOf(display.modelFormat, ["full", "compact", "short"] as const, D.display.modelFormat),
      modelOverride: truncatedString(display.modelOverride, D.display.modelOverride),
      customLine: truncatedString(display.customLine, D.display.customLine),
      customLinePosition: oneOf(display.customLinePosition, ["first", "last"] as const, D.display.customLinePosition),
      timeFormat: oneOf(
        display.timeFormat,
        ["relative", "absolute", "both", "elapsed", "elapsedAndAbsolute"] as const,
        D.display.timeFormat,
      ),
    },
    colors: {
      context: color("context"),
      usage: color("usage"),
      warning: color("warning"),
      usageWarning: color("usageWarning"),
      critical: color("critical"),
      model: color("model"),
      project: color("project"),
      git: color("git"),
      gitBranch: color("gitBranch"),
      label: color("label"),
      custom: color("custom"),
      barFilled: barChar("barFilled"),
      barEmpty: barChar("barEmpty"),
    },
  };
}

/** Objects merge recursively; arrays and scalars from `override` replace. */
export function deepMerge(base: Raw, override: Raw): Raw {
  const merged: Raw = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] = isObject(value) && isObject(current) ? deepMerge(current, value) : value;
  }
  return merged;
}

const debug = createDebug("config");

/** Missing, unreadable, unparseable or non-object files count as empty so the HUD still renders. */
function readJsonObject(file: string): Raw {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (isObject(parsed)) return parsed;
    debug(`Ignoring ${file}: not a JSON object`);
    return {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") debug(`Failed to read ${file}:`, error);
    return {};
  }
}

/** Reads `<agentDir>/pi-hud-plus.json`, the only config file (see docs/adr/0001-global-config-only.md). */
export function loadConfig(agentDir: string): HudConfig {
  return mergeConfig(readJsonObject(path.join(agentDir, "pi-hud-plus.json")));
}
