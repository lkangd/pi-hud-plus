// Native Usage limits: one entry per vendor, detected from the current model. Adding a vendor = a detect plus a fetch.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDebug } from "./debug.ts";
import { sanitizeBalanceLabel } from "./external-usage.ts";
import type { UsageLimit } from "./types.ts";

export type UsageModel = NonNullable<ExtensionContext["model"]>;

export interface UsageVendor {
  name: string;
  /** From the model, not the provider id, so renamed and custom providers work. */
  detect(model: UsageModel): boolean;
  /** The vendor's Usage limit or Balance; null on any failure (logged, never thrown). */
  fetch(model: UsageModel, apiKey: string): Promise<UsageLimit | null>;
}

const FETCH_TIMEOUT_MS = 10_000;
// Messages never include the key or response bodies.
const debug = createDebug("usage");

/** A guarded GET: the parsed JSON body, or null on timeout, network error, non-2xx or bad JSON. */
export async function fetchJson(url: string, headers: Record<string, string>, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      debug(`GET ${url} failed with HTTP ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    debug(`GET ${url} failed: ${(error as Error)?.name ?? "error"}`);
    return null;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function percent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : null;
}

/** Epoch seconds → Date; null when missing or ≤0. */
function resetDate(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;
}

/** Codex windows mapped by length in minutes (300 → 5h, 10080 → weekly); any other length is dropped. */
function codexLimit(windows: unknown[], minutesOf: (window: Record<string, unknown>) => unknown): UsageLimit | null {
  const usage: UsageLimit = { fiveHour: null, sevenDay: null, monthly: null, fiveHourResetAt: null, sevenDayResetAt: null, monthlyResetAt: null };
  for (const window of windows) {
    if (!isObject(window)) continue;
    const used = percent(window.used_percent);
    if (used === null) continue;
    const minutes = minutesOf(window);
    if (minutes === 300) [usage.fiveHour, usage.fiveHourResetAt] = [used, resetDate(window.reset_at)];
    else if (minutes === 10080) [usage.sevenDay, usage.sevenDayResetAt] = [used, resetDate(window.reset_at)];
  }
  return usage.fiveHour === null && usage.sevenDay === null ? null : usage;
}

/** `GET wham/usage`'s body: `rate_limit.{primary_window, secondary_window}`, sized by limit_window_seconds. */
export function parseCodexUsage(body: unknown): UsageLimit | null {
  if (!isObject(body) || !isObject(body.rate_limit)) return null;
  const { primary_window, secondary_window } = body.rate_limit;
  return codexLimit([primary_window, secondary_window], (w) => (typeof w.limit_window_seconds === "number" ? w.limit_window_seconds / 60 : null));
}

/** A `codex.rate_limits` stream frame: `rate_limits.{primary, secondary}`, sized by window_minutes. Null for any other frame. */
export function parseCodexRateLimits(data: unknown): UsageLimit | null {
  if (!isObject(data) || data.type !== "codex.rate_limits" || !isObject(data.rate_limits)) return null;
  const { primary, secondary } = data.rate_limits;
  return codexLimit([primary, secondary], (w) => w.window_minutes);
}

export const codex: UsageVendor = {
  name: "codex",
  detect: (model) => model.api === "openai-codex-responses",
  async fetch(_model, apiKey) {
    const usage = parseCodexUsage(await fetchJson("https://chatgpt.com/backend-api/wham/usage", { Authorization: `Bearer ${apiKey}` }));
    if (!usage) debug("codex: no usable rate_limit in wham/usage");
    return usage;
  },
};

/** GLM `data.limits[]` pools, matched by type+unit+number (never index); any other pool is dropped. */
const GLM_WINDOWS: Record<string, "fiveHour" | "sevenDay" | "monthly"> = {
  "TOKENS_LIMIT/3/5": "fiveHour",
  "TOKENS_LIMIT/6/1": "sevenDay",
  "TIME_LIMIT/5/1": "monthly",
};

/** `GET /api/monitor/usage/quota/limit`'s body: `data.limits[]` with `percentage` used and `nextResetTime` in epoch ms. */
export function parseGlmQuota(body: unknown): UsageLimit | null {
  if (!isObject(body) || !isObject(body.data) || !Array.isArray(body.data.limits)) return null;
  const usage: UsageLimit = { fiveHour: null, sevenDay: null, monthly: null, fiveHourResetAt: null, sevenDayResetAt: null, monthlyResetAt: null };
  for (const limit of body.data.limits) {
    if (!isObject(limit)) continue;
    const window = GLM_WINDOWS[`${limit.type}/${limit.unit}/${limit.number}`];
    const used = percent(limit.percentage);
    if (!window || used === null) continue;
    usage[window] = used;
    usage[`${window}ResetAt`] = typeof limit.nextResetTime === "number" ? resetDate(limit.nextResetTime / 1000) : null;
  }
  return usage.fiveHour === null && usage.sevenDay === null && usage.monthly === null ? null : usage;
}

/** The quota host for a GLM model's baseUrl (CN or international), or undefined for any other model. */
function glmHost(model: UsageModel): string | undefined {
  const host = URL.parse(model.baseUrl)?.hostname;
  if (host === "open.bigmodel.cn" || host === "bigmodel.cn") return "https://open.bigmodel.cn";
  if (host === "api.z.ai") return "https://api.z.ai"; // international host unverified live
  return undefined;
}

export const glm: UsageVendor = {
  name: "glm",
  detect: (model) => glmHost(model) !== undefined,
  async fetch(model, apiKey) {
    const url = `${glmHost(model)}/api/monitor/usage/quota/limit`;
    // The raw key, no Bearer: the documented form.
    const usage = parseGlmQuota(await fetchJson(url, { Authorization: apiKey, "Accept-Language": "en-US,en" }));
    if (!usage) debug("glm: no usable limits in quota/limit");
    return usage;
  },
};

const CURRENCY_SYMBOLS: Record<string, string> = { CNY: "¥", USD: "$" };

/** `GET /user/balance`'s body: each `balance_infos` entry as `<symbol><total_balance>`, joined by a space. */
export function parseDeepSeekBalance(body: unknown): UsageLimit | null {
  if (!isObject(body) || !Array.isArray(body.balance_infos)) return null;
  const parts = body.balance_infos
    .filter((info): info is Record<string, unknown> => isObject(info) && typeof info.currency === "string" && typeof info.total_balance === "string")
    .map((info) => `${CURRENCY_SYMBOLS[info.currency as string] ?? `${info.currency} `}${info.total_balance}`);
  const balanceLabel = sanitizeBalanceLabel(parts.join(" "));
  if (!balanceLabel) return null;
  return { fiveHour: null, sevenDay: null, monthly: null, fiveHourResetAt: null, sevenDayResetAt: null, monthlyResetAt: null, balanceLabel };
}

export const deepseek: UsageVendor = {
  name: "deepseek",
  detect: (model) => URL.parse(model.baseUrl)?.hostname === "api.deepseek.com",
  async fetch(_model, apiKey) {
    const usage = parseDeepSeekBalance(await fetchJson("https://api.deepseek.com/user/balance", { Authorization: `Bearer ${apiKey}` }));
    if (!usage) debug("deepseek: no usable balance_infos in user/balance");
    return usage;
  },
};

const VENDORS: UsageVendor[] = [codex, glm, deepseek];

export const detectVendor = (model: UsageModel | undefined): UsageVendor | undefined => (model ? VENDORS.find((vendor) => vendor.detect(model)) : undefined);
