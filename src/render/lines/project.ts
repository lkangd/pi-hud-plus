import type { RenderContext } from "../../types.ts";
import { custom as customColor, model as modelColor, project as projectColor } from "../colors.ts";
import { renderCost, renderSessionName, renderSpeed } from "./session-stats.ts";
import { renderDuration } from "./session-time.ts";

// eslint-disable-next-line no-control-regex
const CONTROL_AND_BIDI_PATTERN = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u206A-\u206F]/g;

/** Strips control and bidi characters so untrusted text (paths, a project config) can't inject escape codes. */
export function sanitize(value: string): string {
  return value.replace(CONTROL_AND_BIDI_PATTERN, "");
}

/** The `[model]` badge, shared by the project Line and the compact session Line. */
export function renderModelBadge({ snapshot, config }: RenderContext): string | null {
  if (!config.display.showModel || !snapshot.model) return null;
  return modelColor(`[${snapshot.model.name}]`, config.colors);
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
  // Git goes after the path, version and the Extra command after the session name, in claude-hud's order.
  const parts = [
    renderModelBadge(ctx),
    renderProjectPath(ctx),
    renderSessionName(ctx),
    renderDuration(ctx),
    renderCost(ctx),
    renderSpeed(ctx),
  ].filter((part) => part !== null);
  const withCustom = withCustomLine(parts, ctx);
  return withCustom.length > 0 ? withCustom.join(" │ ") : null;
}
