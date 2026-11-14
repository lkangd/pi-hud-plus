import { visibleWidth } from "@earendil-works/pi-tui";
import type { HudColorOverrides } from "../../config.ts";
import { t, type MessageKey } from "../../i18n/index.ts";
import { label } from "../colors.ts";

// claude-hud also aligned its usage/weekly labels; with those dropped, padding is a no-op until another progress label joins.
const PROGRESS_LABEL_KEYS: MessageKey[] = ["label.context"];

/** A progress-bar label, right-padded to the widest one when `align` is set (stacked merge-group Lines). */
export function progressLabel(key: MessageKey, colors?: Partial<HudColorOverrides>, align = false): string {
  const text = t(key);
  if (!align) return label(text, colors);
  const pad = Math.max(...PROGRESS_LABEL_KEYS.map((k) => visibleWidth(t(k)))) - visibleWidth(text);
  return label(pad > 0 ? text + " ".repeat(pad) : text, colors);
}
