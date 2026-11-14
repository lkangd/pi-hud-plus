import type { RenderContext } from "../types.ts";
import { renderContextParts } from "./lines/identity.ts";
import { renderCompactGitPart, withGit } from "./lines/git.ts";
import { renderModelBadge, renderProjectPath, renderVersion, withCustomLine } from "./lines/project.ts";

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
  // The other inline Elements go here, in claude-hud's order, before the Custom line: session name before
  // version; config counts, session tokens, duration, times, prompt cache, cost, speed, Extra command after.
  const version = renderVersion(ctx);
  if (version) parts.push(version);

  const withCustom = withCustomLine(parts, ctx);
  return withCustom.length > 0 ? withCustom.join(" | ") : null;
}
