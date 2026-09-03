# CLAUDE.md — compas_soundscape

Global rules are in `AGENTS.md`. This file tells Claude Code which scoped rule files to load.

@AGENTS.md

## Always-active rules
@.cursor/rules/global.mdc
@.cursor/rules/run-app-when-debugging.mdc

## Load when touching matching files (on demand)
@.cursor/rules/acoustic-sim.mdc
@.cursor/rules/zustand-stores.mdc
@.cursor/rules/task-queue.mdc
@.cursor/rules/ui-conventions.mdc
@.cursor/rules/speckle.mdc
@.cursor/rules/sound-rendering.mdc
@.cursor/rules/daw-timeline.mdc
@.cursor/rules/frontend-ux.mdc
@.cursor/rules/chrome-devtools.mdc
