// Ported from claude-hud tests/git.test.js. The branch now comes from pi's footerData, so the
// getGitBranch and branch-name tests are gone; branchUrl was not ported. Commands run through a real
// execFile-backed exec shaped like pi.exec.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { getGitStatus, type Exec } from "../src/git.ts";

const calls: string[][] = [];
const exec: Exec = (command, args, options) => {
  calls.push([command, ...args]);
  return new Promise((resolve) => {
    execFile(command, args, { cwd: options?.cwd, timeout: options?.timeout, encoding: "utf8" }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      resolve({ stdout, stderr, code, killed: Boolean(err?.killed), truncated: false });
    });
  });
};

const ALL = { showAheadBehind: true, showFileStats: true };

async function withRepo(fn: (dir: string) => Promise<void>, init = true) {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-hud-git-"));
  try {
    if (init) {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, stdio: "ignore" });
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const git = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
const commitEmpty = (dir: string) => git(dir, "commit", "--allow-empty", "-m", "init");

test("getGitStatus returns clean state for a non-git directory", async () => {
  await withRepo(async (dir) => {
    const result = await getGitStatus(exec, dir, ALL);
    assert.deepEqual(result, { isDirty: false, ahead: 0, behind: 0, fileStats: undefined, lineDiff: undefined });
  }, false);
});

test("getGitStatus returns clean state for clean repo", async () => {
  await withRepo(async (dir) => {
    commitEmpty(dir);
    const result = await getGitStatus(exec, dir, ALL);
    assert.equal(result.isDirty, false);
    assert.equal(result.ahead, 0);
    assert.equal(result.behind, 0);
    assert.equal(result.fileStats, undefined);
  });
});

test("getGitStatus detects dirty state", async () => {
  await withRepo(async (dir) => {
    commitEmpty(dir);
    await writeFile(path.join(dir, "dirty.txt"), "uncommitted change");
    const result = await getGitStatus(exec, dir, ALL);
    assert.equal(result.isDirty, true);
  });
});

test("getGitStatus counts untracked files", async () => {
  await withRepo(async (dir) => {
    commitEmpty(dir);
    await writeFile(path.join(dir, "untracked1.txt"), "content");
    await writeFile(path.join(dir, "untracked2.txt"), "content");
    const result = await getGitStatus(exec, dir, ALL);
    assert.equal(result.fileStats?.untracked, 2);
    assert.equal(result.fileStats?.modified, 0);
    assert.equal(result.fileStats?.added, 0);
    assert.equal(result.fileStats?.deleted, 0);
  });
});

test("getGitStatus counts modified files", async () => {
  await withRepo(async (dir) => {
    await writeFile(path.join(dir, "file.txt"), "original");
    git(dir, "add", "file.txt");
    git(dir, "commit", "-m", "add file");
    await writeFile(path.join(dir, "file.txt"), "modified");
    const result = await getGitStatus(exec, dir, ALL);
    assert.equal(result.fileStats?.modified, 1);
    assert.equal(result.fileStats?.untracked, 0);
  });
});

test("getGitStatus returns UTF-8 filenames when core.quotePath is true", async () => {
  await withRepo(async (dir) => {
    git(dir, "config", "core.quotePath", "true");
    const fileName = "日本語.txt";
    await writeFile(path.join(dir, fileName), "original\n");
    git(dir, "add", fileName);
    git(dir, "commit", "-m", "add utf8 file");
    await writeFile(path.join(dir, fileName), "modified\n");
    const quotedStatus = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    assert.match(quotedStatus, /\\[0-7]{3}/, `expected git to octal-escape path, got ${quotedStatus}`);
    assert.equal(quotedStatus.includes(fileName), false);

    const result = await getGitStatus(exec, dir, ALL);
    const tracked = result.fileStats?.trackedFiles ?? [];
    assert.equal(result.fileStats?.modified, 1);
    assert.deepEqual(
      tracked.map((file) => ({ basename: file.basename, fullPath: file.fullPath, lineDiff: file.lineDiff })),
      [{ basename: fileName, fullPath: fileName, lineDiff: { added: 1, deleted: 1 } }],
    );
  });
});

test("getGitStatus counts staged added files", async () => {
  await withRepo(async (dir) => {
    commitEmpty(dir);
    await writeFile(path.join(dir, "newfile.txt"), "content");
    git(dir, "add", "newfile.txt");
    const result = await getGitStatus(exec, dir, ALL);
    assert.equal(result.fileStats?.added, 1);
    assert.equal(result.fileStats?.untracked, 0);
  });
});

test("getGitStatus counts deleted files", async () => {
  await withRepo(async (dir) => {
    await writeFile(path.join(dir, "todelete.txt"), "content");
    git(dir, "add", "todelete.txt");
    git(dir, "commit", "-m", "add file");
    git(dir, "rm", "todelete.txt");
    const result = await getGitStatus(exec, dir, ALL);
    assert.equal(result.fileStats?.deleted, 1);
  });
});

test("getGitStatus includes total and per-file line diffs for modified files", async () => {
  await withRepo(async (dir) => {
    await writeFile(path.join(dir, "file.txt"), "one\ntwo\nthree\n");
    git(dir, "add", "file.txt");
    git(dir, "commit", "-m", "add file");
    await writeFile(path.join(dir, "file.txt"), "one\nthree\nfour\n");
    const result = await getGitStatus(exec, dir, ALL);
    assert.deepEqual(result.lineDiff, { added: 1, deleted: 1 });
    assert.deepEqual(result.fileStats?.trackedFiles[0]?.lineDiff, { added: 1, deleted: 1 });
  });
});

test("getGitStatus attaches line diffs to renamed files", async () => {
  await withRepo(async (dir) => {
    await writeFile(path.join(dir, "old_name.txt"), "one\ntwo\nthree\n");
    git(dir, "add", "old_name.txt");
    git(dir, "commit", "-m", "add old_name");
    git(dir, "mv", "old_name.txt", "new_name.txt");
    await writeFile(path.join(dir, "new_name.txt"), "one\ntwo\nthree\nfour\nfive\n");
    git(dir, "add", "new_name.txt");

    const result = await getGitStatus(exec, dir, ALL);
    const renamed = result.fileStats?.trackedFiles.find((f) => f.fullPath.endsWith("new_name.txt"));
    assert.ok(renamed, `expected renamed file in trackedFiles, got ${JSON.stringify(result.fileStats)}`);
    assert.equal(renamed.lineDiff?.added, 2);
    assert.equal(renamed.lineDiff?.deleted, 0);
  });
});

test("getGitStatus attaches line diffs to renamed files with shared directory prefix", async () => {
  await withRepo(async (dir) => {
    // Some git configurations emit numstat in the brace form: `pkg/{old.ts => new.ts}`.
    git(dir, "config", "diff.renames", "true");
    await writeFile(path.join(dir, ".gitkeep"), "");
    git(dir, "add", ".gitkeep");
    git(dir, "commit", "-m", "init");
    execFileSync("mkdir", ["-p", path.join(dir, "pkg")]);
    await writeFile(path.join(dir, "pkg", "old.ts"), "export const a = 1;\n");
    git(dir, "add", "pkg/old.ts");
    git(dir, "commit", "-m", "add old.ts");
    git(dir, "mv", "pkg/old.ts", "pkg/new.ts");
    await writeFile(path.join(dir, "pkg", "new.ts"), "export const a = 1;\nexport const b = 2;\n");
    git(dir, "add", "pkg/new.ts");

    const result = await getGitStatus(exec, dir, ALL);
    const renamed = result.fileStats?.trackedFiles.find((f) => f.fullPath.endsWith("new.ts"));
    assert.ok(renamed, `expected renamed file in trackedFiles, got ${JSON.stringify(result.fileStats)}`);
    assert.ok(renamed.lineDiff, `expected lineDiff on renamed file, got ${JSON.stringify(renamed)}`);
  });
});

test("getGitStatus keeps line diffs for literal filenames containing arrow text", async () => {
  await withRepo(async (dir) => {
    const fileName = "foo => bar.txt";
    await writeFile(path.join(dir, fileName), "one\ntwo\n");
    git(dir, "add", fileName);
    git(dir, "commit", "-m", "add literal arrow file");
    await writeFile(path.join(dir, fileName), "one\ntwo\nthree\n");

    const result = await getGitStatus(exec, dir, ALL);
    const modified = result.fileStats?.trackedFiles.find((f) => f.fullPath === fileName);
    assert.ok(modified, `expected literal arrow filename in trackedFiles, got ${JSON.stringify(result.fileStats)}`);
    assert.deepEqual(modified.lineDiff, { added: 1, deleted: 0 });
  });
});

// New for pi: the gated commands and the lock-free flag.

test("getGitStatus counts commits ahead of and behind the upstream", async () => {
  await withRepo(async (dir) => {
    commitEmpty(dir);
    git(dir, "branch", "upstream");
    git(dir, "branch", "--set-upstream-to=upstream");
    git(dir, "commit", "--allow-empty", "-m", "ahead 1");
    git(dir, "commit", "--allow-empty", "-m", "ahead 2");
    git(dir, "checkout", "-q", "upstream");
    git(dir, "commit", "--allow-empty", "-m", "behind 1");
    git(dir, "checkout", "-q", "-");
    const result = await getGitStatus(exec, dir, ALL);
    assert.deepEqual([result.ahead, result.behind], [2, 1]);
  });
});

test("diff and rev-list run only when their options are on, and every command skips optional locks", async () => {
  await withRepo(async (dir) => {
    commitEmpty(dir);
    await writeFile(path.join(dir, "dirty.txt"), "x");
    calls.length = 0;
    const result = await getGitStatus(exec, dir, { showAheadBehind: false, showFileStats: false });
    assert.equal(result.isDirty, true);
    assert.equal(result.lineDiff, undefined);
    assert.deepEqual(calls.map((c) => c.find((a) => ["status", "diff", "rev-list"].includes(a))), ["status"]);

    calls.length = 0;
    await getGitStatus(exec, dir, ALL);
    assert.deepEqual(calls.map((c) => c.find((a) => ["status", "diff", "rev-list"].includes(a))), ["status", "diff", "rev-list"]);
    for (const call of calls) assert.ok(call.includes("--no-optional-locks"), call.join(" "));
  });
});
