import {
  getAgentDir,
  loadProjectContextFiles,
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionUIContext,
  type MessageUpdateEvent,
  type ReadonlyFooterDataProvider,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { hasTickingElement, startClock } from "./clock.ts";
import { loadConfig, type HudConfig } from "./config.ts";
import { runExtraCmd } from "./extra-cmd.ts";
import { getGitStatus } from "./git.ts";
import { getMemoryUsage } from "./memory.ts";
import { renderHud } from "./render/index.ts";
import { createSessionReader } from "./session.ts";
import { createSpeedTracker } from "./speed-tracker.ts";
import type { HudContext, HudEnvironment, HudSnapshot, HudTool } from "./types.ts";

interface Session {
  generation: number;
  snapshot: HudSnapshot;
  requestRender?: () => void;
  /** Another extension took the footer: the HUD is dormant until the next session_start. */
  displaced: boolean;
  displacedNotice?: ReturnType<typeof setTimeout>;
  stopClock?: () => void;
  trackSpeed: ReturnType<typeof createSpeedTracker>;
  git?: GitJob;
  extra?: GitJob;
  footerData?: ReadonlyFooterDataProvider;
  /** Context from the streaming reply's usage; wins over getContextUsage() until a clearing event. */
  liveContext?: HudContext;
  /** The latest reply's prompt split, for the token breakdown. */
  breakdown?: HudContext["breakdown"];
  /** Running and recent tools by toolCallId, oldest first. */
  tools: Map<string, HudTool>;
}

/** claude-hud keeps the transcript's last 20 tools. */
const MAX_TOOLS = 20;

/** The argument shown after a running tool's name, for pi's built-in tools. */
function toolTarget(name: string, args: Record<string, unknown> | undefined): string | undefined {
  const value = name === "bash" ? args?.command : (args?.path ?? args?.file_path ?? args?.pattern);
  if (typeof value !== "string" || !value) return undefined;
  return name === "bash" && value.length > 30 ? `${value.slice(0, 30)}...` : value;
}

/** A finished-or-streaming reply's usage; error/aborted replies don't describe the context. */
function replyUsage(message: MessageUpdateEvent["message"]) {
  if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") return undefined;
  return message.usage;
}

function breakdownOf(usage: { input: number; cacheRead: number; cacheWrite: number }): HudContext["breakdown"] {
  return { input: usage.input, cache: usage.cacheRead + usage.cacheWrite };
}

/** A resumed session's breakdown: its latest usable reply, unless a compaction came after it. */
function lastBreakdown(entries: SessionEntry[]): HudContext["breakdown"] {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type === "compaction") return undefined;
    const usage = entry.type === "message" ? replyUsage(entry.message) : undefined;
    if (usage?.totalTokens) return breakdownOf(usage);
  }
  return undefined;
}

function readContext(ctx: ExtensionContext, breakdown: HudContext["breakdown"]): HudContext | null {
  const usage = ctx.getContextUsage();
  if (!usage) return null;
  const { tokens, contextWindow: window, percent } = usage;
  return tokens === null || !breakdown ? { tokens, window, percent } : { tokens, window, percent, breakdown };
}

/** The snapshot's model: provider/ prefixes it when more than one provider is available, like pi's footer. */
function modelInfo(model: { name: string; provider: string } | undefined, footerData?: ReadonlyFooterDataProvider): HudSnapshot["model"] {
  if (!model) return null;
  return footerData && footerData.getAvailableProviderCount() > 1 ? { name: model.name, provider: model.provider } : { name: model.name };
}

/** A background job (git, Extra command). */
interface GitJob {
  trigger(): void;
  stop(): void;
}

const GIT_THROTTLE_MS = 2000;
const GIT_BACKSTOP_MS = 30_000;
const EXTRA_BACKSTOP_MS = 30_000;

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

  /** Prompts come from pi's commands, MCPs are the distinct `mcp__<server>__*` tool namespaces. Skills default to skill commands. */
  const readEnvironment = (contextFiles: number, skills?: number): HudEnvironment => {
    const commands = pi.getCommands();
    const count = (source: string) => commands.filter((command) => command.source === source).length;
    const servers = new Set(pi.getAllTools().map((tool) => /^mcp__(.+?)__/.exec(tool.name)?.[1]).filter(Boolean));
    return { contextFiles, skills: skills ?? count("skill"), prompts: count("prompt"), mcps: servers.size };
  };

  const readSession = createSessionReader();
  const refreshSession = (_event: unknown, ctx: ExtensionContext) => {
    if (isLive(generation)) update(generation, { session: readSession(pi, ctx), now: Date.now() });
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

  /** The Extra command: at most one run at a time, at start, on trigger and on a backstop. Never from render. */
  const startExtraJob = (gen: number, cmd: string): GitJob => {
    let inFlight = false;
    const run = async () => {
      if (!isLive(gen) || inFlight) return;
      inFlight = true;
      try {
        const extraLabel = await runExtraCmd(pi.exec.bind(pi), cmd);
        if (extraLabel !== session?.snapshot.extraLabel) update(gen, { extraLabel });
      } finally {
        inFlight = false;
      }
    };
    const backstop = setInterval(run, EXTRA_BACKSTOP_MS);
    backstop.unref?.();
    void run();
    return { trigger: () => void run(), stop: () => clearInterval(backstop) };
  };

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    const config = loadConfig(ctx.cwd, getAgentDir());
    const breakdown = lastBreakdown(ctx.sessionManager.getEntries());
    const current: Session = (session = {
      generation: ++generation,
      snapshot: {
        model: modelInfo(ctx.model),
        thinkingLevel: pi.getThinkingLevel(),
        version: VERSION,
        cwd: ctx.cwd,
        context: readContext(ctx, breakdown),
        tools: [],
        now: Date.now(),
        session: readSession(pi, ctx),
        // Seeded here; loadProjectContextFiles ignores --no-context-files, so before_agent_start corrects it.
        environment: config.display.showConfigCounts
          ? readEnvironment(loadProjectContextFiles({ cwd: ctx.cwd, agentDir: getAgentDir() }).length)
          : undefined,
      },
      displaced: false,
      trackSpeed: createSpeedTracker(),
      tools: new Map(),
      breakdown,
    });
    if (hasTickingElement(config)) {
      current.stopClock = startClock((now) => {
        update(current.generation, { now });
        // Memory is sampled here, never in render; the first reading lands on the first tick.
        if (config.display.showMemoryUsage) void getMemoryUsage().then((memory) => update(current.generation, { memory }));
      });
    }
    setFooter(ctx.ui, (tui, _theme, footerData) => {
      current.requestRender = () => tui.requestRender();
      current.footerData = footerData;
      current.snapshot = { ...current.snapshot, model: modelInfo(ctx.model, footerData) };
      if (config.gitStatus.enabled) current.git = startGitJob(current.generation, ctx.cwd, footerData, config.gitStatus);
      return {
        // Statuses are read live: pi requests a render whenever an extension sets one.
        render: (width) => renderHud({ ...current.snapshot, extensionStatuses: footerData.getExtensionStatuses() }, config, width),
        invalidate() {},
        dispose() {
          if (ownCall || current.displaced) return;
          current.displaced = true;
          current.stopClock?.();
          current.git?.stop();
          current.extra?.stop();
          current.displacedNotice = setTimeout(() => {
            if (globals[NOTICE_SHOWN]) return;
            globals[NOTICE_SHOWN] = true;
            ctx.ui.notify(DISPLACED_NOTICE, "warning");
          }, NOTICE_DELAY_MS);
        },
      };
    });
    if (config.extraCommand) current.extra = startExtraJob(current.generation, config.extraCommand);
  });

  pi.on("model_select", (event, ctx) => {
    if (!isLive(generation)) return;
    // ctx.model may still be the previous model here; the event's is the new one. Changing model can clamp the thinking level, so re-read it.
    update(generation, {
      model: modelInfo(event.model, session!.footerData),
      thinkingLevel: pi.getThinkingLevel(),
      session: readSession(pi, ctx, event.model),
    });
  });
  // The run's system prompt options are what the agent actually loaded.
  pi.on("before_agent_start", (event) => {
    if (!isLive(generation) || !session!.snapshot.environment) return;
    const { contextFiles = [], skills = [] } = event.systemPromptOptions;
    update(generation, { environment: readEnvironment(contextFiles.length, skills.length) });
  });
  pi.on("thinking_level_select", (event) => update(generation, { thinkingLevel: event.level }));

  // Events after which the session's entries or name may have changed.
  pi.on("message_end", refreshSession);
  pi.on("turn_end", refreshSession);
  pi.on("agent_end", refreshSession);
  pi.on("session_compact", refreshSession);
  pi.on("session_tree", refreshSession);
  pi.on("session_info_changed", refreshSession);

  pi.on("message_update", (event) => {
    const usage = replyUsage(event.message);
    if (!session || !usage) return;
    const speed = session.trackSpeed(usage.output, Date.now());
    // Most updates come too close together for a reading; keep showing the last one.
    if (speed !== null) update(generation, { speed });
  });
  // The reply stopped streaming: no fresh reading, so claude-hud would hide the speed.
  const clearSpeed = () => {
    if (session?.snapshot.speed !== undefined) update(generation, { speed: undefined });
  };
  pi.on("message_end", clearSpeed);
  pi.on("agent_end", clearSpeed);

  pi.on("tool_execution_start", (event) => {
    if (!isLive(generation)) return;
    const { tools } = session!;
    tools.set(event.toolCallId, { name: event.toolName, target: toolTarget(event.toolName, event.args), status: "running" });
    if (tools.size > MAX_TOOLS) tools.delete(tools.keys().next().value!);
    update(generation, { tools: [...tools.values()] });
  });
  pi.on("tool_execution_end", (event) => {
    const tool = isLive(generation) ? session!.tools.get(event.toolCallId) : undefined;
    if (!tool) return;
    session!.tools.set(event.toolCallId, { ...tool, status: event.isError ? "error" : "completed" });
    update(generation, { tools: [...session!.tools.values()] });
  });

  pi.on("agent_end", () => session?.git?.trigger());
  pi.on("agent_end", () => session?.extra?.trigger());
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
    syncContext(ctx, (s) => (s.liveContext = { tokens, window, percent: (tokens / window) * 100, breakdown: breakdownOf(usage) }));
  });
  pi.on("message_end", (event, ctx) => {
    const usage = replyUsage(event.message);
    syncContext(ctx, (s) => {
      if (usage?.totalTokens) s.breakdown = breakdownOf(usage);
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
    const { displaced, displacedNotice, stopClock } = session;
    clearTimeout(displacedNotice);
    stopClock?.();
    session.git?.stop();
    session.extra?.stop();
    session = undefined;
    generation++;
    // Only while we still own the footer: otherwise this would wipe the other extension's footer.
    if (!displaced) setFooter(ctx.ui, undefined);
  });
}
