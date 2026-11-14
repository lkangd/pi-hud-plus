import { getAgentDir, type ExtensionAPI, type ExtensionContext, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { renderHud } from "./render/index.ts";
import type { HudSnapshot } from "./types.ts";

interface Session {
  generation: number;
  snapshot: HudSnapshot;
  requestRender?: () => void;
  /** Another extension took the footer: the HUD is dormant until the next session_start. */
  displaced: boolean;
  displacedNotice?: ReturnType<typeof setTimeout>;
}

// On globalThis, not module scope: /reload re-imports this module, and the notice must fire once per pi process.
const NOTICE_SHOWN = Symbol.for("pi-hud-plus.displacedNoticeShown");
const globals = globalThis as { [NOTICE_SHOWN]?: boolean };
// On /reload pi resets our footer just before session_shutdown; waiting lets that shutdown cancel the notice.
const NOTICE_DELAY_MS = 1000;
const DISPLACED_NOTICE =
  "pi-hud-plus: another extension took over pi's footer, so the HUD is hidden. Disable that extension (e.g. pi-powerbar, via `pi config`) to see the HUD.";

/** Pi adapter: owns the footer and keeps the cached HUD snapshot up to date. */
export default function piHud(pi: ExtensionAPI): void {
  // Bumped on every session start/shutdown. Async work captures it and checks isLive(gen) before touching anything.
  let generation = 0;
  let session: Session | undefined;
  // Set around our own setFooter calls so the dispose() they trigger isn't mistaken for displacement.
  let ownCall = false;

  const setFooter = (ui: ExtensionUIContext, factory: Parameters<ExtensionUIContext["setFooter"]>[0]) => {
    ownCall = true;
    try {
      ui.setFooter(factory);
    } finally {
      ownCall = false;
    }
  };

  /** The shared dormant check: false once the session `gen` has ended or the HUD is Displaced. Every handler and job consults it. */
  const isLive = (gen: number) => session?.generation === gen && !session.displaced;

  const update = (gen: number, patch: Partial<HudSnapshot>) => {
    if (!isLive(gen)) return;
    session!.snapshot = { ...session!.snapshot, ...patch };
    session!.requestRender?.();
  };

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    const current: Session = (session = {
      generation: ++generation,
      snapshot: { model: ctx.model ? { name: ctx.model.name } : null, cwd: ctx.cwd },
      displaced: false,
    });
    const config = loadConfig(ctx.cwd, getAgentDir());
    setFooter(ctx.ui, (tui) => {
      current.requestRender = () => tui.requestRender();
      return {
        render: (width) => renderHud(current.snapshot, config, width),
        invalidate() {},
        dispose() {
          if (ownCall || current.displaced) return;
          current.displaced = true;
          current.displacedNotice = setTimeout(() => {
            if (globals[NOTICE_SHOWN]) return;
            globals[NOTICE_SHOWN] = true;
            ctx.ui.notify(DISPLACED_NOTICE, "warning");
          }, NOTICE_DELAY_MS);
        },
      };
    });
  });

  pi.on("model_select", (event) => {
    update(generation, { model: { name: event.model.name } });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (!session) return;
    const { displaced, displacedNotice } = session;
    clearTimeout(displacedNotice);
    session = undefined;
    generation++;
    // Only while we still own the footer: otherwise this would wipe the other extension's footer.
    if (!displaced) setFooter(ctx.ui, undefined);
  });
}
