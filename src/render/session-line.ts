import type { RenderContext } from "../types.ts";
import { renderContextParts } from "./lines/identity.ts";
import { renderCompactGitPart, withGit } from "./lines/git.ts";
import { renderExtraLabel, renderModelBadge, renderProjectPath, renderVersion, withCustomLine } from "./lines/project.ts";
import { renderCost, renderSessionName, renderSessionTokensPart, renderSpeed } from "./lines/session-stats.ts";
import { renderDuration, renderSessionTimeLine } from "./lines/session-time.ts";

/** The compact layout's single Line: model badge + context bar, project, then the other Elements inline. */
export function renderSessionLine(ctx: RenderContext): string | null {
  const parts: string[] = [];

  const context = renderContextParts(ctx);
  const head = [
    renderModelBadge(ctx),
    context && ctx.config.display.showContextBar ? context.bar : null,
    context?.value ?? null,
  ].filter((part) => part !== null);
  if (head.length > 0) parts.push(head.join(" "));

  parts.push(...withGit(renderProjectPath(ctx), renderCompactGitPart(ctx), ctx.config));
  // Config counts go before the session tokens, prompt cache after the times
  // and the Extra command after speed, in claude-hud's order.
  for (const part of [
    renderSessionName(ctx),
    renderVersion(ctx),
    renderSessionTokensPart(ctx),
    renderDuration(ctx),
    renderSessionTimeLine(ctx),
    renderCost(ctx),
    renderSpeed(ctx),
    renderExtraLabel(ctx),
  ]) {
    if (part) parts.push(part);
  }

  const withCustom = withCustomLine(parts, ctx);
  return withCustom.length > 0 ? withCustom.join(" | ") : null;
}
