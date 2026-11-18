import { test } from "node:test";
import assert from "node:assert/strict";
import { codex, detectVendor, fetchJson, glm, parseCodexRateLimits, parseCodexUsage, parseGlmQuota } from "../src/usage-vendors.ts";

// Live 2026-11-18 responses (identifiers redacted). Plan pro reports only a weekly window.
const WHAM_WEEKLY_ONLY = {
  plan_type: "pro",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: { used_percent: 21, limit_window_seconds: 604800, reset_after_seconds: 429264, reset_at: 1795424567 },
    secondary_window: null,
  },
  code_review_rate_limit: null,
  additional_rate_limits: null,
  credits: { has_credits: false, unlimited: false, balance: "0" },
  rate_limit_reached_type: null,
};
const FRAME_WEEKLY_ONLY = {
  type: "codex.rate_limits",
  plan_type: "pro",
  rate_limits: {
    allowed: true,
    limit_reached: false,
    primary: { used_percent: 22, window_minutes: 10080, reset_after_seconds: 428536, reset_at: 1795424567 },
    secondary: null,
  },
  code_review_rate_limits: null,
  additional_rate_limits: null,
  credits: { has_credits: false, unlimited: false, balance: "0" },
  promo: null,
};
const RESET = new Date(1795424567 * 1000);
const none = { fiveHour: null, monthly: null, fiveHourResetAt: null, monthlyResetAt: null };

test("wham/usage: a weekly-only plan maps its primary window to Weekly by length", () => {
  assert.deepEqual(parseCodexUsage(WHAM_WEEKLY_ONLY), { ...none, sevenDay: 21, sevenDayResetAt: RESET });
});

test("wham/usage: 5h and weekly map by limit_window_seconds whichever slot they're in", () => {
  const body = {
    rate_limit: {
      limit_reached: false,
      primary_window: { used_percent: 64.6, limit_window_seconds: 604800, reset_at: 1795424567 },
      secondary_window: { used_percent: 12.2, limit_window_seconds: 18000, reset_at: 1795010000 },
    },
  };
  assert.deepEqual(parseCodexUsage(body), {
    ...none,
    fiveHour: 12,
    fiveHourResetAt: new Date(1795010000 * 1000),
    sevenDay: 65,
    sevenDayResetAt: RESET,
  });
});

test("codex.rate_limits frame: windows map by window_minutes", () => {
  assert.deepEqual(parseCodexRateLimits(FRAME_WEEKLY_ONLY), { ...none, sevenDay: 22, sevenDayResetAt: RESET });
  const swapped = {
    type: "codex.rate_limits",
    rate_limits: {
      primary: { used_percent: 140, window_minutes: 10080, reset_at: 0 },
      secondary: { used_percent: -3, window_minutes: 300 },
    },
  };
  assert.deepEqual(parseCodexRateLimits(swapped), { ...none, fiveHour: 0, sevenDay: 100, sevenDayResetAt: null });
});

test("limit_reached alone doesn't force 100; other window lengths are dropped", () => {
  const frame = { type: "codex.rate_limits", rate_limits: { limit_reached: true, primary: { used_percent: 40, window_minutes: 60 }, secondary: { used_percent: 30, window_minutes: 300 } } };
  assert.deepEqual(parseCodexRateLimits(frame), { ...none, fiveHour: 30, sevenDay: null, sevenDayResetAt: null });
});

test("malformed bodies and frames give no data", () => {
  for (const body of [null, "x", {}, { rate_limit: null }, { rate_limit: { primary_window: null, secondary_window: null } }, { rate_limit: { primary_window: { used_percent: "21", limit_window_seconds: 604800 } } }]) {
    assert.equal(parseCodexUsage(body), null, JSON.stringify(body));
  }
  for (const data of [null, { type: "response.created" }, { type: "codex.rate_limits" }, { type: "codex.rate_limits", rate_limits: { primary: { window_minutes: 300 } } }]) {
    assert.equal(parseCodexRateLimits(data), null, JSON.stringify(data));
  }
});

// ---- Fetch ----

const json = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const model = { api: "openai-codex-responses" } as Parameters<typeof codex.fetch>[0];

test("codex fetch: GET wham/usage with the Bearer key, parsed", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => json(WHAM_WEEKLY_ONLY));
  assert.deepEqual(await codex.fetch(model, "tok"), { ...none, sevenDay: 21, sevenDayResetAt: RESET });
  const [url, init] = fetch.mock.calls[0]!.arguments as unknown as [string, RequestInit];
  assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
  assert.deepEqual(init.headers, { Authorization: "Bearer tok" });
});

test("codex fetch: non-2xx, bad JSON, a bad shape or a network error give null", async (t) => {
  const replies = [() => json(WHAM_WEEKLY_ONLY, 401), () => json("<html>"), () => json({ rate_limit: null }), () => Promise.reject(new TypeError("fetch failed"))];
  for (const reply of replies) {
    t.mock.method(globalThis, "fetch", async () => reply());
    assert.equal(await codex.fetch(model, "tok"), null);
  }
});

test("fetchJson gives up after its timeout", async (t) => {
  t.mock.method(globalThis, "fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
  const keepAlive = setTimeout(() => {}, 1000); // AbortSignal.timeout's timer doesn't hold the event loop open
  assert.equal(await fetchJson("https://example.test", {}, 20), null);
  clearTimeout(keepAlive);
});

test("detectVendor: Codex by model.api, nothing for other models", () => {
  assert.equal(detectVendor(model), codex);
  assert.equal(detectVendor({ api: "openai-responses", provider: "openai-codex" } as typeof model), undefined);
  assert.equal(detectVendor(undefined), undefined);
});

// ---- GLM ----

// Live 2026-11-18 response, plan lite: 5h, weekly and monthly (tool calls) pools.
const GLM_LITE = {
  code: 200,
  msg: "Operation successful",
  data: {
    limits: [
      { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 7, nextResetTime: 1795008753799 },
      { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 4, nextResetTime: 1795421038983 },
      {
        type: "TIME_LIMIT",
        unit: 5,
        number: 1,
        usage: 100,
        currentValue: 2,
        remaining: 98,
        percentage: 2,
        nextResetTime: 1797153353984,
        usageDetails: [{ modelCode: "search-prime", usage: 1 }, { modelCode: "web-reader", usage: 1 }, { modelCode: "zread", usage: 0 }],
      },
    ],
    level: "lite",
  },
  success: true,
};
const GLM_USAGE = {
  fiveHour: 7,
  fiveHourResetAt: new Date(1795008753799),
  sevenDay: 4,
  sevenDayResetAt: new Date(1795421038983),
  monthly: 2,
  monthlyResetAt: new Date(1797153353984),
};

test("GLM quota: the lite plan's 5h, weekly and monthly pools map by type+unit+number, resets in ms", () => {
  assert.deepEqual(parseGlmQuota(GLM_LITE), GLM_USAGE);
});

test("GLM quota: a plan without the weekly pool, pools in another order, unknown pools dropped", () => {
  const body = {
    data: {
      limits: [
        { type: "TIME_LIMIT", unit: 5, number: 1, percentage: 150 },
        { type: "TOKENS_LIMIT", unit: 3, number: 1, percentage: 90, nextResetTime: 1795008753799 },
        { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 33.4, nextResetTime: 0 },
      ],
    },
  };
  assert.deepEqual(parseGlmQuota(body), { fiveHour: 33, fiveHourResetAt: null, sevenDay: null, sevenDayResetAt: null, monthly: 100, monthlyResetAt: null });
});

test("GLM quota: malformed bodies give no data", () => {
  const bodies = [
    null,
    "x",
    {},
    { code: 401, msg: "token expired", success: false },
    { data: { limits: null } },
    { data: { limits: [] } },
    { data: { limits: [null, { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: "7" }, { type: "OTHER", unit: 3, number: 5, percentage: 7 }] } },
  ];
  for (const body of bodies) assert.equal(parseGlmQuota(body), null, JSON.stringify(body));
});

const glmModel = (baseUrl: string) => ({ api: "openai-completions", baseUrl }) as typeof model;

test("GLM fetch: GET the quota endpoint on the model's host with the raw key", async (t) => {
  const cases = [
    ["https://open.bigmodel.cn/api/coding/paas/v4", "https://open.bigmodel.cn"],
    ["https://bigmodel.cn/api/anthropic", "https://open.bigmodel.cn"],
    ["https://api.z.ai/api/coding/paas/v4", "https://api.z.ai"],
  ];
  for (const [baseUrl, host] of cases) {
    const fetch = t.mock.method(globalThis, "fetch", async () => json(GLM_LITE));
    assert.deepEqual(await glm.fetch(glmModel(baseUrl!), "key.secret"), GLM_USAGE);
    const [url, init] = fetch.mock.calls[0]!.arguments as unknown as [string, RequestInit];
    assert.equal(url, `${host}/api/monitor/usage/quota/limit`);
    assert.deepEqual(init.headers, { Authorization: "key.secret", "Accept-Language": "en-US,en" });
  }
});

test("GLM fetch: non-2xx or a bad shape give null", async (t) => {
  for (const reply of [() => json(GLM_LITE, 401), () => json({ code: 1001, success: false })]) {
    t.mock.method(globalThis, "fetch", async () => reply());
    assert.equal(await glm.fetch(glmModel("https://open.bigmodel.cn/api/paas/v4"), "k"), null);
  }
});

test("detectVendor: GLM by baseUrl host, whatever the provider or api", () => {
  for (const baseUrl of ["https://open.bigmodel.cn/api/paas/v4", "https://bigmodel.cn/api/anthropic", "https://api.z.ai/api/anthropic"]) {
    assert.equal(detectVendor(glmModel(baseUrl)), glm, baseUrl);
  }
  for (const baseUrl of ["https://api.openai.com/v1", "https://evil.bigmodel.cn.example.com/v1", "https://z.ai/v1", "not a url", ""]) {
    assert.equal(detectVendor(glmModel(baseUrl)), undefined, baseUrl);
  }
});
