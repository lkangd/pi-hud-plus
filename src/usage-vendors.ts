// Native Usage limits: one entry per vendor, detected from the current model. Adding a vendor = a detect plus a fetch.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDebug } from "./debug.ts";
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

const VENDORS: UsageVendor[] = [codex];

export const detectVendor = (model: UsageModel | undefined): UsageVendor | undefined => (model ? VENDORS.find((vendor) => vendor.detect(model)) : undefined);
