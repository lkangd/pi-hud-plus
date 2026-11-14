// Ported from claude-hud: the gitPart of render/lines/project.ts (expanded) and render/session-line.ts (compact).
// branchUrl hyperlinking is not ported.
import type { HudConfig } from "../../config.ts";
import type { RenderContext } from "../../types.ts";
import { git as gitColor, gitBranch as gitBranchColor, warning as warningColor, critical as criticalColor, red, green } from "../colors.ts";
import { sanitize } from "./project.ts";

/** The project Line's `git:(branch* ↑1 ↓2 [+3 -4])` segment, or null when git is off or there is no status. */
export function renderGitPart({ snapshot, config }: RenderContext): string | null {
  const status = snapshot.git;
  const gitConfig = config.gitStatus;
  const colors = config.colors;
  if (!gitConfig.enabled || !status) return null;

  const branchText = sanitize(status.branch + (gitConfig.showDirty && status.isDirty ? "*" : ""));
  const gitInner: string[] = [gitBranchColor(branchText, colors)];

  if (gitConfig.showAheadBehind) {
    if (status.ahead > 0) gitInner.push(formatAheadCount(status.ahead, gitConfig, colors));
    if (status.behind > 0) gitInner.push(gitBranchColor(`↓${status.behind}`, colors));
  }

  if (gitConfig.showFileStats && status.lineDiff) {
    const { added, deleted } = status.lineDiff;
    const diffParts: string[] = [];
    if (added > 0) diffParts.push(green(`+${added}`));
    if (deleted > 0) diffParts.push(red(`-${deleted}`));
    if (diffParts.length > 0) gitInner.push(`[${diffParts.join(" ")}]`);
  }

  return `${gitColor("git:(", colors)}${gitInner.join(" ")}${gitColor(")", colors)}`;
}

/** The compact session Line's `git:(branch* ↑1 ↓2 !3 +1 ✘1 ?2)` segment (Starship-style file stats). */
export function renderCompactGitPart({ snapshot, config }: RenderContext): string | null {
  const status = snapshot.git;
  const gitConfig = config.gitStatus;
  if (!gitConfig.enabled || !status) return null;

  const gitParts: string[] = [status.branch];
  if (gitConfig.showDirty && status.isDirty) gitParts.push("*");
  if (gitConfig.showAheadBehind) {
    if (status.ahead > 0) gitParts.push(` ↑${status.ahead}`);
    if (status.behind > 0) gitParts.push(` ↓${status.behind}`);
  }
  if (gitConfig.showFileStats && status.fileStats) {
    const { modified, added, deleted, untracked } = status.fileStats;
    const statParts: string[] = [];
    if (modified > 0) statParts.push(`!${modified}`);
    if (added > 0) statParts.push(`+${added}`);
    if (deleted > 0) statParts.push(`✘${deleted}`);
    if (untracked > 0) statParts.push(`?${untracked}`);
    if (statParts.length > 0) gitParts.push(` ${statParts.join(" ")}`);
  }

  return `${gitColor("git:(", config.colors)}${gitBranchColor(sanitize(gitParts.join("")), config.colors)}${gitColor(")", config.colors)}`;
}

/** Project and git as Line parts: one part (`project git:(…)`), or two when `branchOverflow` is "wrap". */
export function withGit(project: string | null, git: string | null, config: HudConfig): string[] {
  if (project && git && config.gitStatus.branchOverflow === "truncate") return [`${project} ${git}`];
  return [project, git].filter((part) => part !== null);
}

function formatAheadCount(ahead: number, gitConfig: HudConfig["gitStatus"], colors: HudConfig["colors"]): string {
  const value = `↑${ahead}`;
  if (gitConfig.pushCriticalThreshold > 0 && ahead >= gitConfig.pushCriticalThreshold) return criticalColor(value, colors);
  if (gitConfig.pushWarningThreshold > 0 && ahead >= gitConfig.pushWarningThreshold) return warningColor(value, colors);
  return gitBranchColor(value, colors);
}
