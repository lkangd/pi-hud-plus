import type { Language } from "./i18n/types.ts";

export type HudColorName =
  | "dim"
  | "red"
  | "green"
  | "yellow"
  | "magenta"
  | "cyan"
  | "brightBlue"
  | "brightMagenta";

/** A color value: named preset, 256-color index (0-255), or hex string (#rrggbb). */
export type HudColorValue = HudColorName | number | string;

export interface HudColorOverrides {
  context: HudColorValue;
  warning: HudColorValue;
  critical: HudColorValue;
  model: HudColorValue;
  project: HudColorValue;
  git: HudColorValue;
  gitBranch: HudColorValue;
  label: HudColorValue;
  custom: HudColorValue;
  barFilled: string;
  barEmpty: string;
}

// shortcut: only the fields the tracer-bullet HUD reads; the config ticket ports claude-hud's full HudConfig, merge and validation.
export interface HudConfig {
  language: Language;
  colors: Partial<HudColorOverrides>;
}

export const DEFAULT_CONFIG: HudConfig = {
  language: "en",
  colors: {},
};
