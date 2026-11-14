// Ported from claude-hud src/render/lines/project.ts (the gitPart of renderProjectLine, formatAheadCount).
// branchUrl hyperlinking is not ported.
import type { HudConfig } from "../config.ts";
import type { GitStatus } from "../git.ts";
import { git as gitColor, gitBranch as gitBranchColor, warning as warningColor, critical as criticalColor, red, green } from "./colors.ts";

const CONTROL_AND_BIDI_PATTERN = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u206A-\u206F]/g;

/** The `git:(branch* ↑1 ↓2 [+3 -4])` segment, or "" when git is off or there is no status. */
export function renderGitPart(status: GitStatus | null | undefined, config: HudConfig): string {
  const gitConfig = config.gitStatus;
  const colors = config.colors;
  if (!gitConfig.enabled || !status) return "";

  const branchText = (status.branch + (gitConfig.showDirty && status.isDirty ? "*" : "")).replace(CONTROL_AND_BIDI_PATTERN, "");
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

function formatAheadCount(ahead: number, gitConfig: HudConfig["gitStatus"], colors: HudConfig["colors"]): string {
  const value = `↑${ahead}`;
  if (gitConfig.pushCriticalThreshold > 0 && ahead >= gitConfig.pushCriticalThreshold) return criticalColor(value, colors);
  if (gitConfig.pushWarningThreshold > 0 && ahead >= gitConfig.pushWarningThreshold) return warningColor(value, colors);
  return gitBranchColor(value, colors);
}
