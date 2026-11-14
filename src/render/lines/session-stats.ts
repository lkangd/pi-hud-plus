import { t } from "../../i18n/index.ts";
import type { RenderContext, UsageTotals } from "../../types.ts";
import { label } from "../colors.ts";
import { sanitize } from "./project.ts";

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return n.toString();
}

/** claude-hud's `formatUsd`. */
function formatUsd(amount: number): string {
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(4)}`;
}

const totalTokens = (totals: UsageTotals) => totals.input + totals.output + totals.cacheRead + totals.cacheWrite;

export function renderSessionName({ snapshot, config }: RenderContext): string | null {
  const name = snapshot.session?.name;
  if (!config.display.showSessionName || !name) return null;
  return label(sanitize(name), config.colors);
}

/** Shown, like pi's footer, when there is a cost or a subscription. */
export function renderCost({ snapshot, config }: RenderContext): string | null {
  const session = snapshot.session;
  if (!config.display.showCost || !session || (session.totals.cost <= 0 && !session.subscription)) return null;
  const sub = session.subscription ? " (sub)" : "";
  return label(`${t("label.cost")} ${formatUsd(session.totals.cost)}${sub}`, config.colors);
}

export function renderSpeed({ snapshot, config }: RenderContext): string | null {
  if (!config.display.showSpeed || snapshot.speed === undefined) return null;
  return label(`${t("format.out")}: ${snapshot.speed.toFixed(1)} ${t("format.tokPerSec")}`, config.colors);
}

/** The compact session Line's inline form of the session tokens Line. */
export function renderSessionTokensPart({ snapshot, config }: RenderContext): string | null {
  const totals = snapshot.session?.totals;
  if (!config.display.showSessionTokens || !totals || totalTokens(totals) === 0) return null;
  return label(
    `${t("format.tok")}: ${formatTokens(totalTokens(totals))} (${t("format.in")}: ${formatTokens(totals.input)}, ${t("format.out")}: ${formatTokens(totals.output)})`,
    config.colors,
  );
}

/** The expanded layout's session tokens Line. */
export function renderSessionTokensLine({ snapshot, config }: RenderContext): string | null {
  const totals = snapshot.session?.totals;
  if (!config.display.showSessionTokens || !totals || totalTokens(totals) === 0) return null;
  const parts = [`${t("format.in")}: ${formatTokens(totals.input)}`, `${t("format.out")}: ${formatTokens(totals.output)}`];
  const cache = totals.cacheRead + totals.cacheWrite;
  if (cache > 0) parts.push(`${t("format.cache")}: ${formatTokens(cache)}`);
  return label(`${t("label.tokens")} ${formatTokens(totalTokens(totals))} (${parts.join(", ")})`, config.colors);
}
