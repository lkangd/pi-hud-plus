import type { HudColorOverrides, TimeFormatMode, UsageValueMode } from "../config.ts";
import { t } from "../i18n/index.ts";
import type { RenderContext } from "../types.ts";
import { critical, label, quotaBar } from "./colors.ts";
import { formatResetTime } from "./format-reset-time.ts";
import { barWidth } from "./lines/context.ts";
import { formatUsagePercent, isLimitReached, limitResetAt, shownLongWindows } from "./lines/usage.ts";
import { renderEnvironmentLine } from "./lines/environment.ts";
import { renderContextParts } from "./lines/context.ts";
import { renderCompactGitPart, withGit } from "./lines/git.ts";
import { renderExtraLabel, renderModelBadge, renderProjectPath, renderVersion, withCustomLine } from "./lines/project.ts";
import { renderCost, renderSessionName, renderSessionTokensPart, renderSpeed } from "./lines/session-stats.ts";
import { renderDuration, renderSessionTimeLine } from "./lines/session-time.ts";
import { renderPromptCacheLine } from "./lines/prompt-cache.ts";

/** The compact layout's single Line: model badge + context bar, project, then the other Elements inline. */
export function renderSessionLine(ctx: RenderContext): string | null {
  const parts: string[] = [];

  const context = renderContextParts(ctx);
  const head = [
    renderModelBadge(ctx),
    context && ctx.config.display.showContextBar ? context.bar : null,
    context?.value ?? null,
  ].filter((part) => part !== null);
  if (head.length > 0) parts.push(head.join(" "));

  parts.push(...withGit(renderProjectPath(ctx), renderCompactGitPart(ctx), ctx.config));
  // Config counts go before the session tokens, prompt cache after the times
  // and the Extra command after speed, in claude-hud's order.
  for (const part of [
    renderSessionName(ctx),
    renderVersion(ctx),
    renderEnvironmentLine(ctx),
    ...renderUsageParts(ctx),
    renderSessionTokensPart(ctx),
    renderDuration(ctx),
    renderSessionTimeLine(ctx),
    renderPromptCacheLine(ctx),
    renderCost(ctx),
    renderSpeed(ctx),
    renderExtraLabel(ctx),
  ]) {
    if (part) parts.push(part);
  }

  const withCustom = withCustomLine(parts, ctx);
  return withCustom.length > 0 ? withCustom.join(" | ") : null;
}

type Colors = Partial<HudColorOverrides>;

/**
 * claude-hud's session-line copy of the usage display, quirks kept: it passes timeFormat straight to formatResetTime
 * (elapsed modes read as both), the weekly-only and limit-reached parts carry no Usage label, and bar mode shows
 * `(2h / 5h)`. Monthly follows Weekly as in the usage Line.
 */
function renderUsageParts({ snapshot, config, width }: RenderContext): string[] {
  const { display, colors } = config;
  const usage = snapshot.usageLimit;
  if (!display.showUsage || !usage) return [];

  const now = snapshot.now ?? Date.now();
  const { timeFormat, showResetLabel, usageCompact, usageValue: usageValueMode } = display;
  const resetsKey = timeFormat === "absolute" ? "format.resets" : "format.resetsIn";

  if (usage.balanceLabel) return [`${label(t("label.usage"), colors)} ${usage.balanceLabel}`];

  if (isLimitReached(usage)) {
    const resetTime = formatResetTime(limitResetAt(usage), timeFormat, now);
    if (usageCompact) return [critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ""}`, colors)];
    const resetSuffix = resetTime ? (showResetLabel ? ` (${t(resetsKey)} ${resetTime})` : ` (${resetTime})`) : "";
    return [critical(`⚠ ${t("status.limitReached")}${resetSuffix}`, colors)];
  }

  const { fiveHour, sevenDay } = usage;
  if (Math.max(fiveHour ?? 0, sevenDay ?? 0) < display.usageThreshold) return [];

  const longParts = shownLongWindows(usage, display.sevenDayThreshold);

  if (usageCompact) {
    return [
      fiveHour !== null ? formatCompactWindowPart("5h", fiveHour, usage.fiveHourResetAt, timeFormat, now, colors, usageValueMode) : null,
      ...longParts.map((w) => formatCompactWindowPart(w.short, w.percent, w.resetAt, timeFormat, now, colors, usageValueMode)),
    ].filter((part) => part !== null);
  }

  const common = { colors, usageBarEnabled: display.usageBarEnabled, barWidth: barWidth(width), timeFormat, now, showResetLabel, usageValueMode };
  const longPart = (w: (typeof longParts)[number]) =>
    formatUsageWindowPart({ ...common, label: t(w.key), percent: w.percent, resetAt: w.resetAt, forceLabel: true });

  if (fiveHour === null && longParts.length > 0) return longParts.map(longPart);

  const fiveHourPart = formatUsageWindowPart({ ...common, label: "5h", percent: fiveHour, resetAt: usage.fiveHourResetAt });
  return [`${label(t("label.usage"), colors)} ${fiveHourPart}`, ...longParts.map(longPart)];
}

function formatCompactWindowPart(
  windowLabel: string,
  percent: number | null,
  resetAt: Date | null,
  timeFormat: TimeFormatMode,
  now: number,
  colors?: Colors,
  usageValueMode: UsageValueMode = "percent",
): string {
  const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
  const reset = formatResetTime(resetAt, timeFormat, now);
  const styledLabel = label(`${windowLabel}:`, colors);
  return reset ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}` : `${styledLabel} ${usageDisplay}`;
}

function formatUsageWindowPart({
  label: windowLabel,
  percent,
  resetAt,
  colors,
  usageBarEnabled,
  barWidth,
  timeFormat,
  now,
  showResetLabel,
  forceLabel = false,
  usageValueMode,
}: {
  label: string;
  percent: number | null;
  resetAt: Date | null;
  colors?: Colors;
  usageBarEnabled: boolean;
  barWidth: number;
  timeFormat: TimeFormatMode;
  now: number;
  showResetLabel: boolean;
  forceLabel?: boolean;
  usageValueMode: UsageValueMode;
}): string {
  const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
  const reset = formatResetTime(resetAt, timeFormat, now);
  const styledLabel = label(windowLabel, colors);
  // "resets in X" for relative/both; "resets X" for absolute (avoids "resets in at 14:30").
  const resetsKey = timeFormat === "absolute" ? "format.resets" : "format.resetsIn";

  if (usageBarEnabled) {
    // Relative keeps claude-hud's "(duration / window)"; other modes use the preposition form.
    const barReset =
      timeFormat === "relative" ? (reset ? `${reset} / ${windowLabel}` : null) : reset ? (showResetLabel ? `${t(resetsKey)} ${reset}` : reset) : null;
    const bar = quotaBar(percent ?? 0, barWidth, colors);
    const body = barReset ? `${bar} ${usageDisplay} (${barReset})` : `${bar} ${usageDisplay}`;
    return forceLabel ? `${styledLabel} ${body}` : body;
  }

  const resetSuffix = reset ? (showResetLabel ? `(${t(resetsKey)} ${reset})` : `(${reset})`) : "";
  return resetSuffix ? `${styledLabel} ${usageDisplay} ${resetSuffix}` : `${styledLabel} ${usageDisplay}`;
}
