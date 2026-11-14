import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { HudSession, UsageTotals } from "./types.ts";

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } };

/** Sums every usage-bearing entry, exactly like pi's built-in footer (`getSessionStats`). */
function sumEntries(entries: SessionEntry[]): { totals: UsageTotals; lastReplyAt?: number } {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let lastReplyAt: number | undefined;
  const add = (u: Usage) => {
    totals.input += u.input;
    totals.output += u.output;
    totals.cacheRead += u.cacheRead;
    totals.cacheWrite += u.cacheWrite;
    totals.cost += u.cost.total;
  };
  for (const entry of entries) {
    if (entry.type === "usage") {
      add(entry.usage);
    } else if (entry.type === "message" && entry.message.role === "assistant") {
      add(entry.message.usage);
      lastReplyAt = Date.parse(entry.timestamp);
    } else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
      add(entry.message.usage);
    } else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
      add(entry.usage);
    }
  }
  return { totals, lastReplyAt };
}

/** pi's footer `(sub)`: kimi-coding, or an OAuth login to a subscription provider. */
function isSubscription({ modelRegistry }: ExtensionContext, model: ExtensionContext["model"]): boolean {
  if (!model) return false;
  if (model.provider === "kimi-coding") return true;
  return modelRegistry.isUsingOAuth(model) && modelRegistry.getProvider(model.provider)?.auth.oauth?.isSubscription === true;
}

/** Reads the HUD's session data. Like pi's footer, the entry scan is memoised by session, leaf, entry count and model. */
export function createSessionReader(): (pi: ExtensionAPI, ctx: ExtensionContext, model?: ExtensionContext["model"]) => HudSession {
  let memo: { key: string; totals: UsageTotals; lastReplyAt?: number } | undefined;

  return (pi, ctx, model = ctx.model) => {
    const sessionManager = ctx.sessionManager;
    const entries = sessionManager.getEntries();
    const key = [sessionManager.getSessionId(), sessionManager.getLeafId(), entries.length, model?.provider, model?.id].join("\0");
    if (memo?.key !== key) memo = { key, ...sumEntries(entries) };
    const header = sessionManager.getHeader();
    return {
      name: pi.getSessionName(),
      startedAt: header ? Date.parse(header.timestamp) : undefined,
      lastReplyAt: memo.lastReplyAt,
      totals: memo.totals,
      subscription: isSubscription(ctx, model),
    };
  };
}
