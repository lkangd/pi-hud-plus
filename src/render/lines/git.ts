// Ported from claude-hud: the gitPart of render/lines/project.ts (expanded) and render/session-line.ts (compact).
// renderGitFilesLine and the branch link are ported from project.ts.
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { HudConfig } from "../../config.ts";
import type { LineDiff } from "../../git.ts";
import type { RenderContext } from "../../types.ts";
import { git as gitColor, gitBranch as gitBranchColor, warning as warningColor, critical as criticalColor, red, green, yellow, dim } from "../colors.ts";
import { sanitize } from "../../sanitize.ts";

/** The project Line's `git:(branch* ↑1 ↓2 [+3 -4])` segment, or null when git is off or there is no status. */
export function renderGitPart({ snapshot, config }: RenderContext): string | null {
  const status = snapshot.git;
  const gitConfig = config.gitStatus;
  const colors = config.colors;
  if (!gitConfig.enabled || !status) return null;

  const branchText = sanitize(status.branch + (gitConfig.showDirty && status.isDirty ? "*" : ""));
  const branchUrl = status.githubUrl && `${status.githubUrl}/tree/${encodeURIComponent(status.branch)}`;
  const gitInner: string[] = [safeHyperlink(branchUrl, gitBranchColor(branchText, colors))];

  if (gitConfig.showAheadBehind) {
    if (status.ahead > 0) gitInner.push(formatAheadCount(status.ahead, gitConfig, colors));
    if (status.behind > 0) gitInner.push(gitBranchColor(`↓${status.behind}`, colors));
  }

  const diffParts = gitConfig.showFileStats ? lineDiffParts(status.lineDiff) : "";
  if (diffParts) gitInner.push(`[${diffParts}]`);

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

/** The git files Line: up to 6 changed files, newest first, each linked (OSC 8) when inside cwd. Expanded layout only. */
export function renderGitFilesLine({ snapshot, config, width }: RenderContext): string | null {
  const fileStats = snapshot.git?.fileStats;
  if (!config.gitStatus.enabled || !config.gitStatus.showFileStats || !fileStats || width < 60) return null;
  const { trackedFiles, untracked } = fileStats;
  if (trackedFiles.length === 0 && untracked === 0) return null;

  const parts = trackedFiles.slice(0, 6).map((file) => {
    const color = file.type === "added" ? green : file.type === "deleted" ? red : yellow;
    const prefix = file.type === "added" ? "+" : file.type === "deleted" ? "-" : "~";
    const name = color(sanitize(file.basename));
    const resolved = path.resolve(fileStats.root ?? snapshot.cwd, file.fullPath);
    const relative = path.relative(snapshot.cwd, resolved);
    const inCwd = relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    const diffParts = lineDiffParts(file.lineDiff);
    return color(prefix) + (inCwd ? safeHyperlink(pathToFileURL(resolved).href, name) : name) + (diffParts ? dim(`(${diffParts})`) : "");
  });

  if (trackedFiles.length > 6) parts.push(dim(`+${trackedFiles.length - 6} more`));
  if (untracked > 0) parts.push(dim(`?${untracked}`));
  return parts.join("  ");
}

/** Project and git as Line parts: one part (`project git:(…)`), or two when `branchOverflow` is "wrap". */
export function withGit(project: string | null, git: string | null, config: HudConfig): string[] {
  if (project && git && config.gitStatus.branchOverflow === "truncate") return [`${project} ${git}`];
  return [project, git].filter((part) => part !== null);
}

/** `+3 -4` in green and red, skipping zeros; "" when there's nothing to show. */
function lineDiffParts(diff: LineDiff | undefined): string {
  if (!diff) return "";
  const parts: string[] = [];
  if (diff.added > 0) parts.push(green(`+${diff.added}`));
  if (diff.deleted > 0) parts.push(red(`-${diff.deleted}`));
  return parts.join(" ");
}

/** OSC 8 link, or the plain text when the URI isn't a valid https/file URL. URL parsing percent-encodes control characters. */
function safeHyperlink(uri: string | undefined, text: string): string {
  if (!uri) return text;
  try {
    const parsed = new URL(sanitize(uri));
    if (parsed.protocol !== "https:" && parsed.protocol !== "file:") return text;
    return `\x1b]8;;${parsed}\x1b\\${text}\x1b]8;;\x1b\\`;
  } catch {
    return text;
  }
}

function formatAheadCount(ahead: number, gitConfig: HudConfig["gitStatus"], colors: HudConfig["colors"]): string {
  const value = `↑${ahead}`;
  if (gitConfig.pushCriticalThreshold > 0 && ahead >= gitConfig.pushCriticalThreshold) return criticalColor(value, colors);
  if (gitConfig.pushWarningThreshold > 0 && ahead >= gitConfig.pushWarningThreshold) return warningColor(value, colors);
  return gitBranchColor(value, colors);
}
