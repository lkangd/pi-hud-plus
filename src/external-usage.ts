import * as fs from "node:fs";
import type { HudConfig } from "./config.ts";
import { sanitize } from "./sanitize.ts";
import type { UsageLimit } from "./types.ts";

/** Ported from claude-hud's external-usage (read side). The file another tool writes, in claude-hud's format. */
interface ExternalUsageSnapshot {
  five_hour?: { used_percentage?: unknown; resets_at?: unknown } | null;
  seven_day?: { used_percentage?: unknown; resets_at?: unknown } | null;
  updated_at?: unknown;
  balance_label?: unknown;
}

const MAX_BALANCE_LABEL_LENGTH = 50;

function parseUsagePercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(100, Math.max(0, value)));
}

/** claude-hud's balance_label sanitising: escape sequences out, then control and bidi characters, cut to 50. */
function sanitizeBalanceLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sanitized = sanitize(
    value
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, "")
      .replace(/\x1B[@-Z\\-_]/g, ""),
  ).trim();
  if (!sanitized) return null;
  return sanitized.length <= MAX_BALANCE_LABEL_LENGTH ? sanitized : `${sanitized.slice(0, MAX_BALANCE_LABEL_LENGTH - 3)}...`;
}

/** A number above 1e12 is epoch ms, otherwise epoch seconds; strings go through Date. */
function parseDateValue(value: unknown): Date | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    const date = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** The External usage snapshot at `display.externalUsagePath`, or null when off, missing, stale or malformed. A small sync read. */
export function getUsageFromExternalSnapshot(config: HudConfig, now = Date.now()): UsageLimit | null {
  const snapshotPath = config.display.externalUsagePath;
  if (!snapshotPath) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as ExternalUsageSnapshot;
    const updatedAt = parseDateValue(parsed.updated_at)?.getTime();
    if (updatedAt === undefined || now - updatedAt > config.display.externalUsageFreshnessMs) return null;

    const fiveHour = parseUsagePercent(parsed.five_hour?.used_percentage);
    const sevenDay = parseUsagePercent(parsed.seven_day?.used_percentage);
    const balanceLabel = sanitizeBalanceLabel(parsed.balance_label);
    if (fiveHour === null && sevenDay === null && balanceLabel === null) return null;

    const fiveHourResetAt = parseDateValue(parsed.five_hour?.resets_at);
    const sevenDayResetAt = parseDateValue(parsed.seven_day?.resets_at);
    // An unparseable reset rejects the whole snapshot, as in claude-hud.
    if (parsed.five_hour && parsed.five_hour.resets_at != null && fiveHourResetAt === null) return null;
    if (parsed.seven_day && parsed.seven_day.resets_at != null && sevenDayResetAt === null) return null;

    const usage: UsageLimit = { fiveHour, sevenDay, monthly: null, fiveHourResetAt, sevenDayResetAt, monthlyResetAt: null };
    if (balanceLabel !== null) usage.balanceLabel = balanceLabel;
    return usage;
  } catch {
    return null;
  }
}
