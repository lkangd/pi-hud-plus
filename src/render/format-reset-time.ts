import type { TimeFormatMode } from "../config.ts";
import { t } from "../i18n/index.ts";

/**
 * claude-hud's reset time for a Limit window, against `now` (the snapshot's clock) instead of `new Date()`.
 * relative `2h 30m`, absolute `at 14:30` (date added on another day), anything else both: `2h 30m, at 14:30`.
 * Empty when the reset is unknown or past.
 */
export function formatResetTime(resetAt: Date | null, mode: TimeFormatMode = "relative", now: number = Date.now()): string {
  if (!resetAt) return "";

  const diffMs = resetAt.getTime() - now;
  if (diffMs <= 0) return "";

  if (mode === "relative") return formatRelative(diffMs);

  const absolute = formatAbsolute(resetAt, new Date(now));
  if (mode === "absolute") return absolute;

  // A comma, not parentheses: callers wrap the result in their own (...).
  return `${formatRelative(diffMs)}, ${absolute}`;
}

function formatRelative(diffMs: number): string {
  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatAbsolute(resetAt: Date, now: Date): string {
  // Locales that bake the preposition into format.resets (zh: 重置于) set format.at to "".
  const at = t("format.at");
  const prefix = at ? `${at} ` : "";
  const timeStr = resetAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (resetAt.toDateString() === now.toDateString()) return `${prefix}${timeStr}`;

  const dateStr = resetAt.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${prefix}${dateStr} ${timeStr}`;
}
