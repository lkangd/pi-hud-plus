import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { renderHud } from "./render/index.ts";
import type { HudSnapshot } from "./types.ts";

interface Session {
  generation: number;
  snapshot: HudSnapshot;
  requestRender?: () => void;
}

/** Pi adapter: owns the footer and keeps the cached HUD snapshot up to date. */
export default function piHud(pi: ExtensionAPI): void {
  // Bumped on every session start/shutdown. Async work captures it and passes it to update(), which drops stale results.
  let generation = 0;
  let session: Session | undefined;

  const update = (gen: number, patch: Partial<HudSnapshot>) => {
    if (!session || session.generation !== gen) return;
    session.snapshot = { ...session.snapshot, ...patch };
    session.requestRender?.();
  };

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    const current: Session = (session = {
      generation: ++generation,
      snapshot: { model: ctx.model ? { name: ctx.model.name } : null, cwd: ctx.cwd },
    });
    const config = loadConfig(ctx.cwd, getAgentDir());
    ctx.ui.setFooter((tui) => {
      current.requestRender = () => tui.requestRender();
      return {
        render: (width) => renderHud(current.snapshot, config, width),
        invalidate() {},
      };
    });
  });

  pi.on("model_select", (event) => {
    update(generation, { model: { name: event.model.name } });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (!session) return;
    session = undefined;
    generation++;
    ctx.ui.setFooter(undefined);
  });
}
