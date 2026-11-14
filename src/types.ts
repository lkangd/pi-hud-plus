import type { GitStatus } from "./git.ts";

/** HUD snapshot: everything the render core needs. The pi adapter keeps it up to date. */
export interface HudSnapshot {
  model: { name: string } | null;
  cwd: string;
  /** Absent or null: not a repo, git off, or not fetched yet. */
  git?: GitStatus | null;
}
