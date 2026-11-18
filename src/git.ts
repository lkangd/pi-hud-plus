// Ported from claude-hud src/git.ts. Changes for pi: commands go through pi.exec (which resolves with an
// exit code instead of rejecting), every command passes --no-optional-locks, diff and rev-list are gated
// by config, the branch (rev-parse) comes from pi's footerData, and branchUrl becomes githubUrl (the branch isn't known here).
import { stat } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type Exec = ExtensionAPI["exec"];

export interface LineDiff {
  added: number;
  deleted: number;
}

export interface TrackedFile {
  basename: string;
  fullPath: string;
  type: 'modified' | 'added' | 'deleted';
  lineDiff?: LineDiff;
}

export interface FileStats {
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
  trackedFiles: TrackedFile[];
  /** The repo root that trackedFiles' paths are relative to; set when showFileStats collected them. */
  root?: string;
}

export interface GitStatus {
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
  fileStats?: FileStats;
  lineDiff?: LineDiff;
  /** The GitHub origin's https URL, for linking the branch. */
  githubUrl?: string;
}

export interface GitStatusOptions {
  showAheadBehind: boolean;
  showFileStats: boolean;
  /** Look up the GitHub origin for the branch link (expanded layout only). */
  linkBranch: boolean;
}

/** Runs `git --no-optional-locks <args>`, rejecting like execFile on a non-zero exit or timeout. */
async function git(exec: Exec, cwd: string, args: string[], timeout: number): Promise<string> {
  const result = await exec('git', ['--no-optional-locks', ...args], { cwd, timeout });
  if (result.code !== 0 || result.killed) throw new Error(`git ${args.join(' ')} exited ${result.code}`);
  return result.stdout;
}

export async function getGitStatus(exec: Exec, cwd: string, options: GitStatusOptions): Promise<Omit<GitStatus, 'branch'>> {
  // Check for dirty state and parse file stats
  let isDirty = false;
  let fileStats: FileStats | undefined;
  let lineDiff: LineDiff | undefined;
  try {
    const statusOut = await git(exec, cwd, ['-c', 'core.quotePath=false', 'status', '--porcelain'], 1000);
    const trimmed = statusOut.trim();
    isDirty = trimmed.length > 0;
    if (isDirty) {
      fileStats = parseFileStats(trimmed);
    }
  } catch {
    // Ignore errors, assume clean
  }

  // Get per-file and total line diffs. diff can refresh the index, so it only runs when shown.
  if (isDirty && options.showFileStats) {
    try {
      const numstatOut = await git(exec, cwd, ['-c', 'core.quotePath=false', 'diff', '--numstat', 'HEAD'], 2000);
      const trackedPaths = new Set(fileStats?.trackedFiles.map((file) => file.fullPath) ?? []);
      const { totalDiff, perFileDiff } = parseNumstat(numstatOut, trackedPaths);
      lineDiff = totalDiff;
      if (fileStats) {
        applyLineDiffsToFiles(fileStats.trackedFiles, perFileDiff);
      }
    } catch {
      // Ignore errors
    }
    // claude-hud sorts at render time; here it runs once per git job instead of every frame.
    if (fileStats) {
      try {
        fileStats.root = (await git(exec, cwd, ['rev-parse', '--show-toplevel'], 1000)).trim();
        await sortByMtime(fileStats.trackedFiles, fileStats.root);
      } catch {
        // Keep git's order
      }
    }
  }

  // Get ahead/behind counts
  let ahead = 0;
  let behind = 0;
  if (options.showAheadBehind) {
    try {
      const revOut = await git(exec, cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], 1000);
      const parts = revOut.trim().split(/\s+/);
      if (parts.length === 2) {
        behind = parseInt(parts[0]!, 10) || 0;
        ahead = parseInt(parts[1]!, 10) || 0;
      }
    } catch {
      // No upstream or error, keep 0/0
    }
  }

  let githubUrl: string | undefined;
  if (options.linkBranch) try {
    const httpsBase = (await git(exec, cwd, ['remote', 'get-url', 'origin'], 1000))
      .trim()
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
      .replace(/\.git$/, '');
    if (httpsBase.startsWith('https://github.com/')) githubUrl = httpsBase;
  } catch {
    // No remote or not GitHub
  }

  return { isDirty, ahead, behind, fileStats, lineDiff, githubUrl };
}

/**
 * Parse git status --porcelain output and count file stats (Starship-compatible format)
 * Status codes: M=modified, A=added, D=deleted, ??=untracked
 */
function parseFileStats(porcelainOutput: string): FileStats {
  const stats: FileStats = { modified: 0, added: 0, deleted: 0, untracked: 0, trackedFiles: [] };
  const lines = porcelainOutput.split('\n').filter(Boolean);

  for (const line of lines) {
    if (line.length < 2) continue;

    const index = line[0];    // staged status
    const worktree = line[1]; // unstaged status

    if (line.startsWith('??')) {
      stats.untracked++;
    } else if (index === 'A') {
      stats.added++;
      const fullPath = parsePorcelainPath(line.slice(2).trimStart());
      stats.trackedFiles.push({ basename: fullPath.split('/').pop() ?? fullPath, fullPath, type: 'added' });
    } else if (index === 'D' || worktree === 'D') {
      stats.deleted++;
      const fullPath = parsePorcelainPath(line.slice(2).trimStart());
      stats.trackedFiles.push({ basename: fullPath.split('/').pop() ?? fullPath, fullPath, type: 'deleted' });
    } else if (index === 'M' || worktree === 'M' || index === 'R' || index === 'C') {
      // M=modified, R=renamed (counts as modified), C=copied (counts as modified)
      stats.modified++;
      // For renames, git porcelain shows "old -> new"; take the destination path
      const fullPath = parsePorcelainPath(line.slice(2).trimStart().split(' -> ').pop() ?? line.slice(2).trimStart());
      stats.trackedFiles.push({ basename: fullPath.split('/').pop() ?? fullPath, fullPath, type: 'modified' });
    }
  }

  return stats;
}

function parsePorcelainPath(pathField: string): string {
  if (pathField.startsWith('"') && pathField.endsWith('"')) {
    try {
      return JSON.parse(pathField);
    } catch {
      return pathField.slice(1, -1);
    }
  }

  return pathField;
}

/**
 * Extract the destination path from a numstat path field.
 *
 * For renames, `git diff --numstat` emits the path as `old => new`
 * (sometimes with a shared directory prefix like `pkg/{old.ts => new.ts}`).
 * `git status --porcelain` reports the renamed file under its destination
 * only, so we key `perFileDiff` by the destination to make lookups match.
 */
function extractNumstatDestination(filePath: string): string {
  const braceMatch = filePath.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceMatch) {
    const [, prefix, , dest, suffix] = braceMatch;
    return `${prefix}${dest}${suffix}`.replace(/\/{2,}/g, '/');
  }

  const arrowIndex = filePath.indexOf(' => ');
  if (arrowIndex !== -1) {
    return filePath.slice(arrowIndex + 4);
  }

  return filePath;
}

function resolveNumstatPath(filePath: string, trackedPaths: Set<string>): string {
  if (trackedPaths.has(filePath)) {
    return filePath;
  }

  const destinationPath = extractNumstatDestination(filePath);
  if (destinationPath !== filePath && trackedPaths.has(destinationPath)) {
    return destinationPath;
  }

  return filePath;
}

/**
 * Parse `git diff --numstat HEAD` output.
 * Returns total line diff and a map of fullPath -> LineDiff.
 */
function parseNumstat(numstatOutput: string, trackedPaths: Set<string>): { totalDiff: LineDiff; perFileDiff: Map<string, LineDiff> } {
  const totalDiff: LineDiff = { added: 0, deleted: 0 };
  const perFileDiff = new Map<string, LineDiff>();

  for (const line of numstatOutput.trim().split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parseInt(parts[0]!, 10);
    const deleted = parseInt(parts[1]!, 10);
    const filePath = resolveNumstatPath(parts[2]!, trackedPaths);
    if (Number.isNaN(added) || Number.isNaN(deleted)) continue; // binary file
    totalDiff.added += added;
    totalDiff.deleted += deleted;
    perFileDiff.set(filePath, { added, deleted });
  }

  return { totalDiff, perFileDiff };
}

/** Newest-modified first; files that can't be stat'd (deleted) go last. */
async function sortByMtime(files: TrackedFile[], root: string): Promise<void> {
  const mtimes = new Map(await Promise.all(files.map(async (file) =>
    [file, await stat(path.resolve(root, file.fullPath)).then((s) => s.mtimeMs, () => 0)] as const)));
  files.sort((a, b) => mtimes.get(b)! - mtimes.get(a)!);
}

function applyLineDiffsToFiles(files: TrackedFile[], perFileDiff: Map<string, LineDiff>): void {
  for (const file of files) {
    const diff = perFileDiff.get(file.fullPath);
    if (diff) {
      file.lineDiff = diff;
    }
  }
}
