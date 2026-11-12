# CLAUDE.md — compas_soundscape

Global rules are in `AGENTS.md`.

@AGENTS.md

## Always-active rules

Before your first edit in a task, Read `.cursor/rules/global.mdc` and
`.cursor/rules/run-app-when-debugging.mdc`. (`@`-imports of `.mdc` files do not load, so they are read
explicitly.)

## Scoped rules

Domain rules live in `.cursor/rules/*.mdc` (single source of truth). The pointer files in
`.claude/rules/*.md` carry the same globs as `paths:` frontmatter, so Claude Code loads each pointer only
when it touches matching files. Never hand-edit the pointers: after adding a `.mdc` file or changing its
`globs:`, run `python scripts/sync_claude_rules.py` (`--check` reports drift without writing).
