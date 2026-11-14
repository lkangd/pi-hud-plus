import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { HudConfig, HudElement } from "../config.ts";
import { setLanguage } from "../i18n/index.ts";
import type { HudSnapshot, RenderContext } from "../types.ts";
import { dim } from "./colors.ts";
import { renderIdentityLine } from "./lines/identity.ts";
import { renderMemoryLine } from "./lines/memory.ts";
import { renderPromptCacheLine } from "./lines/prompt-cache.ts";
import { renderProjectLine } from "./lines/project.ts";
import { renderSessionTimeLine } from "./lines/session-time.ts";
import { renderSessionTokensLine } from "./lines/session-stats.ts";
import { renderSessionLine } from "./session-line.ts";
import { renderToolsLine } from "./tools-line.ts";

type ElementRenderer = (ctx: RenderContext, alignProgressLabels: boolean) => string | null;

const notPortedYet: ElementRenderer = () => null;

/** One Line module per Element. Elements whose module isn't ported yet render nothing. */
const ELEMENT_RENDERERS: Record<HudElement, ElementRenderer> = {
  project: renderProjectLine,
  context: renderIdentityLine,
  promptCache: renderPromptCacheLine,
  memory: renderMemoryLine,
  environment: notPortedYet,
  tools: (ctx) => (ctx.config.display.showTools ? renderToolsLine(ctx) : null),
  sessionTime: renderSessionTimeLine,
};

/** Activity Lines go after the separator. claude-hud's agents and todos have no Pi equivalent. */
const ACTIVITY_ELEMENTS = new Set<HudElement>(["tools"]);

function makeSeparator(length: number): string {
  return dim("─".repeat(Math.max(1, length)));
}

function buildMergeGroupLookup(mergeGroups: HudElement[][]): Map<HudElement, Set<HudElement>> {
  const lookup = new Map<HudElement, Set<HudElement>>();
  for (const group of mergeGroups) {
    const groupSet = new Set(group);
    for (const element of group) {
      if (!lookup.has(element)) lookup.set(element, groupSet);
    }
  }
  return lookup;
}

function collectMergeSequence(
  elementOrder: HudElement[],
  startIndex: number,
  seen: Set<HudElement>,
  group: Set<HudElement>,
): HudElement[] {
  const sequence: HudElement[] = [];
  for (let index = startIndex; index < elementOrder.length; index += 1) {
    const element = elementOrder[index];
    if (seen.has(element) || !group.has(element)) break;
    sequence.push(element);
  }
  return sequence;
}

function renderElementLine(ctx: RenderContext, element: HudElement, options?: { alignProgressLabels?: boolean }): string | null {
  return ELEMENT_RENDERERS[element](ctx, options?.alignProgressLabels ?? false);
}

function renderExpanded(ctx: RenderContext): Array<{ line: string; isActivity: boolean }> {
  const { elementOrder } = ctx.config;
  const mergeGroupLookup = buildMergeGroupLookup(ctx.config.display.mergeGroups);
  const seen = new Set<HudElement>();
  const lines: Array<{ line: string; isActivity: boolean }> = [];

  for (let index = 0; index < elementOrder.length; index += 1) {
    const element = elementOrder[index];
    if (seen.has(element)) continue;

    const mergeGroup = mergeGroupLookup.get(element);
    if (mergeGroup) {
      const mergeSequence = collectMergeSequence(elementOrder, index, seen, mergeGroup);

      if (mergeSequence.length > 1) {
        index += mergeSequence.length - 1;
        for (const groupedElement of mergeSequence) seen.add(groupedElement);

        const renderedGroupLines = mergeSequence
          .map((groupedElement) => ({ element: groupedElement, line: renderElementLine(ctx, groupedElement) }))
          .filter((entry): entry is { element: HudElement; line: string } => typeof entry.line === "string" && entry.line.length > 0);

        if (renderedGroupLines.length > 1) {
          const combinedLine = renderedGroupLines.map(({ line }) => line).join(" │ ");
          if (visibleWidth(combinedLine) <= ctx.width) {
            lines.push({
              line: combinedLine,
              isActivity: renderedGroupLines.some(({ element: groupedElement }) => ACTIVITY_ELEMENTS.has(groupedElement)),
            });
          } else {
            for (const { element: groupedElement, line } of renderedGroupLines) {
              const stackedLine = renderElementLine(ctx, groupedElement, { alignProgressLabels: true }) ?? line;
              lines.push({ line: stackedLine, isActivity: ACTIVITY_ELEMENTS.has(groupedElement) });
            }
          }
        } else if (renderedGroupLines.length === 1) {
          const [{ element: groupedElement, line }] = renderedGroupLines;
          lines.push({ line, isActivity: ACTIVITY_ELEMENTS.has(groupedElement) });
        }

        continue;
      }
    }

    seen.add(element);

    const line = renderElementLine(ctx, element);
    if (!line) continue;
    lines.push({ line, isActivity: ACTIVITY_ELEMENTS.has(element) });
  }

  // claude-hud's git files Line goes here, always last.
  return lines;
}

function collectActivityLines(ctx: RenderContext): string[] {
  const toolsLine = ctx.config.display.showTools ? renderToolsLine(ctx) : null;
  return toolsLine ? [toolsLine] : [];
}

/** Render core: pure, no pi imports beyond pi-tui width helpers. Ported from claude-hud's render/index. */
export function renderHud(snapshot: HudSnapshot, config: HudConfig, width: number): string[] {
  if (width <= 0) return [];
  setLanguage(config.language);
  const ctx: RenderContext = { snapshot, config, width };
  const { showSeparators } = config;

  let lines: string[];

  if (config.lineLayout === "expanded") {
    const renderedLines = renderExpanded(ctx);
    lines = renderedLines.map(({ line }) => line);
    const sessionTokensLine = renderSessionTokensLine(ctx);
    if (sessionTokensLine) lines.push(sessionTokensLine);

    if (showSeparators) {
      const firstActivityIndex = renderedLines.findIndex(({ isActivity }) => isActivity);
      if (firstActivityIndex > 0) {
        const separatorBaseWidth = Math.max(...renderedLines.slice(0, firstActivityIndex).map(({ line }) => visibleWidth(line)), 20);
        lines.splice(firstActivityIndex, 0, makeSeparator(Math.min(separatorBaseWidth, width)));
      }
    }
  } else {
    const sessionLine = renderSessionLine(ctx);
    const headerLines = sessionLine ? [sessionLine] : [];
    const activityLines = collectActivityLines(ctx);
    lines = [...headerLines];

    if (showSeparators && activityLines.length > 0) {
      const maxWidth = Math.max(...headerLines.map((line) => visibleWidth(line)), 20);
      lines.push(makeSeparator(Math.min(maxWidth, width)));
    }

    lines.push(...activityLines);
  }

  // pi lays out each Line itself, so never let one wrap.
  return lines.flatMap((line) => line.split("\n")).map((line) => truncateToWidth(line, width, "…"));
}
