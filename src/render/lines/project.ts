import type { ModelFormatMode } from "../../config.ts";
import type { RenderContext, ThinkingLevel } from "../../types.ts";
import { custom as customColor, label as labelColor, model as modelColor, project as projectColor } from "../colors.ts";
import { renderGitPart, withGit } from "./git.ts";
import { renderCost, renderSessionName, renderSpeed } from "./session-stats.ts";
import { renderDuration } from "./session-time.ts";

// eslint-disable-next-line no-control-regex
const CONTROL_AND_BIDI_PATTERN = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u206A-\u206F]/g;

/** Strips control and bidi characters so untrusted text (paths, a project config) can't inject escape codes. */
export function sanitize(value: string): string {
  return value.replace(CONTROL_AND_BIDI_PATTERN, "");
}

const THINKING_SYMBOLS: Partial<Record<ThinkingLevel, string>> = {
  minimal: "○",
  low: "○",
  medium: "◔",
  high: "◑",
  xhigh: "◕",
  max: "◕",
};

/** The `[model]` badge, shared by the project Line and the compact session Line. */
export function renderModelBadge({ snapshot, config }: RenderContext): string | null {
  if (!config.display.showModel || !snapshot.model) return null;
  const { name, provider } = snapshot.model;
  let badge = (provider ? `${provider}/` : "") + formatModelName(name, config.display.modelFormat, config.display.modelOverride);
  const level = snapshot.thinkingLevel;
  const symbol = level && THINKING_SYMBOLS[level];
  if (config.display.showThinkingLevel && symbol) badge += ` ${symbol} ${level}`;
  // modelOverride can come from an untrusted project config.
  return modelColor(`[${sanitize(badge)}]`, config.colors);
}

/** claude-hud's formatModelName: override wins; compact strips a "(… context)" suffix; short also strips "Claude ". */
function formatModelName(name: string, format: ModelFormatMode, override: string): string {
  if (override) return override;
  if (format === "full") return name;
  const compact = name.replace(/\s*\([^)]*\bcontext\b[^)]*\)/i, "").trim();
  return format === "short" ? compact.replace(/^Claude\s+/i, "") : compact;
}

/** `pi vX`, shared by the project Line and the compact session Line. */
export function renderVersion({ snapshot, config }: RenderContext): string | null {
  if (!config.display.showVersion || !snapshot.version) return null;
  return labelColor(`pi v${snapshot.version}`, config.colors);
}

/** The Extra command's label, already sanitized by runExtraCmd. */
export function renderExtraLabel({ snapshot, config }: RenderContext): string | null {
  return snapshot.extraLabel ? labelColor(snapshot.extraLabel, config.colors) : null;
}

/** The cwd trimmed to `pathLevels` segments. */
export function renderProjectPath({ snapshot, config }: RenderContext): string | null {
  if (!config.display.showProject || !snapshot.cwd) return null;
  // Split on both / and \ but always join with /.
  const segments = snapshot.cwd.split(/[/\\]/).filter(Boolean);
  const projectPath = segments.length > 0 ? segments.slice(-config.pathLevels).join("/") : "/";
  return projectColor(sanitize(projectPath), config.colors);
}

/** Adds the Custom line before or after a Line's parts, per `customLinePosition`. */
export function withCustomLine(parts: string[], { config }: RenderContext): string[] {
  const { customLine, customLinePosition } = config.display;
  if (!customLine) return parts;
  const custom = customColor(sanitize(customLine), config.colors);
  return customLinePosition === "first" ? [custom, ...parts] : [...parts, custom];
}

export function renderProjectLine(ctx: RenderContext): string | null {
  const parts = [
    renderModelBadge(ctx),
    ...withGit(renderProjectPath(ctx), renderGitPart(ctx), ctx.config),
    renderSessionName(ctx),
    renderVersion(ctx),
    renderExtraLabel(ctx),
    renderDuration(ctx),
    renderCost(ctx),
    renderSpeed(ctx),
  ].filter((part) => part !== null);
  const withCustom = withCustomLine(parts, ctx);
  return withCustom.length > 0 ? withCustom.join(" │ ") : null;
}
