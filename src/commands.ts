import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, getSelectListTheme, getSettingsListTheme, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Input, SelectList, SettingsList, type Component, type SettingItem } from "@earendil-works/pi-tui";
import { sanitize } from "./sanitize.ts";
import { DEFAULT_CONFIG, deepMerge, isObject, mergeConfig, type HudConfig, type Raw } from "./config.ts";

/** The guided settings, keyed by settings-list row id; every value is the row's display string. */
type Values = Record<string, string>;

const TOGGLES: [key: keyof HudConfig["display"], label: string][] = [
  ["showTools", "Tools activity"],
  ["showProject", "Project"],
  ["showConfigCounts", "Environment line"],
  ["showTokenBreakdown", "Token breakdown"],
  ["showSpeed", "Output speed"],
  ["showDuration", "Session duration"],
  ["showSessionName", "Session name"],
  ["showSessionTokens", "Session tokens"],
  ["showCost", "Cost"],
  ["showThinkingLevel", "Thinking level"],
  ["showVersion", "Version"],
  ["showMemoryUsage", "Memory"],
  ["showPromptCache", "Prompt cache"],
  ["showExtensionStatuses", "Extension statuses"],
  ["showSessionStartDate", "Session start date"],
  ["showLastResponseAt", "Last response time"],
];

const LAYOUTS = ["expanded", "compact", "compact+separators"];
const LANGUAGES = ["en", "zh-Hans"];
// claude-hud's Git Style Mapping, plus off.
const GIT_STYLES: Record<string, Partial<HudConfig["gitStatus"]>> = {
  off: { enabled: false },
  branch: { enabled: true, showDirty: false, showAheadBehind: false, showFileStats: false },
  "branch+dirty": { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false },
  full: { enabled: true, showDirty: true, showAheadBehind: true, showFileStats: false },
  "file stats": { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: true },
};
const PRESET_NAMES = ["Full", "Essential", "Minimal"];

/** The settings-list rows in display order; rows with `values` cycle through them. */
const ROWS: { id: string; label: string; values?: string[] }[] = [
  { id: "layout", label: "Layout", values: LAYOUTS },
  { id: "language", label: "Language", values: LANGUAGES },
  { id: "git", label: "Git", values: Object.keys(GIT_STYLES) },
  ...TOGGLES.map(([id, label]) => ({ id, label, values: ["on", "off"] })),
  { id: "customLine", label: "Custom line" },
];
const RESET_ROW = "Reset to preset";

function gitStyle(git: HudConfig["gitStatus"]): string {
  if (!git.enabled) return "off";
  if (git.showFileStats) return "file stats";
  if (git.showAheadBehind) return "full";
  return git.showDirty ? "branch+dirty" : "branch";
}

function valuesFrom(config: HudConfig): Values {
  return {
    layout: config.lineLayout === "compact" ? (config.showSeparators ? "compact+separators" : "compact") : "expanded",
    language: config.language,
    git: gitStyle(config.gitStatus),
    ...Object.fromEntries(TOGGLES.map(([key]) => [key, config.display[key] ? "on" : "off"])),
    customLine: config.display.customLine,
  };
}

/** A Preset's rows: the Elements and git style, never layout, language or the Custom line. */
function preset(name: string): Values {
  const minimal = valuesFrom(DEFAULT_CONFIG);
  delete minimal.layout;
  delete minimal.language;
  delete minimal.customLine;
  if (name === "Full") return { ...minimal, ...Object.fromEntries(TOGGLES.map(([key]) => [key, "on"])) };
  if (name === "Essential") return { ...minimal, showTools: "on", showDuration: "on", showExtensionStatuses: "on" };
  return minimal;
}

/** Only rows that changed are written, so a value the guided rows can't express (e.g. separators in expanded) survives. */
function toPatch(before: Values, after: Values): Raw {
  const display: Raw = {};
  const patch: Raw = { display };
  for (const { id } of ROWS) {
    const value = after[id]!;
    if (value === before[id]) continue;
    if (id === "layout") Object.assign(patch, { lineLayout: value === "expanded" ? "expanded" : "compact", showSeparators: value === "compact+separators" });
    else if (id === "language") patch.language = value;
    else if (id === "git") patch.gitStatus = GIT_STYLES[value];
    else if (id === "customLine") display.customLine = value;
    else display[id] = value === "on";
  }
  if (!Object.keys(display).length) delete patch.display;
  return patch;
}

function changes(before: Values, after: Values): string[] {
  const shown = (value: string) => value || "(none)";
  return ROWS.filter(({ id }) => before[id] !== after[id]).map(({ id, label }) => `${label}: ${shown(before[id]!)} → ${shown(after[id]!)}`);
}

/** A one-line text prompt; Enter closes with the sanitized text, Esc closes without a value. */
function textInput(title: string, close: (value?: string) => void): Component {
  const input = new Input();
  input.onSubmit = (value) => close(sanitize(value).trim().slice(0, 80));
  input.onEscape = () => close();
  return {
    render: (width) => [title, ...input.render(width)],
    invalidate: () => input.invalidate(),
    handleInput: (data) => input.handleInput(data),
  };
}

function editValues(ctx: ExtensionCommandContext, start: Values): Promise<Values | undefined> {
  return ctx.ui.custom<Values | undefined>((tui, theme, _kb, done) => {
    const values = { ...start };
    const items: SettingItem[] = ROWS.map((row) => ({ ...row, currentValue: values[row.id]! }));
    items.find((item) => item.id === "customLine")!.submenu = (_current, close) => textInput("Custom line (empty removes it, Esc keeps it):", close);
    items.push({
      id: RESET_ROW,
      label: RESET_ROW,
      currentValue: "",
      description: "Set every Element row and Git to a Preset's values; layout, language and the Custom line stay.",
      submenu: (_current, close) => {
        const presets = new SelectList(PRESET_NAMES.map((name) => ({ value: name, label: name })), PRESET_NAMES.length, getSelectListTheme());
        presets.onSelect = ({ value }) => {
          for (const [id, presetValue] of Object.entries(preset(value))) {
            values[id] = presetValue;
            list.updateValue(id, presetValue);
          }
          close();
        };
        presets.onCancel = () => close();
        return presets;
      },
    });
    const list = new SettingsList(
      items,
      Math.min(items.length, 15),
      getSettingsListTheme(),
      (id, value) => (values[id] = value),
      () => done(values),
    );
    return {
      // The list's own hint says "Esc to cancel"; here Esc ends editing and the save is confirmed next.
      render: (width: number) => [theme.fg("accent", theme.bold("pi-hud-plus · Esc when done, then confirm to save")), "", ...list.render(width)],
      invalidate: () => list.invalidate(),
      handleInput(data: string) {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

/** The file's object, `{}` if it doesn't exist, or undefined if it holds anything else (so it's never overwritten). */
function readRaw(file: string): Raw | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? {} : undefined;
  }
  return isObject(parsed) ? parsed : undefined;
}

/** setup (`fromScratch`), or configure: edit the current values, or start over from a Preset when there's no file yet. */
async function guidedConfig(ctx: ExtensionCommandContext, fromScratch: boolean): Promise<void> {
  const file = path.join(getAgentDir(), "pi-hud-plus.json");
  const broken = `pi-hud-plus: ${file} isn't a JSON object. Fix or delete it, then run the command again.`;
  const raw = readRaw(file);
  if (!raw) return ctx.ui.notify(broken, "error");
  const before = valuesFrom(mergeConfig(raw));
  let start = before;
  if (fromScratch || !fs.existsSync(file)) {
    const overwrite = "Start over from a Preset? Colors, thresholds and other fields the list doesn't show are kept.";
    if (fs.existsSync(file) && !(await ctx.ui.confirm("Overwrite pi-hud-plus config?", overwrite))) return;
    const layout = await ctx.ui.select("HUD layout", LAYOUTS);
    if (!layout) return;
    const name = await ctx.ui.select("Starting Preset", PRESET_NAMES);
    if (!name) return;
    const language = await ctx.ui.select("HUD language", LANGUAGES);
    if (!language) return;
    start = { ...before, ...preset(name), layout, language, customLine: "" };
  }
  const after = await editValues(ctx, start);
  if (!after) return;
  const summary = changes(before, after);
  if (!summary.length) return ctx.ui.notify("No changes", "info");
  if (!(await ctx.ui.confirm("Save pi-hud-plus config?", summary.join("\n")))) return;
  // Re-read: the file may have been edited while the list was open.
  const latest = readRaw(file);
  if (!latest) return ctx.ui.notify(broken, "error");
  fs.writeFileSync(file, JSON.stringify(deepMerge(latest, toPatch(before, after)), null, 2) + "\n");
  await ctx.reload();
}

export function registerCommands(pi: ExtensionAPI): void {
  const commands = {
    "pi-hud:setup": ["Set up the HUD: layout, Preset, language, then Elements", true],
    "pi-hud:configure": ["Change the HUD's Elements, layout and language", false],
  } as const;
  for (const [name, [description, fromScratch]] of Object.entries(commands)) {
    pi.registerCommand(name, {
      description,
      handler: async (_args, ctx) => {
        // Same guard as the footer: the settings list needs pi's TUI.
        if (!ctx.hasUI || ctx.mode !== "tui") return ctx.ui.notify(`pi-hud-plus: /${name} needs pi's interactive UI.`, "error");
        await guidedConfig(ctx, fromScratch);
      },
    });
  }
}
