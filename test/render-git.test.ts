// Ported from claude-hud tests/render.test.js (git cases of renderProjectLine).
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { renderHud } from "../src/render/index.ts";
import { DEFAULT_CONFIG, type HudConfig } from "../src/config.ts";
import type { GitStatus } from "../src/git.ts";
import type { HudSnapshot } from "../src/types.ts";

const base: HudSnapshot = { model: null, cwd: "/tmp/my-project" };

function line(git: GitStatus | null, gitStatus: Partial<HudConfig["gitStatus"]> = {}, display: Partial<HudConfig["display"]> = {}) {
  const config: HudConfig = {
    ...DEFAULT_CONFIG,
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

test("strips control characters from the branch", () => {
  assert.equal(strip(line({ ...main, branch: "ma\x1b]8;;x\x07in" })), "my-project git:(ma]8;;xin)");
});
