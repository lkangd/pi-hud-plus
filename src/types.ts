import type { HudConfig } from "./config.ts";
import type { GitStatus } from "./git.ts";
import type { MemoryInfo } from "./memory.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** pi's ThinkingLevel ("off" … "max"); pi-coding-agent doesn't re-export the type. */
export type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

export interface HudTool {
  name: string;
  /** File path or other argument shown after a running tool's name. */
  target?: string;
  status: "running" | "completed" | "error";
}

export interface HudContext {
  tokens: number | null;
  window: number;
  /** 0-100, unrounded. */
  percent: number | null;
  /** The latest reply's prompt split, for the token breakdown. */
  breakdown?: { input: number; cache: number };
}

/** HUD snapshot: everything the render core needs. The pi adapter keeps it up to date. */
export interface HudSnapshot {
  /** provider is set only when it should prefix the name (more than one provider available). */
  model: { name: string; provider?: string } | null;
  thinkingLevel?: ThinkingLevel;
  /** pi's version, for `pi vX`. */
  version?: string;
  cwd: string;
  /** null = no context usage to show yet. tokens/percent null = unknown (right after compaction). */
  context: HudContext | null;
  /** Running and recent tools, oldest first. */
  tools: HudTool[];
  /** Absent or null: not a repo, git off, or not fetched yet. */
  git?: GitStatus | null;
  /** Wall-clock ms the time-based Elements render against. The clock advances it. */
  now?: number;
  /** undefined = not read from pi's session yet. */
  session?: HudSession;
  /** Output tokens/s of the reply streaming now (or the last one). */
  speed?: number;
  /** The Extra command's last label; null/absent = off, failed or not run yet. */
  extraLabel?: string | null;
  /** Other extensions' statuses by key, as footerData.getExtensionStatuses() gives them. */
  extensionStatuses?: ReadonlyMap<string, string>;
  /** System RAM, sampled on the clock tick. Absent or null: off or not sampled yet. */
  memory?: MemoryInfo | null;
}

/** Token totals and cost summed over a session, like pi's built-in footer. */
export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface HudSession {
  name?: string;
  /** ms */
  startedAt?: number;
  /** ms */
  lastReplyAt?: number;
  totals: UsageTotals;
  /** Billed by a subscription (pi's `(sub)`). */
  subscription: boolean;
}

/** What every Line module renders from (claude-hud's RenderContext, pi-shaped). */
export interface RenderContext {
  snapshot: HudSnapshot;
  config: HudConfig;
  /** HUD width in cells. */
  width: number;
}
