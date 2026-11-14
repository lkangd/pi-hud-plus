import type { HudConfig } from "./config.ts";
import type { GitStatus } from "./git.ts";

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
  /** Absent or null: not a repo, git off, or not fetched yet. */
  git?: GitStatus | null;
}

/** What every Line module renders from (claude-hud's RenderContext, pi-shaped). */
export interface RenderContext {
  snapshot: HudSnapshot;
  config: HudConfig;
  /** HUD width in cells. */
  width: number;
}
