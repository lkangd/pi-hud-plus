import type { HudConfig } from "./config.ts";

/** Whether any enabled Element changes with time alone, so the HUD needs the clock. Add new ticking Elements here. */
export function hasTickingElement({ display }: HudConfig): boolean {
  const relativeTimes = display.timeFormat !== "absolute" && (display.showSessionStartDate || display.showLastResponseAt);
  // Usage: reset countdowns, and the External usage snapshot is re-read each tick for freshness.
  const usage = display.showUsage && display.externalUsagePath !== "";
  return display.showDuration || relativeTimes || display.showPromptCache || display.showMemoryUsage || usage;
}

/** A 1s clock that doesn't keep pi alive. Returns its stop function. */
export function startClock(onTick: (now: number) => void): () => void {
  const timer = setInterval(() => onTick(Date.now()), 1000);
  timer.unref();
  return () => clearInterval(timer);
}
