import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionUIContext,
  type MessageUpdateEvent,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, type HudConfig } from "./config.ts";
import { getGitStatus } from "./git.ts";
import { renderHud } from "./render/index.ts";
import type { HudContext, HudSnapshot } from "./types.ts";

interface Session {
  generation: number;
  snapshot: HudSnapshot;
  requestRender?: () => void;
  /** Another extension took the footer: the HUD is dormant until the next session_start. */
  displaced: boolean;
  displacedNotice?: ReturnType<typeof setTimeout>;
  git?: GitJob;
  /** Context from the streaming reply's usage; wins over getContextUsage() until a clearing event. */
  liveContext?: HudContext;
  /** The latest reply's prompt split, for the token breakdown. */
  // shortcut: only replies seen since session_start feed it, so a resumed session shows no breakdown until the next reply; seed it from sessionManager's last assistant entry if that matters.
  breakdown?: HudContext["breakdown"];
}

/** A finished-or-streaming reply's usage; error/aborted replies don't describe the context. */
function replyUsage(message: MessageUpdateEvent["message"]) {
  if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") return undefined;
  return message.usage;
}

function readContext(ctx: ExtensionContext, breakdown: HudContext["breakdown"]): HudContext | null {
  const usage = ctx.getContextUsage();
  if (!usage) return null;
  const { tokens, contextWindow: window, percent } = usage;
  return tokens === null || !breakdown ? { tokens, window, percent } : { tokens, window, percent, breakdown };
}

interface GitJob {
  trigger(): void;
  stop(): void;
}

const GIT_THROTTLE_MS = 2000;
const GIT_BACKSTOP_MS = 30_000;

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

  /** Async git refresh: at most one run in flight, triggers coalesced, runs spaced by the throttle, plus a backstop. */
  const startGitJob = (gen: number, cwd: string, footerData: ReadonlyFooterDataProvider, options: HudConfig["gitStatus"]): GitJob => {
    let inFlight = false;
    let pending = false;
    let lastRun = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      timer = undefined;
      if (!isLive(gen)) return;
      inFlight = true;
      lastRun = Date.now();
      try {
        const branch = footerData.getGitBranch();
        const git = branch ? { branch, ...(await getGitStatus(pi.exec.bind(pi), cwd, options)) } : null;
        if (git || session?.snapshot.git) update(gen, { git });
      } catch {
        // Keep the last snapshot; the next trigger retries.
      } finally {
        inFlight = false;
        if (pending) {
          pending = false;
          trigger();
        }
      }
    };

    const trigger = () => {
      if (!isLive(gen) || timer) return;
      if (inFlight) {
        pending = true;
        return;
      }
      const wait = lastRun + GIT_THROTTLE_MS - Date.now();
      if (wait <= 0) void run();
      else timer = setTimeout(run, wait);
    };

    const backstop = setInterval(trigger, GIT_BACKSTOP_MS);
    backstop.unref?.();
    const unsubscribe = footerData.onBranchChange(trigger);
    trigger();
    return {
      trigger,
      stop() {
        clearTimeout(timer);
        clearInterval(backstop);
        unsubscribe();
      },
    };
  };

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    const current: Session = (session = {
      generation: ++generation,
      snapshot: { model: ctx.model ? { name: ctx.model.name } : null, cwd: ctx.cwd, context: readContext(ctx, undefined), tools: [] },
      displaced: false,
    });
    const config = loadConfig(ctx.cwd, getAgentDir());
    setFooter(ctx.ui, (tui, _theme, footerData) => {
      current.requestRender = () => tui.requestRender();
      if (config.gitStatus.enabled) current.git = startGitJob(current.generation, ctx.cwd, footerData, config.gitStatus);
      return {
        render: (width) => renderHud(current.snapshot, config, width),
        invalidate() {},
        dispose() {
          if (ownCall || current.displaced) return;
          current.displaced = true;
          current.git?.stop();
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

  pi.on("agent_end", () => session?.git?.trigger());
  pi.on("tool_execution_end", () => session?.git?.trigger());

  // Context: getContextUsage() is the base; a streaming reply's usage overrides it until a clearing event.
  const syncContext = (ctx: ExtensionContext, change: (s: Session) => void = () => {}) => {
    if (!isLive(generation)) return;
    change(session!);
    const context = session!.liveContext ?? readContext(ctx, session!.breakdown);
    // Skip no-op renders: message_update fires per streamed delta, mostly without new usage.
    if (JSON.stringify(context) !== JSON.stringify(session!.snapshot.context)) update(generation, { context });
  };
  const clearLive = (s: Session) => (s.liveContext = undefined);
  const resetContext = (s: Session) => {
    s.liveContext = undefined;
    s.breakdown = undefined;
  };

  pi.on("message_update", (event, ctx) => {
    const usage = replyUsage(event.message);
    const tokens = usage && (usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite);
    const window = ctx.model?.contextWindow;
    if (!usage || !tokens || !window) return;
    const breakdown = { input: usage.input, cache: usage.cacheRead + usage.cacheWrite };
    syncContext(ctx, (s) => (s.liveContext = { tokens, window, percent: (tokens / window) * 100, breakdown }));
  });
  pi.on("message_end", (event, ctx) => {
    const usage = replyUsage(event.message);
    syncContext(ctx, (s) => {
      if (usage?.totalTokens) s.breakdown = { input: usage.input, cache: usage.cacheRead + usage.cacheWrite };
    });
  });
  pi.on("agent_start", (_event, ctx) => syncContext(ctx, clearLive));
  pi.on("agent_end", (_event, ctx) => syncContext(ctx, clearLive));
  pi.on("tool_execution_start", (_event, ctx) => syncContext(ctx, clearLive));
  pi.on("model_select", (_event, ctx) => syncContext(ctx, clearLive));
  pi.on("session_compact", (_event, ctx) => syncContext(ctx, resetContext));
  pi.on("session_tree", (_event, ctx) => syncContext(ctx, resetContext));

  pi.on("session_shutdown", (_event, ctx) => {
    if (!session) return;
    const { displaced, displacedNotice } = session;
    clearTimeout(displacedNotice);
    session.git?.stop();
    session = undefined;
    generation++;
    // Only while we still own the footer: otherwise this would wipe the other extension's footer.
    if (!displaced) setFooter(ctx.ui, undefined);
  });
}
