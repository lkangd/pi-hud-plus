import { truncateToWidth } from "@earendil-works/pi-tui";
import type { HudConfig } from "../config.ts";
import { setLanguage } from "../i18n/index.ts";
import type { HudSnapshot } from "../types.ts";
import { model as modelColor, project as projectColor } from "./colors.ts";

/** Render core: pure, no pi imports beyond pi-tui width helpers. */
export function renderHud(snapshot: HudSnapshot, config: HudConfig, width: number): string[] {
  if (width <= 0) return [];
  setLanguage(config.language);
  const colors = config.colors;

  // shortcut: model + last path segment only; the layout ticket ports claude-hud's render/lines and render/index.
  const parts: string[] = [];
  if (config.display.showModel && snapshot.model) parts.push(modelColor(`[${snapshot.model.name}]`, colors));
  const segments = snapshot.cwd.split(/[/\\]/).filter(Boolean);
  if (config.display.showProject) parts.push(projectColor(segments.at(-1) ?? "/", colors));

  return (parts.length ? [parts.join(" │ ")] : []).map((line) => truncateToWidth(line, width, "…"));
}
