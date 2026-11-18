// Ported from claude-hud src/debug.ts. pi owns the terminal, so lines go to a file in pi's agent dir instead of stderr.
import { appendFileSync } from "node:fs";
import path from "node:path";
import { format } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * A namespaced logger, enabled by DEBUG=pi-hud-plus or DEBUG=*.
 * Writes to ~/.pi/agent/pi-hud-plus-debug.log.
 */
export function createDebug(namespace: string) {
  return function debug(msg: string, ...args: unknown[]): void {
    const env = process.env.DEBUG;
    if (!env?.includes("pi-hud-plus") && env !== "*") return;
    try {
      appendFileSync(path.join(getAgentDir(), "pi-hud-plus-debug.log"), `${new Date().toISOString()} [pi-hud-plus:${namespace}] ${format(msg, ...args)}\n`, { mode: 0o600 });
    } catch {
      // Logging must never break the HUD
    }
  };
}
