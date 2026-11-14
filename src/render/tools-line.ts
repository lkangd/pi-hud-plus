import type { RenderContext } from "../types.ts";
import { cyan, green, label, yellow } from "./colors.ts";

const ELLIPSIS = "…";
const MCP_TOOL_NAME_PATTERN = /^mcp__.+__.+$/;

export function shortenToolName(name: string, maxLen: number): string {
  if (maxLen === 0) return name;
  const displayName = MCP_TOOL_NAME_PATTERN.test(name) ? (name.split("__").pop() ?? name) : name;
  if (displayName.length <= maxLen) return displayName;
  return `${displayName.slice(0, Math.max(0, maxLen - 1))}${ELLIPSIS}`;
}

export function renderToolsLine({ snapshot, config }: RenderContext): string | null {
  const { tools } = snapshot;
  const colors = config.colors;
  const { toolNameMaxLength, toolsMaxVisible } = config.display;
  if (!config.display.showTools || tools.length === 0) return null;

  const parts: string[] = [];
  const runningTools = tools.filter((tool) => tool.status === "running");
  const completedTools = tools.filter((tool) => tool.status === "completed" || tool.status === "error");

  for (const tool of runningTools.slice(-2)) {
    const target = tool.target ? truncatePath(tool.target) : "";
    const name = shortenToolName(tool.name, toolNameMaxLength);
    parts.push(`${yellow("◐")} ${cyan(name)}${target ? label(`: ${target}`, colors) : ""}`);
  }

  const toolCounts = new Map<string, number>();
  for (const tool of completedTools) toolCounts.set(tool.name, (toolCounts.get(tool.name) ?? 0) + 1);

  const sortedTools = Array.from(toolCounts.entries()).sort((a, b) => b[1] - a[1]);
  const visibleTools = toolsMaxVisible === 0 ? sortedTools : sortedTools.slice(0, toolsMaxVisible);
  for (const [name, count] of visibleTools) {
    parts.push(`${green("✓")} ${shortenToolName(name, toolNameMaxLength)} ${label(`×${count}`, colors)}`);
  }

  const hiddenToolCount = toolsMaxVisible === 0 ? 0 : sortedTools.length - visibleTools.length;
  if (hiddenToolCount > 0) parts.push(label(`+${hiddenToolCount} more`, colors));

  return parts.length > 0 ? parts.join(" | ") : null;
}

function truncatePath(path: string, maxLen = 20): string {
  const normalizedPath = path.replace(/\\/g, "/");
  if (normalizedPath.length <= maxLen) return normalizedPath;
  const filename = normalizedPath.split("/").pop() || normalizedPath;
  if (filename.length >= maxLen) return filename.slice(0, maxLen - 3) + "...";
  return ".../" + filename;
}
