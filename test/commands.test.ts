import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { initTheme, getSettingsListTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piHud from "../src/index.ts";

// Isolate from the real ~/.pi/agent: getAgentDir() honours PI_CODING_AGENT_DIR.
const agentDir = mkdtempSync(join(tmpdir(), "pi-hud-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const configFile = join(agentDir, "pi-hud-plus.json");
initTheme();

beforeEach(() => rmSync(configFile, { force: true }));

type Component = { render(width: number): string[]; handleInput?(data: string): void };
type Keys = (list: Component) => void;

const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";

/** Moves the list's cursor to the row labelled `label`. */
function go(list: Component, label: string) {
  const cursor = strip(getSettingsListTheme().cursor);
  for (let i = 0; i < 40; i++) {
    const selected = list.render(120).map(strip).find((line) => line.startsWith(cursor));
    if (selected?.slice(cursor.length).trimStart().startsWith(label)) return;
    list.handleInput!(DOWN);
  }
  assert.fail(`no row ${label}`);
}

function press(list: Component, ...keys: string[]) {
  for (const key of keys) list.handleInput!(key);
}

function parse(text: string | undefined) {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Runs a command with scripted answers: `selects` in order, `confirms` in order, `keys` drive the settings list. */
async function run(command: string, { selects = [] as string[], confirms = [] as boolean[], keys = ((list) => press(list, ESC)) as Keys, ui = {}, overrides = {} } = {}) {
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
  piHud({ on() {}, exec: async () => ({}), registerCommand: (name: string, options: any) => commands.set(name, options) } as unknown as ExtensionAPI);
  const notices: string[] = [];
  const confirmed: string[] = [];
  let reloads = 0;
  let opened = false;
  const ctx = {
    hasUI: true,
    mode: "tui",
    reload: async () => void reloads++,
    ui: {
      notify: (message: string) => notices.push(message),
      select: async (_title: string, options: string[]) => {
        const answer = selects.shift();
        assert.ok(answer === undefined || options.includes(answer), `${answer} not in ${options}`);
        return answer;
      },
      confirm: async (title: string, message: string) => {
        confirmed.push(`${title}\n${message}`);
        return confirms.shift() ?? false;
      },
      custom: (factory: any) =>
        new Promise((resolve) => {
          opened = true;
          keys(factory({ requestRender() {} }, { fg: (_color: string, text: string) => text, bold: (text: string) => text }, {}, resolve));
        }),
      ...ui,
    },
    ...overrides,
  };
  await commands.get(command)!.handler("", ctx);
  const text = existsSync(configFile) ? readFileSync(configFile, "utf8") : undefined;
  return { notices, confirmed, reloads, opened, text, file: parse(text) };
}

test("configure toggles an Element, confirms the change, keeps other keys and reloads", async () => {
  writeFileSync(configFile, JSON.stringify({ pathLevels: 2, colors: { model: "red" }, futureField: 1, display: { showCost: true } }));
  const result = await run("pi-hud:configure", {
    keys: (list) => {
      go(list, "Output speed");
      press(list, ENTER, ESC);
    },
    confirms: [true],
  });
  assert.deepEqual(result.confirmed, ["Save pi-hud-plus config?\nOutput speed: off → on"]);
  assert.equal(result.file.display.showSpeed, true);
  assert.equal(result.file.display.showCost, true);
  assert.equal(result.file.pathLevels, 2);
  assert.deepEqual(result.file.colors, { model: "red" });
  assert.equal(result.file.futureField, 1);
  assert.equal(result.reloads, 1);
});

test("leaving the list with no changes writes nothing", async () => {
  writeFileSync(configFile, "{}");
  const result = await run("pi-hud:configure");
  assert.deepEqual(result.notices, ["No changes"]);
  assert.deepEqual(result.confirmed, []);
  assert.deepEqual(result.file, {});
  assert.equal(result.reloads, 0);
});

test("declining the confirm writes nothing", async () => {
  writeFileSync(configFile, "{}");
  const result = await run("pi-hud:configure", { keys: (list) => (go(list, "Cost"), press(list, ENTER, ESC)), confirms: [false] });
  assert.deepEqual(result.file, {});
  assert.equal(result.reloads, 0);
});

test("a config file that isn't a JSON object is never overwritten", async () => {
  for (const content of ["{ not json", "[1, 2]"]) {
    writeFileSync(configFile, content);
    const result = await run("pi-hud:configure");
    assert.equal(result.opened, false);
    assert.deepEqual(result.notices, [`pi-hud-plus: ${configFile} isn't a JSON object. Fix or delete it, then run the command again.`]);
    assert.equal(result.text, content);
  }
});


test("without an interactive UI the commands only say so", async () => {
  for (const command of ["pi-hud:configure", "pi-hud:setup"]) {
    for (const overrides of [{ hasUI: false }, { mode: "rpc" }]) {
      const result = await run(command, { overrides });
      assert.deepEqual(result.notices, [`pi-hud-plus: /${command} needs pi's interactive UI.`], JSON.stringify(overrides));
      assert.equal(result.opened, false);
    }
  }
});

test("setup asks layout, Preset and language, then saves the list it pre-filled", async () => {
  const result = await run("pi-hud:setup", { selects: ["compact", "Essential", "zh-Hans"], confirms: [true] });
  assert.deepEqual(result.confirmed, [
    "Save pi-hud-plus config?\nLayout: expanded → compact\nLanguage: en → zh-Hans\nTools activity: off → on\nSession duration: off → on",
  ]);
  assert.deepEqual(result.file, {
    lineLayout: "compact",
    showSeparators: false,
    language: "zh-Hans",
    display: { showTools: true, showDuration: true },
  });
  assert.equal(result.reloads, 1);
});

test("setup over an existing file asks first, and keeps the fields the list doesn't show", async () => {
  const existing = { colors: { model: "red" }, display: { contextWarningThreshold: 60, customLine: "old motto" } };
  writeFileSync(configFile, JSON.stringify(existing));
  const declined = await run("pi-hud:setup", { confirms: [false] });
  assert.equal(declined.opened, false);
  assert.deepEqual(declined.file, existing);

  const accepted = await run("pi-hud:setup", { selects: ["expanded", "Full", "en"], confirms: [true, true] });
  assert.match(accepted.confirmed[0]!, /^Overwrite pi-hud-plus config\?/);
  assert.deepEqual(accepted.file.colors, { model: "red" });
  assert.equal(accepted.file.display.contextWarningThreshold, 60);
  assert.equal(accepted.file.display.showMemoryUsage, true);
  assert.equal(accepted.file.display.showSpeed, true);
  assert.equal(accepted.file.display.customLine, "", "the Custom line is a guided row, so starting over clears it");
});

test("configure with no config file runs setup's questions", async () => {
  const result = await run("pi-hud:configure", { selects: ["compact+separators", "Minimal", "en"], confirms: [true] });
  // Minimal turns Usage limits off, as in claude-hud; it's on by default.
  assert.deepEqual(result.confirmed, ["Save pi-hud-plus config?\nLayout: expanded → compact+separators\nUsage limits: on → off"]);
  assert.deepEqual(result.file, { lineLayout: "compact", showSeparators: true, display: { showUsage: false } });
});

test("the Usage limits row toggles display.showUsage", async () => {
  writeFileSync(configFile, "{}");
  const result = await run("pi-hud:configure", { keys: (list) => (go(list, "Usage limits"), press(list, ENTER, ESC)), confirms: [true] });
  assert.deepEqual(result.confirmed, ["Save pi-hud-plus config?\nUsage limits: on → off"]);
  assert.deepEqual(result.file, { display: { showUsage: false } });
});

test("Full and Essential turn Usage limits on, Minimal off", async () => {
  for (const [name, expected] of [["Full", true], ["Essential", true], ["Minimal", false]] as const) {
    writeFileSync(configFile, JSON.stringify({ display: { showUsage: !expected } }));
    const result = await run("pi-hud:setup", { selects: ["expanded", name, "en"], confirms: [true, true] });
    assert.equal(result.file.display.showUsage, expected, name);
  }
});

test("Esc on a setup question stops without writing", async () => {
  const result = await run("pi-hud:setup", { selects: ["compact"] });
  assert.equal(result.opened, false);
  assert.equal(result.file, undefined);
});

test("the Git row cycles claude-hud's git styles and writes the matching gitStatus", async () => {
  writeFileSync(configFile, JSON.stringify({ gitStatus: { branchOverflow: "wrap" } }));
  const result = await run("pi-hud:configure", { keys: (list) => (go(list, "Git"), press(list, ENTER, ENTER, ESC)), confirms: [true] });
  assert.deepEqual(result.confirmed, ["Save pi-hud-plus config?\nGit: branch+dirty → file stats"]);
  assert.deepEqual(result.file.gitStatus, { branchOverflow: "wrap", enabled: true, showDirty: true, showAheadBehind: false, showFileStats: true });
});

test("the Custom line row takes typed text, sanitized and cut to 80 characters; empty removes it", async () => {
  writeFileSync(configFile, "{}");
  const typed = await run("pi-hud:configure", {
    keys: (list) => {
      go(list, "Custom line");
      press(list, ENTER, ..."ship it\x07 ", ..."x".repeat(90), ENTER, ESC);
    },
    confirms: [true],
  });
  const line = "ship it " + "x".repeat(72); // the BEL is stripped
  assert.deepEqual(typed.confirmed, [`Save pi-hud-plus config?\nCustom line: (none) → ${line}`]);
  assert.equal(typed.file.display.customLine, line);

  const removed = await run("pi-hud:configure", {
    keys: (list) => {
      go(list, "Custom line");
      press(list, ENTER, ENTER, ESC);
    },
    confirms: [true],
  });
  assert.deepEqual(removed.confirmed, [`Save pi-hud-plus config?\nCustom line: ${line} → (none)`]);
  assert.equal(removed.file.display.customLine, "");
});

test("Reset to preset rewrites the Element rows and leaves the list open for more edits", async () => {
  writeFileSync(configFile, JSON.stringify({ lineLayout: "compact" }));
  const result = await run("pi-hud:configure", {
    keys: (list) => {
      go(list, "Reset to preset");
      press(list, ENTER, ENTER); // Full is first
      go(list, "Cost");
      press(list, ENTER, ESC);
    },
    confirms: [true],
  });
  const turnedOn = ["Tools activity", "Environment line", "Output speed", "Session duration", "Session name", "Session tokens", "Thinking level", "Version", "Memory", "Prompt cache", "Session start date", "Last response time"];
  assert.deepEqual(result.confirmed, [["Save pi-hud-plus config?", ...turnedOn.map((label) => `${label}: off → on`)].join("\n")]);
  assert.equal(result.file.lineLayout, "compact");
});

test("an edit made to the file while the list is open is kept", async () => {
  writeFileSync(configFile, "{}");
  const result = await run("pi-hud:configure", {
    keys: (list) => {
      writeFileSync(configFile, JSON.stringify({ colors: { model: "red" } }));
      go(list, "Cost");
      press(list, ENTER, ESC);
    },
    confirms: [true],
  });
  assert.deepEqual(result.file, { colors: { model: "red" }, display: { showCost: true } });
});
