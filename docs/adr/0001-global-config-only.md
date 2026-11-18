# Global config only, no project config

pi-hud-plus reads only `~/.pi/agent/pi-hud-plus.json`; the per-project `<cwd>/.pi/pi-hud-plus.json` that the original spec deep-merged over it is dropped. The HUD describes the pi harness a user works in, not any one repo, so users don't configure it per project, and a second file only adds a merge rule to learn and makes `/pi-hud:configure` ambiguous about where to write. Dropping it also removes the need to strip `extraCommand` from files a cloned repo could ship.
