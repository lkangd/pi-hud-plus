import type { HudConfig } from "./config.ts";

export interface HudTool {
  name: string;
  /** File path or other argument shown after a running tool's name. */
  target?: string;
  status: "running" | "completed" | "error";
}

/** HUD snapshot: everything the render core needs. The pi adapter keeps it up to date. */
export interface HudSnapshot {
  model: { name: string } | null;
  cwd: string;
  /** null = no context usage to show yet. */
  context: { percent: number } | null;
  /** Running and recent tools, oldest first. */
  tools: HudTool[];
  /** Wall-clock ms the time-based Elements render against. The clock advances it. */
  now?: number;
  /** undefined = not read from pi's session yet. */
  session?: HudSession;
  /** Output tokens/s of the reply streaming now (or the last one). */
  speed?: number;
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
