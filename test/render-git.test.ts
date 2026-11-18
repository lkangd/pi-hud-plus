// Ported from claude-hud tests/render.test.js (git cases of renderProjectLine).
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { renderHud } from "../src/render/index.ts";
import { DEFAULT_CONFIG, type HudConfig } from "../src/config.ts";
import type { GitStatus } from "../src/git.ts";
import type { HudSnapshot } from "../src/types.ts";

const base: HudSnapshot = { model: null, cwd: "/tmp/my-project", context: null, tools: [] };

function line(
  git: GitStatus | null,
  gitStatus: Partial<HudConfig["gitStatus"]> = {},
  display: Partial<HudConfig["display"]> = {},
  lineLayout: HudConfig["lineLayout"] = "expanded",
) {
  const config: HudConfig = {
    ...DEFAULT_CONFIG,
    lineLayout,
    gitStatus: { ...DEFAULT_CONFIG.gitStatus, ...gitStatus },
    display: { ...DEFAULT_CONFIG.display, ...display },
  };
  return renderHud({ ...base, git }, config, 200)[0] ?? "";
}

const main: GitStatus = { branch: "main", isDirty: false, ahead: 0, behind: 0 };

test("displays the git branch next to the project", () => {
  assert.equal(strip(line(main)), "my-project git:(main)");
});

test("omits git when there is no status, or gitStatus.enabled is false", () => {
  assert.equal(strip(line(null)), "my-project");
  assert.equal(strip(line(main, { enabled: false })), "my-project");
});

test("marks a dirty tree with * unless showDirty is false", () => {
  assert.equal(strip(line({ ...main, isDirty: true })), "my-project git:(main*)");
  assert.equal(strip(line({ ...main, isDirty: true }, { showDirty: false })), "my-project git:(main)");
});

test("keeps git status when showProject is false", () => {
  assert.equal(strip(line({ ...main, isDirty: true }, {}, { showProject: false })), "git:(main*)");
});

test("branchOverflow wrap gives git its own segment", () => {
  assert.equal(strip(line({ ...main, branch: "feature/add-auth" }, { branchOverflow: "wrap" })), "my-project │ git:(feature/add-auth)");
});

test("shows ahead/behind and line stats only when enabled", () => {
  const git: GitStatus = { branch: "feature", isDirty: true, ahead: 2, behind: 1, lineDiff: { added: 5, deleted: 3 } };
  assert.equal(strip(line(git)), "my-project git:(feature*)");
  assert.equal(strip(line(git, { showAheadBehind: true, showFileStats: true })), "my-project git:(feature* ↑2 ↓1 [+5 -3])");
});

test("colors the ahead count at the push warning and critical thresholds", () => {
  const thresholds = { showAheadBehind: true, pushWarningThreshold: 10, pushCriticalThreshold: 20 };
  assert.ok(line({ ...main, ahead: 9 }, thresholds).includes("\x1b[36m↑9\x1b[0m"), "below warning uses the branch color");
  assert.ok(line({ ...main, ahead: 12 }, thresholds).includes("\x1b[33m↑12\x1b[0m"), "ahead count should use warning color");
  assert.ok(line({ ...main, ahead: 25 }, thresholds).includes("\x1b[31m↑25\x1b[0m"), "ahead count should use critical color");
  assert.ok(line({ ...main, ahead: 25 }, { showAheadBehind: true }).includes("\x1b[36m↑25\x1b[0m"), "0 thresholds are off");
});

test("the compact Line shows git inline with Starship-style file stats", () => {
  const git: GitStatus = {
    branch: "feature",
    isDirty: true,
    ahead: 2,
    behind: 1,
    fileStats: { modified: 3, added: 1, deleted: 1, untracked: 2, trackedFiles: [] },
  };
  assert.equal(strip(line(git, {}, {}, "compact")), "my-project git:(feature*)");
  assert.equal(strip(line(git, { showAheadBehind: true, showFileStats: true }, {}, "compact")), "my-project git:(feature* ↑2 ↓1 !3 +1 ✘1 ?2)");
  assert.equal(strip(line(git, { branchOverflow: "wrap", showDirty: false }, {}, "compact")), "my-project | git:(feature)");
});

test("links the branch to its GitHub tree page", () => {
  const out = line({ ...main, branch: "feat/name", githubUrl: "https://github.com/example/claude-hud" });
  assert.ok(out.includes("\x1b]8;;https://github.com/example/claude-hud/tree/feat%2Fname\x1b\\"));
  assert.equal(strip(out), "my-project git:(feat/name)");
  assert.ok(!line({ ...main, githubUrl: "https://github.com/x/y" }, {}, {}, "compact").includes("]8;;"), "compact has no link");
});

test("strips control characters from branch links", () => {
  const out = line({ ...main, branch: "feat/\x07name", githubUrl: "https://github.com/example/claude-hud\x07" });
  assert.equal(strip(out), "my-project git:(feat/name)");
  assert.ok(!out.includes("\x07"));
});

test("strips control characters from the branch", () => {
  assert.equal(strip(line({ ...main, branch: "ma\x1b]8;;x\x07in" })), "my-project git:(ma]8;;xin)");
});

const dirty: GitStatus = {
  branch: "main",
  isDirty: true,
  ahead: 0,
  behind: 0,
  lineDiff: { added: 5, deleted: 2 },
  fileStats: {
    modified: 1,
    added: 1,
    deleted: 0,
    untracked: 2,
    trackedFiles: [
      { basename: "app.ts", fullPath: "src/app.ts", type: "modified", lineDiff: { added: 4, deleted: 2 } },
      { basename: "new.ts", fullPath: "src/new.ts", type: "added", lineDiff: { added: 1, deleted: 0 } },
    ],
  },
};

function lines(git: GitStatus, width = 200, lineLayout: HudConfig["lineLayout"] = "expanded", showFileStats = true) {
  const config: HudConfig = { ...DEFAULT_CONFIG, lineLayout, gitStatus: { ...DEFAULT_CONFIG.gitStatus, showFileStats } };
  return renderHud({ ...base, git }, config, width);
}

test("the git files Line lists tracked files with per-file line diffs, last", () => {
  const out = lines(dirty);
  assert.equal(strip(out.at(-1)!), "~app.ts(+4 -2)  +new.ts(+1)  ?2");
  assert.ok(out.at(-1)!.includes("\x1b]8;;file:///tmp/my-project/src/app.ts\x1b\\"), "names link to the file");
});

test("the git files Line strips control characters and skips links outside cwd", () => {
  const out = lines({
    ...dirty,
    fileStats: { ...dirty.fileStats!, untracked: 0, trackedFiles: [{ basename: "app\x07.ts", fullPath: "../outside.ts", type: "modified" }] },
  });
  assert.equal(strip(out.at(-1)!), "~app.ts");
  assert.ok(!out.at(-1)!.includes("\x07") && !out.at(-1)!.includes("]8;;"));
});

test("the git files Line shows 6 files and counts the rest", () => {
  const trackedFiles = Array.from({ length: 8 }, (_, i) => ({ basename: `f${i}`, fullPath: `f${i}`, type: "deleted" as const }));
  const out = lines({ ...dirty, fileStats: { ...dirty.fileStats!, untracked: 0, trackedFiles } });
  assert.equal(strip(out.at(-1)!), "-f0  -f1  -f2  -f3  -f4  -f5  +2 more");
});

test("the git files Line hides below 60 columns, in compact layout, and without showFileStats", () => {
  const has = (out: string[]) => out.some((l) => strip(l).includes("app.ts"));
  assert.ok(has(lines(dirty, 60)));
  assert.ok(!has(lines(dirty, 59)));
  assert.ok(!has(lines(dirty, 200, "compact")));
  assert.ok(!has(lines(dirty, 200, "expanded", false)));
});

test("the git files Line resolves paths from the repo root and links only files inside cwd", () => {
  const git: GitStatus = {
    ...dirty,
    fileStats: {
      ...dirty.fileStats!,
      untracked: 0,
      root: "/tmp/my-project",
      trackedFiles: [
        { basename: "a.ts", fullPath: "sub/a.ts", type: "modified" },
        { basename: "b.ts", fullPath: "b.ts", type: "modified" },
        { basename: "..notes", fullPath: "sub/..notes", type: "modified" },
      ],
    },
  };
  const config: HudConfig = { ...DEFAULT_CONFIG, gitStatus: { ...DEFAULT_CONFIG.gitStatus, showFileStats: true } };
  const out = renderHud({ ...base, cwd: "/tmp/my-project/sub", git }, config, 200).at(-1)!;
  assert.ok(out.includes("file:///tmp/my-project/sub/a.ts"));
  assert.ok(out.includes("file:///tmp/my-project/sub/..notes"), "a name starting with .. is still inside cwd");
  assert.ok(!out.includes("file:///tmp/my-project/b.ts"));
});
