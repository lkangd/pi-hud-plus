// Ported from claude-hud src/extra-cmd.ts. Changes for pi: the command comes from config (no --extra-cmd
// argv parsing) and runs through pi.exec as `sh -c`, since pi.exec doesn't use a shell.
import { createDebug } from "./debug.ts";
import type { Exec } from "./git.ts";
import { sanitize as stripControls } from "./sanitize.ts";

const MAX_BUFFER = 10 * 1024; // 10KB - plenty for a label
const MAX_LABEL_LENGTH = 50;
const TIMEOUT_MS = 3000;

// Messages never include the command or its output: either may hold secrets.
const debug = createDebug("extra-cmd");

/**
 * Sanitize output to prevent terminal escape injection.
 * Strips whole ANSI/OSC escape sequences (so their parameters don't show), then control and bidi characters.
 */
export function sanitize(input: string): string {
  return stripControls(
    input
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "") // CSI sequences
      .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, "") // OSC sequences
      .replace(/\x1B[@-Z\\-_]/g, ""), // 7-bit C1 / ESC Fe
  );
}

/**
 * Run the Extra command and parse its JSON output, expecting { label: string }.
 * Returns null on any error (timeout, non-zero exit, parse failure, missing label).
 *
 * SECURITY NOTE: cmd comes only from the user's global config; project config files aren't read
 * (see loadConfig), so opening a repo can't run commands.
 */
export async function runExtraCmd(exec: Exec, cmd: string, timeout: number = TIMEOUT_MS): Promise<string | null> {
  try {
    const { stdout, code, killed } = await exec("sh", ["-c", cmd], { timeout, maxBuffer: MAX_BUFFER });
    if (killed) {
      debug(`Command timed out after ${timeout}ms`);
      return null;
    }
    if (code !== 0) {
      debug(`Command failed with exit code ${code}`);
      return null;
    }
    let data: unknown;
    try {
      data = JSON.parse(stdout.trim());
    } catch {
      debug("Failed to parse JSON output");
      return null;
    }
    if (typeof data === "object" && data !== null && "label" in data && typeof data.label === "string") {
      let label = sanitize(data.label);
      if (label.length > MAX_LABEL_LENGTH) {
        label = label.slice(0, MAX_LABEL_LENGTH - 1) + "…";
      }
      return label;
    }
    debug(`Command output missing 'label' field or invalid type`);
    return null;
  } catch {
    debug("Command failed to run");
    return null;
  }
}
