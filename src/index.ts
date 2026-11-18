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
  type ToolExecutionEndEvent,
  type ToolExecutionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { hasTickingElement, startClock } from "./clock.ts";
import { registerCommands } from "./commands.ts";
import { loadConfig, type HudConfig } from "./config.ts";
import { getUsageFromExternalSnapshot } from "./external-usage.ts";
import { runExtraCmd } from "./extra-cmd.ts";
import { getGitStatus, type GitStatusOptions } from "./git.ts";
import { getMemoryUsage } from "./memory.ts";
import { renderHud } from "./render/index.ts";
import { createSessionReader } from "./session.ts";
import { createSpeedTracker, SPEED_WINDOW_MS } from "./speed-tracker.ts";
import type { HudContext, HudEnvironment, HudSnapshot, HudTool, UsageLimit } from "./types.ts";
import { codex, detectVendor, parseCodexRateLimits, type UsageModel } from "./usage-vendors.ts";

interface Session {
  generation: number;
  snapshot: HudSnapshot;
  requestRender?: () => void;
  /** Another extension took the footer: the HUD is Displaced until the next session_start. */
  displaced: boolean;
  displacedNotice?: ReturnType<typeof setTimeout>;
  stopClock?: () => void;
  trackSpeed: ReturnType<typeof createSpeedTracker>;
  /** Hides the speed once its reading is stale. */
  speedExpiry?: ReturnType<typeof setTimeout>;
  git?: BackgroundJob;
  extra?: BackgroundJob;
  /** Absent when showUsage is off. */
  usage?: UsageJob;
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

type Usage = NonNullable<ReturnType<typeof replyUsage>>;

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
interface BackgroundJob {
  trigger(): void;
  stop(): void;
}

const GIT_THROTTLE_MS = 2000;
const GIT_BACKSTOP_MS = 30_000;
const EXTRA_BACKSTOP_MS = 30_000;
/** A fetch is skipped while the current vendor's data is younger than this. */
const USAGE_SKIP_MS = 60_000;
const USAGE_BACKSTOP_MS = 5 * 60_000;

/** The usage job: the current vendor's Usage limit, else the External usage snapshot. */
interface UsageJob extends BackgroundJob {
  /** The model changed; another vendor clears the shown data until its own arrives. */
  selectModel(model: UsageModel): void;
  /** A provider stream frame; Codex's codex.rate_limits carries its Usage limit. */
  frame(data: unknown): void;
  /** Re-shows the data, re-reading the External usage snapshot (for freshness) while there's no native data. */
  show(): void;
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
  registerCommands(pi);
  // Bumped on every session start/shutdown. Async work captures it and checks isLive(gen) before touching anything.
  let generation = 0;
  let session: Session | undefined;
  // Set around our own setFooter calls so the dispose() they trigger isn't mistaken for displacement.
  let ownCall = false;
  const exec = pi.exec.bind(pi);

  const setFooter = (ui: ExtensionUIContext, factory: Parameters<ExtensionUIContext["setFooter"]>[0]) => {
    ownCall = true;
    try {
      ui.setFooter(factory);
    } finally {
      ownCall = false;
    }
  };

  /** The shared liveness check: false once the session `gen` has ended or the HUD is Displaced. Every handler and job consults it. */
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

  /** Async git refresh: at most one run in flight, triggers coalesced, runs spaced by the throttle, plus a backstop. */
  const startGitJob = (gen: number, cwd: string, footerData: ReadonlyFooterDataProvider, options: GitStatusOptions): BackgroundJob => {
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
        const git = branch ? { branch, ...(await getGitStatus(exec, cwd, options)) } : null;
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
  const startExtraJob = (gen: number, cmd: string): BackgroundJob => {
    let inFlight = false;
    const run = async () => {
      if (!isLive(gen) || inFlight) return;
      inFlight = true;
      try {
        const extraLabel = await runExtraCmd(exec, cmd);
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

  /** Usage refresh: on trigger and a backstop, at most one fetch in flight, skipped while the data is fresh. Never from render. */
  const startUsageJob = (
    gen: number,
    config: HudConfig,
    model: UsageModel | undefined,
    registry: ExtensionContext["modelRegistry"],
    onShown: () => void,
  ): UsageJob => {
    let vendor = detectVendor(model);
    let native: UsageLimit | null = null;
    let nativeAt = -Infinity;
    // Bumped on a vendor switch: the old vendor's in-flight fetch is then ignored and doesn't block the new one.
    let epoch = 0;
    let inFlight: number | undefined;

    const show = () => {
      if (!isLive(gen)) return;
      const usageLimit = native ?? getUsageFromExternalSnapshot(config);
      if (JSON.stringify(usageLimit) !== JSON.stringify(session!.snapshot.usageLimit ?? null)) update(gen, { usageLimit });
      onShown();
    };
    const setNative = (usage: UsageLimit | null) => {
      native = usage;
      // A failure isn't fresh data: the next trigger retries.
      nativeAt = usage ? Date.now() : -Infinity;
      show();
    };

    const run = async () => {
      show();
      if (!isLive(gen) || !vendor || !model || inFlight === epoch || Date.now() - nativeAt < USAGE_SKIP_MS) return;
      const mine = (inFlight = epoch);
      const [current, forModel] = [vendor, model];
      const usage = await registry
        .getApiKeyAndHeaders(forModel)
        .then((auth) => (auth.ok && auth.apiKey ? current.fetch(forModel, auth.apiKey) : null))
        .catch(() => null);
      if (inFlight === mine) inFlight = undefined;
      if (mine === epoch && isLive(gen)) setNative(usage);
    };

    const backstop = setInterval(() => void run(), USAGE_BACKSTOP_MS);
    backstop.unref?.();
    void run();
    return {
      trigger: () => void run(),
      stop: () => clearInterval(backstop),
      show,
      selectModel(next) {
        model = next;
        const nextVendor = detectVendor(next);
        if (nextVendor !== vendor) {
          vendor = nextVendor;
          epoch++;
          native = null;
          nativeAt = -Infinity;
        }
        void run();
      },
      frame(data) {
        const usage = vendor === codex ? parseCodexRateLimits(data) : null;
        if (usage && isLive(gen)) setNative(usage);
      },
    };
  };

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    const config = loadConfig(getAgentDir());
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
    const tick = (now: number) => {
      update(current.generation, { now });
      current.usage?.show();
      // Memory is sampled here, never in render; the first reading lands on the first tick.
      if (config.display.showMemoryUsage) void getMemoryUsage().then((memory) => update(current.generation, { memory }));
    };
    // A shown Usage limit's reset countdown ticks too; with none (and no other ticking Element) there's no clock.
    const syncClock = () => {
      const wanted = hasTickingElement(config) || !!current.snapshot.usageLimit;
      if (!isLive(current.generation) || wanted === !!current.stopClock) return;
      if (wanted) current.stopClock = startClock(tick);
      else {
        current.stopClock!();
        current.stopClock = undefined;
      }
    };
    if (config.display.showUsage) current.usage = startUsageJob(current.generation, config, ctx.model, ctx.modelRegistry, syncClock);
    syncClock();
    setFooter(ctx.ui, (tui, _theme, footerData) => {
      current.requestRender = () => tui.requestRender();
      current.footerData = footerData;
      current.snapshot = { ...current.snapshot, model: modelInfo(ctx.model, footerData) };
      if (config.gitStatus.enabled) current.git = startGitJob(current.generation, ctx.cwd, footerData, { ...config.gitStatus, linkBranch: config.lineLayout === "expanded" });
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
          current.usage?.stop();
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

  // ---- Feature steps: each takes the live session; the handlers below check liveness once. ----

  // Session data: after these events the session's entries or name may have changed.
  const refreshSession = (ctx: ExtensionContext) => update(generation, { session: readSession(pi, ctx), now: Date.now() });

  // Speed: sampled from the streaming reply. Most updates come too close together for a reading; keep showing the last one
  // until it's stale, as claude-hud hides the speed once a reply stalls past the window.
  const sampleSpeed = (s: Session, usage: Usage) => {
    const speed = s.trackSpeed(usage.output, Date.now());
    if (speed === null) return;
    update(generation, { speed });
    clearTimeout(s.speedExpiry);
    s.speedExpiry = setTimeout(() => live() === s && clearSpeed(s), SPEED_WINDOW_MS);
    s.speedExpiry.unref?.();
  };
  // The reply stopped streaming: no fresh reading, so claude-hud would hide the speed.
  const clearSpeed = (s: Session) => {
    clearTimeout(s.speedExpiry);
    if (s.snapshot.speed !== undefined) update(generation, { speed: undefined });
  };

  // Tools: running and recent, by toolCallId.
  const startTool = (s: Session, event: ToolExecutionStartEvent) => {
    s.tools.set(event.toolCallId, { name: event.toolName, target: toolTarget(event.toolName, event.args), status: "running" });
    if (s.tools.size > MAX_TOOLS) s.tools.delete(s.tools.keys().next().value!);
    update(generation, { tools: [...s.tools.values()] });
  };
  const endTool = (s: Session, event: ToolExecutionEndEvent) => {
    const tool = s.tools.get(event.toolCallId);
    if (!tool) return;
    s.tools.set(event.toolCallId, { ...tool, status: event.isError ? "error" : "completed" });
    update(generation, { tools: [...s.tools.values()] });
  };

  // Context: getContextUsage() is the base; a streaming reply's usage overrides it until a clearing event.
  const syncContext = (s: Session, ctx: ExtensionContext) => {
    const context = s.liveContext ?? readContext(ctx, s.breakdown);
    // Skip no-op renders: message_update fires per streamed delta, mostly without new usage.
    if (JSON.stringify(context) !== JSON.stringify(s.snapshot.context)) update(generation, { context });
  };
  const streamContext = (s: Session, ctx: ExtensionContext, usage: Usage) => {
    const tokens = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    const window = ctx.model?.contextWindow;
    if (!tokens || !window) return;
    s.liveContext = { tokens, window, percent: (tokens / window) * 100, breakdown: breakdownOf(usage) };
    syncContext(s, ctx);
  };
  const endReplyContext = (s: Session, ctx: ExtensionContext, usage: Usage | undefined) => {
    if (usage?.totalTokens) s.breakdown = breakdownOf(usage);
    syncContext(s, ctx);
  };
  const clearLiveContext = (s: Session, ctx: ExtensionContext) => {
    s.liveContext = undefined;
    syncContext(s, ctx);
  };
  const resetContext = (s: Session, ctx: ExtensionContext) => {
    s.breakdown = undefined;
    clearLiveContext(s, ctx);
  };

  // ---- Event handlers: one per event, calling each feature's step in turn. ----

  const live = () => (isLive(generation) ? session : undefined);

  pi.on("model_select", (event, ctx) => {
    const s = live();
    if (!s) return;
    // ctx.model may still be the previous model here; the event's is the new one. Changing model can clamp the thinking level, so re-read it.
    update(generation, {
      model: modelInfo(event.model, s.footerData),
      thinkingLevel: pi.getThinkingLevel(),
      session: readSession(pi, ctx, event.model),
    });
    clearLiveContext(s, ctx);
    s.usage?.selectModel(event.model);
  });
  pi.on("provider_stream_event", (event) => live()?.usage?.frame(event.data));
  // The run's system prompt options are what the agent actually loaded.
  pi.on("before_agent_start", (event) => {
    if (!live()?.snapshot.environment) return;
    const { contextFiles = [], skills = [] } = event.systemPromptOptions;
    update(generation, { environment: readEnvironment(contextFiles.length, skills.length) });
  });
  pi.on("thinking_level_select", (event) => update(generation, { thinkingLevel: event.level }));

  pi.on("agent_start", (_event, ctx) => {
    const s = live();
    if (s) clearLiveContext(s, ctx);
  });
  pi.on("message_update", (event, ctx) => {
    const s = live();
    const usage = replyUsage(event.message);
    if (!s || !usage) return;
    sampleSpeed(s, usage);
    streamContext(s, ctx, usage);
  });
  pi.on("message_end", (event, ctx) => {
    const s = live();
    if (!s) return;
    refreshSession(ctx);
    clearSpeed(s);
    endReplyContext(s, ctx, replyUsage(event.message));
  });
  pi.on("tool_execution_start", (event, ctx) => {
    const s = live();
    if (!s) return;
    startTool(s, event);
    clearLiveContext(s, ctx);
  });
  pi.on("tool_execution_end", (event) => {
    const s = live();
    if (!s) return;
    endTool(s, event);
    s.git?.trigger();
  });
  pi.on("turn_end", (_event, ctx) => {
    if (live()) refreshSession(ctx);
  });
  pi.on("agent_end", (_event, ctx) => {
    const s = live();
    if (!s) return;
    refreshSession(ctx);
    clearSpeed(s);
    s.git?.trigger();
    s.extra?.trigger();
    s.usage?.trigger();
    clearLiveContext(s, ctx);
  });
  pi.on("session_info_changed", (_event, ctx) => {
    if (live()) refreshSession(ctx);
  });
  // Compaction and tree navigation replace the context the breakdown described.
  const onContextReplaced = (_event: unknown, ctx: ExtensionContext) => {
    const s = live();
    if (!s) return;
    refreshSession(ctx);
    resetContext(s, ctx);
  };
  pi.on("session_compact", onContextReplaced);
  pi.on("session_tree", onContextReplaced);

  pi.on("session_shutdown", (_event, ctx) => {
    if (!session) return;
    const { displaced, displacedNotice, speedExpiry, stopClock } = session;
    clearTimeout(displacedNotice);
    clearTimeout(speedExpiry);
    stopClock?.();
    session.git?.stop();
    session.extra?.stop();
    session.usage?.stop();
    session = undefined;
    generation++;
    // Only while we still own the footer: otherwise this would wipe the other extension's footer.
    if (!displaced) setFooter(ctx.ui, undefined);
  });
}
