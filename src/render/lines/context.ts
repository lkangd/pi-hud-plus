import type { ContextValueMode } from "../../config.ts";
import type { HudContext, RenderContext } from "../../types.ts";
import { t } from "../../i18n/index.ts";
import { coloredBar, getContextColor, label, RESET } from "../colors.ts";
import { formatTokens } from "./session-stats.ts";

/** claude-hud's adaptive bar width, keyed on the HUD width instead of the terminal's. */
export function barWidth(width: number): number {
  if (width >= 100) return 10;
  if (width >= 60) return 6;
  return 4;
}

function formatContextValue({ tokens, window }: HudContext, percent: number, mode: ContextValueMode): string {
  if (tokens === null) return "?";
  if (mode === "tokens") return window > 0 ? `${formatTokens(tokens)}/${formatTokens(window)}` : formatTokens(tokens);
  if (mode === "both") return window > 0 ? `${percent}% (${formatTokens(tokens)}/${formatTokens(window)})` : `${percent}%`;
  if (mode === "remaining") return `${Math.max(0, 100 - percent)}%`;
  return `${percent}%`;
}

/** The context bar and value, shared by the context Line and the compact session Line. */
export function renderContextParts({ snapshot, config, width }: RenderContext): { bar: string; value: string } | null {
  const context = snapshot.context;
  if (!context) return null;
  const percent = Math.min(100, Math.round(context.percent ?? 0));
  const thresholds = { warning: config.display.contextWarningThreshold, critical: config.display.contextCriticalThreshold };
  const value = formatContextValue(context, percent, config.display.contextValue);
  const { breakdown } = context;
  const showBreakdown = breakdown && config.display.showTokenBreakdown && percent >= thresholds.critical;
  return {
    bar: coloredBar(percent, barWidth(width), config.colors, thresholds),
    value:
      `${getContextColor(percent, config.colors, thresholds)}${value}${RESET}` +
      (showBreakdown
        ? label(` (${t("format.in")}: ${formatTokens(breakdown.input)}, ${t("format.cache")}: ${formatTokens(breakdown.cache)})`, config.colors)
        : ""),
  };
}

export function renderContextLine(ctx: RenderContext): string | null {
  const parts = renderContextParts(ctx);
  if (!parts) return null;
  const name = label(t("label.context"), ctx.config.colors);
  return ctx.config.display.showContextBar ? `${name} ${parts.bar} ${parts.value}` : `${name} ${parts.value}`;
}
