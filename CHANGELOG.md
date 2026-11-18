# Changelog

## [Unreleased]

### New Features

- **Usage limits**: the `usage` Element is back, with claude-hud's config fields. It shows 5h, Weekly and Monthly Limit windows for Codex (ChatGPT) and GLM Coding Plan models, and a Balance for DeepSeek models. The HUD fetches these from each vendor with pi's credentials. Other vendors can feed it through claude-hud's External usage snapshot file (`display.externalUsagePath`). The Element is on by default and sits beside the context bar. To stop the requests, set `display.showUsage` to `false` or turn off the new "Usage limits" row in `/pi-hud:configure`.

## [0.2.0] - 2026-11-17

### New Features

- **`/pi-hud:setup` and `/pi-hud:configure`**: guided config in a settings list (layout, language, git style, Elements, Custom line, Presets). Changes are confirmed, written to `~/.pi/agent/pi-hud-plus.json` and reloaded.

### Breaking Changes

- **Global config only**: `.pi/pi-hud-plus.json` in a project is no longer read. Move its fields into `~/.pi/agent/pi-hud-plus.json`.

## [0.1.0] - 2026-11-14

### New Features

- **claude-hud for pi**: replaces pi's footer with a claude-hud-style HUD. It shows the model badge with an optional thinking level, project path and git status, the context bar, prompt cache countdown, approximate RAM, the Environment line (AGENTS.md, skills, prompts, MCPs), the tools line, session times, session tokens, cost, speed and `pi vX`.
- **claude-hud config**: `~/.pi/agent/pi-hud-plus.json`, with a per-project override at `.pi/pi-hud-plus.json`. Field names match claude-hud's, so a pasted claude-hud config loads and unknown fields are ignored.
- **Extension statuses**: other extensions' footer statuses get their own dimmed Line.
- **Extra command**: `extraCommand` runs a shell command and shows its `{ "label": "..." }` output on the first Line.
- **Simplified Chinese**: `"language": "zh-Hans"`.
