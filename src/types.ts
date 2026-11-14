/** HUD snapshot: everything the render core needs. The pi adapter keeps it up to date. */
export interface HudSnapshot {
  model: { name: string } | null;
  cwd: string;
}
