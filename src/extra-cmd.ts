// Ported from claude-hud src/extra-cmd.ts. Changes for pi: the command comes from config (no --extra-cmd
// argv parsing) and runs through pi.exec as `sh -c`, since pi.exec doesn't use a shell. No debug logging.
import type { Exec } from "./git.ts";

const MAX_BUFFER = 10 * 1024; // 10KB - plenty for a label
const MAX_LABEL_LENGTH = 50;
const TIMEOUT_MS = 3000;

/**
 * Sanitize output to prevent terminal escape injection.
 * Strips ANSI escapes, OSC sequences, control characters, and bidi controls.
 */
export function sanitize(input: string): string {
  return input
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "") // CSI sequences
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, "") // OSC sequences
    .replace(/\x1B[@-Z\\-_]/g, "") // 7-bit C1 / ESC Fe
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // C0/C1 controls
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u206A-\u206F]/g, ""); // bidi
}

/**
 * Run the Extra command and parse its JSON output, expecting { label: string }.
 * Returns null on any error (timeout, non-zero exit, parse failure, missing label).
 *
 * SECURITY NOTE: cmd comes only from the user's global config; a project file's extraCommand is
 * stripped before merging, so opening a repo can't run commands.
 */
export async function runExtraCmd(exec: Exec, cmd: string, timeout: number = TIMEOUT_MS): Promise<string | null> {
  try {
    const { stdout, code, killed } = await exec("sh", ["-c", cmd], { timeout, maxBuffer: MAX_BUFFER });
    if (code !== 0 || killed) return null;
    const data: unknown = JSON.parse(stdout.trim());
    if (typeof data === "object" && data !== null && "label" in data && typeof data.label === "string") {
      let label = sanitize(data.label);
      if (label.length > MAX_LABEL_LENGTH) {
        label = label.slice(0, MAX_LABEL_LENGTH - 1) + "…";
      }
      return label;
    }
    return null;
  } catch {
    return null;
  }
}
