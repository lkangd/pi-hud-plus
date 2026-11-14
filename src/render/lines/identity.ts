import type { RenderContext } from "../../types.ts";
import { coloredBar, getContextColor, RESET } from "../colors.ts";
import { progressLabel } from "./label-align.ts";

/** claude-hud's adaptive bar width, keyed on the HUD width instead of the terminal's. */
function barWidth(width: number): number {
  if (width >= 100) return 10;
  if (width >= 60) return 6;
  return 4;
}

/** The context bar and value, shared by the context Line and the compact session Line. */
export function renderContextParts({ snapshot, config, width }: RenderContext): { bar: string; value: string } | null {
  if (!snapshot.context) return null;
  // shortcut: percent only; contextValue modes, token breakdown and `?` for unknown tokens come with the context-bar ticket.
  const { percent } = snapshot.context;
  const thresholds = { warning: config.display.contextWarningThreshold, critical: config.display.contextCriticalThreshold };
  return {
    bar: coloredBar(percent, barWidth(width), config.colors, thresholds),
    value: `${getContextColor(percent, config.colors, thresholds)}${percent}%${RESET}`,
  };
}

export function renderIdentityLine(ctx: RenderContext, alignLabels = false): string | null {
  const parts = renderContextParts(ctx);
  if (!parts) return null;
  const label = progressLabel("label.context", ctx.config.colors, alignLabels);
  return ctx.config.display.showContextBar ? `${label} ${parts.bar} ${parts.value}` : `${label} ${parts.value}`;
}
