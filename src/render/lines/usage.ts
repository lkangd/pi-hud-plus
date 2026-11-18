import type { HudColorOverrides, TimeFormatMode, UsageValueMode } from "../../config.ts";
import { t } from "../../i18n/index.ts";
import type { RenderContext, UsageLimit } from "../../types.ts";
import { critical, getQuotaColor, label, quotaBar, RESET } from "../colors.ts";
import { formatResetTime } from "../format-reset-time.ts";
import { barWidth } from "./context.ts";

const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// GLM's monthly pool is a calendar month; 30 days is close enough for the elapsed share.
const MONTHLY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type Colors = Partial<HudColorOverrides>;

/** claude-hud's isLimitReached, with the monthly window. */
export function isLimitReached(usage: UsageLimit): boolean {
  return usage.fiveHour === 100 || usage.sevenDay === 100 || usage.monthly === 100;
}

/** The full window's reset, 5h first, as claude-hud picks it. */
export function limitResetAt(usage: UsageLimit): Date | null {
  if (usage.fiveHour === 100) return usage.fiveHourResetAt;
  if (usage.sevenDay === 100) return usage.sevenDayResetAt;
  return usage.monthlyResetAt;
}

/** The windows after 5h, in display order, with their compact labels. */
export function longWindows(usage: UsageLimit) {
  return [
    { key: "label.weekly", short: "7d", percent: usage.sevenDay, resetAt: usage.sevenDayResetAt, windowMs: SEVEN_DAY_WINDOW_MS },
    { key: "label.monthly", short: "mo", percent: usage.monthly, resetAt: usage.monthlyResetAt, windowMs: MONTHLY_WINDOW_MS },
  ] as const;
}

/**
 * The long windows to show after 5h: each one at or above sevenDayThreshold. With no 5h window the first
 * long window is always shown, as claude-hud's weekly-only form.
 */
export function shownLongWindows(usage: UsageLimit, sevenDayThreshold: number) {
  const present = longWindows(usage).filter((w) => w.percent !== null);
  return present.filter((w, i) => (usage.fiveHour === null && i === 0) || w.percent! >= sevenDayThreshold);
}

export function formatUsagePercent(percent: number | null, colors?: Colors, mode: UsageValueMode = "percent"): string {
  if (percent === null) return label("--", colors);
  const color = getQuotaColor(percent, colors);
  const displayPercent = mode === "remaining" ? Math.max(0, 100 - percent) : percent;
  return `${color}${displayPercent}%${RESET}`;
}

/** Ported from claude-hud's render/lines/usage. Its label alignment is not ported (pi-hud-plus doesn't align labels). */
export function renderUsageLine({ snapshot, config, width }: RenderContext): string | null {
  const { display, colors } = config;
  const usage = snapshot.usageLimit;
  if (!display.showUsage || !usage) return null;

  const now = snapshot.now ?? Date.now();
  const usageLabel = label(t("label.usage"), colors);

  if (usage.balanceLabel) return `${usageLabel} ${usage.balanceLabel}`;

  const { timeFormat, showResetLabel, usageCompact, usageValue: usageValueMode } = display;
  const resetsKey = limitResetTimeFormat(timeFormat) === "absolute" ? "format.resets" : "format.resetsIn";

  if (isLimitReached(usage)) {
    const resetTime = formatResetTime(limitResetAt(usage), limitResetTimeFormat(timeFormat), now);
    if (usageCompact) return critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ""}`, colors);
    const resetSuffix = resetTime ? (showResetLabel ? ` (${t(resetsKey)} ${resetTime})` : ` (${resetTime})`) : "";
    return `${usageLabel} ${critical(`⚠ ${t("status.limitReached")}${resetSuffix}`, colors)}`;
  }

  const { fiveHour, sevenDay } = usage;
  if (Math.max(fiveHour ?? 0, sevenDay ?? 0) < display.usageThreshold) return null;

  const longParts = shownLongWindows(usage, display.sevenDayThreshold);

  if (usageCompact) {
    const parts = [
      fiveHour !== null ? formatCompactWindowPart("5h", fiveHour, usage.fiveHourResetAt, FIVE_HOUR_WINDOW_MS, timeFormat, now, colors, usageValueMode) : null,
      ...longParts.map((w) => formatCompactWindowPart(w.short, w.percent, w.resetAt, w.windowMs, timeFormat, now, colors, usageValueMode)),
    ].filter((part) => part !== null);
    return parts.length > 0 ? parts.join(" | ") : null;
  }

  const common = { colors, usageBarEnabled: display.usageBarEnabled, barWidth: barWidth(width), timeFormat, now, showResetLabel, usageValueMode };
  const longPart = (w: (typeof longParts)[number]) =>
    formatUsageWindowPart({ ...common, label: t(w.key), percent: w.percent, resetAt: w.resetAt, windowMs: w.windowMs, forceLabel: true });

  // No 5h window but a long one: claude-hud's weekly-only form (or monthly-only).
  if (fiveHour === null && longParts.length > 0) return `${usageLabel} ${longParts.map(longPart).join(" | ")}`;

  const fiveHourPart = formatUsageWindowPart({ ...common, label: "5h", percent: fiveHour, resetAt: usage.fiveHourResetAt, windowMs: FIVE_HOUR_WINDOW_MS });
  return [`${usageLabel} ${fiveHourPart}`, ...longParts.map(longPart)].join(" | ");
}

function formatCompactWindowPart(
  windowLabel: string,
  percent: number | null,
  resetAt: Date | null,
  windowMs: number,
  timeFormat: TimeFormatMode,
  now: number,
  colors?: Colors,
  usageValueMode: UsageValueMode = "percent",
): string {
  const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
  const reset = formatWindowTime(resetAt, windowMs, timeFormat, now);
  const styledLabel = label(`${windowLabel}:`, colors);
  return reset ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}` : `${styledLabel} ${usageDisplay}`;
}

function formatUsageWindowPart({
  label: windowLabel,
  percent,
  resetAt,
  windowMs,
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
  windowMs: number;
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
  const reset = formatWindowTime(resetAt, windowMs, timeFormat, now);
  const styledLabel = label(windowLabel, colors);
  const showResetWording = timeFormat !== "elapsed" && timeFormat !== "elapsedAndAbsolute";
  const resetsKey = timeFormat === "absolute" ? "format.resets" : "format.resetsIn";

  const resetSuffix = reset ? (showResetLabel && showResetWording ? `(${t(resetsKey)} ${reset})` : `(${reset})`) : "";

  if (usageBarEnabled) {
    const bar = quotaBar(percent ?? 0, barWidth, colors);
    const body = resetSuffix ? `${bar} ${usageDisplay} ${resetSuffix}` : `${bar} ${usageDisplay}`;
    return forceLabel ? `${styledLabel} ${body}` : body;
  }

  return resetSuffix ? `${styledLabel} ${usageDisplay} ${resetSuffix}` : `${styledLabel} ${usageDisplay}`;
}

function limitResetTimeFormat(timeFormat: TimeFormatMode): "relative" | "absolute" | "both" {
  if (timeFormat === "elapsedAndAbsolute") return "absolute";
  if (timeFormat === "elapsed") return "relative";
  return timeFormat;
}

function formatWindowTime(resetAt: Date | null, windowMs: number, timeFormat: TimeFormatMode, now: number): string {
  if (timeFormat === "elapsed") return formatElapsedWindow(resetAt, windowMs, now);

  if (timeFormat === "elapsedAndAbsolute") {
    const elapsed = formatElapsedWindow(resetAt, windowMs, now);
    const absolute = formatResetTime(resetAt, "absolute", now);
    return elapsed && absolute ? `${elapsed}, ${absolute}` : elapsed || absolute;
  }

  return formatResetTime(resetAt, timeFormat, now);
}

function formatElapsedWindow(resetAt: Date | null, windowMs: number, now: number): string {
  if (!resetAt) return "";
  const windowStart = resetAt.getTime() - windowMs;
  const elapsed = Math.max(0, Math.min(100, Math.round(((now - windowStart) / windowMs) * 100)));
  return `${elapsed}% elapsed`;
}
