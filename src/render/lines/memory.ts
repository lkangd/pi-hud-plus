import type { RenderContext } from "../../types.ts";
import { formatBytes } from "../../memory.ts";
import { getQuotaColor, label, quotaBar, RESET } from "../colors.ts";
import { t } from "../../i18n/index.ts";
import { barWidth } from "./context.ts";

/** Ported from claude-hud's render/lines/memory. Expanded layout only, like claude-hud. */
export function renderMemoryLine({ snapshot, config, width }: RenderContext): string | null {
  const { memory } = snapshot;
  if (config.lineLayout !== "expanded" || !config.display.showMemoryUsage || !memory) return null;

  const colors = config.colors;
  const memoryLabel = label(t("label.approxRam"), colors);
  const percent = `${getQuotaColor(memory.usedPercent, colors)}${memory.usedPercent}%${RESET}`;
  const bar = quotaBar(memory.usedPercent, barWidth(width), colors);
  return `${memoryLabel} ${bar} ${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)} (${percent})`;
}
