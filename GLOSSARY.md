# Glossary

**HUD**: The multi-line status display pi-hud-plus renders inside the pi TUI, modelled on claude-hud's statusline.

**Element**: One unit of information the HUD shows (model badge, project path, git status, context bar, session time…). Named after claude-hud's `HudElement`.

**Line**: One row of the HUD, composed of one or more Elements.

**Pi equivalent**: The pi concept that stands in for a Claude Code concept in an Element (e.g. AGENTS.md for CLAUDE.md, `pi vX` for `CC vX`). An Element with no Pi equivalent is out of scope.

**Custom line**: A user-defined Line of static text, as in claude-hud's `customLine`.

**Extra command**: A user-configured shell command whose output is shown as an Element on the first Line, as in claude-hud's `--extra-cmd`. Distinct from the Custom line.

**Extension status**: A short status text another pi extension publishes for the footer. The HUD shows these on their own Line so replacing pi's footer loses nothing.

**Environment line**: The Line counting what shapes the agent's context: AGENTS.md files, skills, prompt templates, MCP servers. claude-hud's equivalent counted CLAUDE.md, rules, hooks.

**HUD snapshot**: The plain record of everything the HUD currently shows, kept up to date from pi's session and events. Rendering reads only the HUD snapshot, never pi directly, with one exception: the footer render reads the Extension statuses from pi's `footerData`, because pi has no event when they change and only requests a render.

**Displaced**: The state of the HUD after another extension has taken pi's footer. A displaced HUD shows nothing and does no work until the next session starts.

**Preset**: One of three named starting configurations (Full, Essential, Minimal), as in claude-hud's configure command. Choosing a Preset sets which Elements are on; it never touches colors, thresholds or other advanced fields.
