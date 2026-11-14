// Ported from claude-hud's zh cases in tests/render.test.js, session-time.test.js and prompt-cache.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { renderHud } from "../src/render/index.ts";
import { DEFAULT_CONFIG, type HudConfig } from "../src/config.ts";
import type { Language } from "../src/i18n/index.ts";
import type { HudSnapshot } from "../src/types.ts";

const LAST_REPLY = new Date(2026, 4, 8, 11, 30).getTime();
const NOW = LAST_REPLY + 3 * 60_000;

const snapshot: HudSnapshot = {
  model: { name: "Opus" },
  cwd: "/tmp/my-project",
  context: { tokens: 46_000, window: 200_000, percent: 23 },
  tools: [],
  now: NOW,
  session: {
    lastReplyAt: LAST_REPLY,
    totals: { input: 2_000, output: 250, cacheRead: 0, cacheWrite: 0, cost: 5.47 },
    subscription: false,
  },
};

const render = (language: Language, display: Partial<HudConfig["display"]> = {}) =>
  renderHud(
    snapshot,
    { ...DEFAULT_CONFIG, language, display: { ...DEFAULT_CONFIG.display, showModel: false, showProject: false, ...display } },
    200,
  ).map(strip);

for (const language of ["zh", "zh-Hans"] as const) {
  test(`${language} renders the context label in Chinese`, () => {
    assert.ok(render(language).join("\n").includes("上下文"));
  });

  test(`${language} renders relative times without a stray space`, () => {
    assert.ok(render(language, { showLastResponseAt: true }).includes("上次回复: 3m前"));
  });

  test(`${language} renders the expired prompt cache`, () => {
    const lines = render(language, { showPromptCache: true, promptCacheTtlSeconds: 60 });
    assert.ok(lines.includes("缓存 ⏱ 已过期"), lines.join("\n"));
  });

  test(`${language} renders cost and token labels`, () => {
    const text = render(language, { showCost: true, showSessionTokens: true }).join("\n");
    assert.ok(text.includes("费用 $5.47"), text);
    assert.ok(text.includes("令牌 2k (输入: 2k, 输出: 250)"), text);
  });
}

test("en renders English labels, and a zh render does not leak into the next call", () => {
  render("zh");
  const text = render("en", { showLastResponseAt: true, showPromptCache: true, promptCacheTtlSeconds: 60, showCost: true }).join("\n");
  assert.ok(text.includes("Context"), text);
  assert.ok(text.includes("Last reply: 3m ago"), text);
  assert.ok(text.includes("Cache ⏱ expired"), text);
  assert.ok(text.includes("Cost $5.47"), text);
});

test("zh renders the Environment line counts in Chinese", () => {
  const config: HudConfig = { ...DEFAULT_CONFIG, language: "zh", display: { ...DEFAULT_CONFIG.display, showConfigCounts: true } };
  const environment = { contextFiles: 2, skills: 5, prompts: 1, mcps: 3 };
  const lines = renderHud({ ...snapshot, model: null, context: null, environment }, config, 200).map(strip);
  assert.ok(lines.includes("2 AGENTS.md | 5 技能 | 1 提示词 | 3 MCPs"), lines.join("\n"));
});
