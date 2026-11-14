import type { TimeFormatMode } from "../../config.ts";
import { getCanonicalLanguage, t } from "../../i18n/index.ts";
import type { RenderContext } from "../../types.ts";
import { label } from "../colors.ts";

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatAbsolute(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRelativeTime(ms: number): string {
  if (ms < 0) return t("format.justNow");

  const withAgo = (value: string): string => {
    const ago = t("format.ago");
    return getCanonicalLanguage() === "zh-Hans" ? `${value}${ago}` : `${value} ${ago}`;
  };

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return withAgo(`${seconds}s`);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return withAgo(`${minutes}m`);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return withAgo(remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`);
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return withAgo(remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`);
}

/** A past time in `timeFormat`. For past times the "elapsed" modes read the same as relative. */
function formatTime(ms: number, now: number, mode: TimeFormatMode): string {
  if (mode === "absolute") return formatAbsolute(ms);
  const relative = formatRelativeTime(now - ms);
  return mode === "both" || mode === "elapsedAndAbsolute" ? `${relative}, ${formatAbsolute(ms)}` : relative;
}

/** claude-hud's `formatSessionDuration`. */
export function formatSessionDuration(startedAt: number, now: number): string {
  const mins = Math.floor((now - startedAt) / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function renderDuration({ snapshot, config }: RenderContext): string | null {
  const startedAt = snapshot.session?.startedAt;
  if (!config.display.showDuration || startedAt === undefined) return null;
  return label(`⏱️  ${formatSessionDuration(startedAt, snapshot.now ?? Date.now())}`, config.colors);
}

/** The sessionTime Element: "started" and "last reply" in `timeFormat`. */
export function renderSessionTimeLine({ snapshot, config }: RenderContext): string | null {
  const { showSessionStartDate, showLastResponseAt, timeFormat } = config.display;
  const { colors } = config;
  const now = snapshot.now ?? Date.now();
  const parts: string[] = [];

  const startedAt = snapshot.session?.startedAt;
  if (showSessionStartDate && startedAt !== undefined) {
    parts.push(`${label(`${t("label.sessionStarted")}:`, colors)} ${formatTime(startedAt, now, timeFormat)}`);
  }
  const lastReplyAt = snapshot.session?.lastReplyAt;
  if (showLastResponseAt && lastReplyAt !== undefined) {
    parts.push(`${label(`${t("label.lastReply")}:`, colors)} ${formatTime(lastReplyAt, now, timeFormat)}`);
  }

  return parts.length > 0 ? parts.join(` ${label("│", colors)} `) : null;
}
