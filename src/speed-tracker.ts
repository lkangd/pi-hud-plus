// Ported from claude-hud's speed-tracker. pi streams to one process, so the previous sample lives in memory, not a cache file.

/** A reading older than this is stale. */
export const SPEED_WINDOW_MS = 2000;
// Updates can arrive many times per second while tokens stream. Computing a rate from
// sub-500ms windows amplifies noise and produces spurious multi-thousand tok/s readings,
// so require at least half a second of elapsed time before reporting a speed.
const MIN_DELTA_MS = 500;

/** Returns a sampler: feed it the streaming reply's output token count; it returns tok/s, or null when there's no reliable reading. */
export function createSpeedTracker(): (outputTokens: number, now: number) => number | null {
  let previous: { outputTokens: number; timestamp: number } | null = null;

  return (outputTokens, now) => {
    if (!Number.isFinite(outputTokens)) return null;
    const last = previous;
    if (!last || outputTokens < last.outputTokens) {
      previous = { outputTokens, timestamp: now };
      return null;
    }

    const deltaTokens = outputTokens - last.outputTokens;
    const deltaMs = now - last.timestamp;
    if (deltaMs > SPEED_WINDOW_MS || deltaTokens <= 0) {
      previous = { outputTokens, timestamp: now };
      return null;
    }
    if (deltaMs < MIN_DELTA_MS) return null;

    previous = { outputTokens, timestamp: now };
    return deltaTokens / (deltaMs / 1000);
  };
}
