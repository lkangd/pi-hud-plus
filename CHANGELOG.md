# Changelog

## [Unreleased]

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
