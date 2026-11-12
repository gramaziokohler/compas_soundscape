"""Regenerate .claude/rules/*.md pointer files from .cursor/rules/*.mdc globs.

The .mdc files are the single source of truth for project rules (Cursor reads them
natively). Claude Code cannot @-import .mdc files, so each glob-scoped .mdc gets a
small pointer in .claude/rules/ whose `paths:` frontmatter mirrors the .mdc `globs:`;
Claude Code loads the pointer only when it touches matching files.

Usage (from repo root, any Python 3.8+, stdlib only):
    python scripts/sync_claude_rules.py          # rewrite pointers
    python scripts/sync_claude_rules.py --check  # exit 1 if any pointer is stale
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = REPO_ROOT / ".cursor" / "rules"
TARGET_DIR = REPO_ROOT / ".claude" / "rules"
FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---", re.DOTALL)
SAFE_GLOB_RE = re.compile(r"^[A-Za-z0-9_./*\-]+$")


def _field(frontmatter: str, key: str) -> str | None:
    match = re.search(rf"^{key}:\s*(.*)$", frontmatter, re.MULTILINE)
    return match.group(1).strip() if match else None


def render_pointer(mdc_path: Path) -> str | None:
    """Return the pointer file body for a glob-scoped .mdc, or None if it is always-on."""
    text = mdc_path.read_text(encoding="utf-8")
    match = FRONTMATTER_RE.match(text)
    frontmatter = match.group(1) if match else ""
    globs_line = _field(frontmatter, "globs")
    if not globs_line:
        return None
    globs = [g.strip().strip("\"'") for g in globs_line.split(",") if g.strip()]
    unsafe = [g for g in globs if not SAFE_GLOB_RE.match(g)]
    if unsafe:
        raise ValueError(f"{mdc_path.name}: unexpected characters in globs {unsafe}")
    description = _field(frontmatter, "description") or ""
    lines = ["---", "paths:", *(f"  - {json.dumps(g)}" for g in globs), "---", ""]
    lines.append(
        f"Before editing files in this area, Read `.cursor/rules/{mdc_path.name}` "
        f"— the project rules for: {description}"
    )
    return "\n".join(lines) + "\n"


def expected_pointers() -> dict[str, str]:
    pointers: dict[str, str] = {}
    for mdc_path in sorted(SOURCE_DIR.glob("*.mdc")):
        body = render_pointer(mdc_path)
        if body is not None:
            pointers[f"{mdc_path.stem}.md"] = body
    return pointers


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="report drift without writing")
    args = parser.parse_args()

    expected = expected_pointers()
    existing = {p.name for p in TARGET_DIR.glob("*.md")} if TARGET_DIR.exists() else set()
    stale = [
        name
        for name, body in expected.items()
        if not (TARGET_DIR / name).exists()
        or (TARGET_DIR / name).read_text(encoding="utf-8") != body
    ]
    orphans = sorted(existing - expected.keys())

    if args.check:
        for name in stale:
            print(f"stale: .claude/rules/{name}")
        for name in orphans:
            print(f"orphan (no matching .mdc): .claude/rules/{name}")
        return 1 if stale or orphans else 0

    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    for name in stale:
        (TARGET_DIR / name).write_text(expected[name], encoding="utf-8", newline="\n")
        print(f"wrote .claude/rules/{name}")
    for name in orphans:
        (TARGET_DIR / name).unlink()
        print(f"removed .claude/rules/{name}")
    if not stale and not orphans:
        print("pointers already in sync")
    return 0


if __name__ == "__main__":
    sys.exit(main())
