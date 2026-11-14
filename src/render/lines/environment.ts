import type { RenderContext } from "../../types.ts";
import { label } from "../colors.ts";
import { t } from "../../i18n/index.ts";

/** Ported from claude-hud's render/lines/environment (CLAUDE.md/rules/MCPs/hooks become AGENTS.md/skills/prompts/MCPs). */
export function renderEnvironmentLine({ snapshot, config }: RenderContext): string | null {
  const { environment } = snapshot;
  const { showConfigCounts, environmentThreshold } = config.display;
  if (!showConfigCounts || !environment) return null;
  const { contextFiles, skills, prompts, mcps } = environment;
  const total = contextFiles + skills + prompts + mcps;
  if (total === 0 || total < environmentThreshold) return null;

  const parts = [
    contextFiles > 0 ? `${contextFiles} AGENTS.md` : null,
    skills > 0 ? `${skills} ${t("label.skills")}` : null,
    prompts > 0 ? `${prompts} ${t("label.prompts")}` : null,
    mcps > 0 ? `${mcps} MCPs` : null,
  ].filter((part) => part !== null);
  return label(parts.join(" | "), config.colors);
}
