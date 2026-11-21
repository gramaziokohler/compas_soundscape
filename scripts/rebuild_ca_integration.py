"""Rebuild the compas_acoustics fork's ``engine-integration`` branch from upstream ``main`` and the open PR branches.

``engine-integration`` is what the app installs (``requirements.txt`` pins one of its commits). It is not edited by
hand: it is ``upstream/main`` + a merge of every PR branch not yet merged upstream + the fork-only commits (the
non-merge commits on its first-parent line, such as ``environment.yml``). Fix a PR on its own branch, then rebuild.

Steps:

1. Fetch ``upstream`` and ``origin``; stash local edits (restored at the end).
2. Teach ``git rerere`` the conflict resolutions of the current ``engine-integration`` merges, so a rebuild repeats them.
3. On ``integration/rebuild`` (from ``upstream/main``), merge each branch of ``PR_BRANCHES`` that ``upstream/main``
   does not contain yet. ``CHANGELOG.md`` conflicts keep both sides; any other conflict rerere cannot resolve stops
   the script: resolve it, ``git commit --no-edit``, and run the script again with ``--resume``.
4. Cherry-pick the fork-only commits.

Then run the CA checks (AGENTS.md) on ``integration/rebuild`` and, when green, publish it with ``--publish``
(tags the old tip ``archive/engine-integration-<sha>``, moves ``engine-integration``, force-pushes both with lease).
Finally bump the commit in ``requirements.txt``.

Usage::

    python scripts/rebuild_ca_integration.py [--clone PATH] [--resume | --publish]
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_CLONE = Path.home() / "repos" / "compas_acoustics"
TARGET = "engine-integration"
WORK = "integration/rebuild"
BASE = "upstream/main"
AUTOSTASH = "rebuild-ca-integration-autostash"
UNION_FILES = {"CHANGELOG.md"}
# Merge order: stacked branches after their base (chore/benchmark-tools sits on feat/sector-edges).
PR_BRANCHES = (
    "feat/mesh-preparation",
    "feat/sector-edges",
    "feat/analysis",
    "feat/integration-hooks",
    "feat/parallel-mono",
    "feat/mono-diffraction",
    "feat/directivity",
    "feat/hybrid-output-limit",
    "chore/benchmark-tools",
    "feat/render-progress",  # stacked on feat/integration-hooks
    "feat/ray-progress",  # stacked on feat/render-progress
    "feat/udfa-polar-lowpass",
)
GH_PUSH = ("-c", "credential.helper=", "-c", "credential.helper=!'/c/Program Files/GitHub CLI/gh.exe' auth git-credential")
CONFLICT_BLOCK = re.compile(r"^<<<<<<< [^\r\n]*\r?\n(.*?)^=======\r?\n(.*?)^>>>>>>> [^\r\n]*\r?\n", re.S | re.M)


class Git:
    def __init__(self, clone: Path):
        self.clone = clone

    def __call__(self, *args: str, check: bool = True) -> str:
        result = subprocess.run(("git", *args), cwd=self.clone, capture_output=True, text=True, encoding="utf-8")
        if check and result.returncode != 0:
            raise SystemExit(f"git {' '.join(args)} failed:\n{result.stdout}{result.stderr}")
        return result.stdout.strip()

    def ok(self, *args: str) -> bool:
        return subprocess.run(("git", *args), cwd=self.clone, capture_output=True).returncode == 0

    def conflicts(self) -> list[str]:
        return [f for f in self("diff", "--name-only", "--diff-filter=U").splitlines() if f]


def keep_both_sides(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    path.write_text(CONFLICT_BLOCK.sub(lambda m: m.group(1) + m.group(2), text), encoding="utf-8", newline="")


def stash(git: Git) -> bool:
    if not git("status", "--porcelain", "--untracked-files=no"):
        return False
    git("stash", "push", "-m", AUTOSTASH)
    print(f"stashed local edits as '{AUTOSTASH}'")
    return True


def unstash(git: Git) -> None:
    entries = git("stash", "list").splitlines()
    for i, entry in enumerate(entries):
        if entry.endswith(AUTOSTASH):
            git("stash", "pop", f"stash@{{{i}}}")
            print("restored the stashed local edits")
            return


def train_rerere(git: Git) -> None:
    """Record the resolutions of the merges on ``TARGET``'s first-parent line (what contrib's rerere-train does)."""
    head = git("rev-parse", "--abbrev-ref", "HEAD")
    merges = git("rev-list", "--first-parent", "--merges", "--reverse", f"{BASE}..{TARGET}").splitlines()
    learned = 0
    for merge in merges:
        first, *others = git("rev-list", "--parents", "-n1", merge).split()[1:]
        git("checkout", "-q", "--detach", first)
        if not git.ok("merge", "--no-commit", "--no-ff", *others):
            files = git.conflicts()
            if files:
                git("rerere")
                git("checkout", merge, "--", *files)
                git("rerere")
                learned += 1
        git("reset", "-q", "--hard")
    git("checkout", "-q", head)
    print(f"rerere: replayed {len(merges)} merges, {learned} with conflicts")


def merge_branches(git: Git) -> None:
    for branch in PR_BRANCHES:
        if git.ok("merge-base", "--is-ancestor", branch, BASE):
            print(f"skip  {branch} (merged upstream)")
            continue
        if git.ok("merge-base", "--is-ancestor", branch, "HEAD"):
            print(f"skip  {branch} (already merged here)")
            continue
        if not git.ok("merge", "--no-ff", "-m", f"Merge {branch}", branch):
            for f in git.conflicts():
                if f in UNION_FILES:
                    keep_both_sides(git.clone / f)
                    git("add", f)
            left = git.conflicts()
            if left:
                raise SystemExit(
                    f"stopped at {branch}: resolve {', '.join(left)}, `git add` them, `git commit --no-edit`, "
                    f"then rerun with --resume (local edits are in the stash '{AUTOSTASH}')"
                )
            git("commit", "--no-edit")
        print(f"merge {branch}")


def pick_fork_commits(git: Git) -> None:
    commits = git("rev-list", "--first-parent", "--no-merges", "--reverse", f"{BASE}..{TARGET}").splitlines()
    for commit in commits:
        subject = git("log", "-1", "--format=%s", commit)
        if git.ok("cherry-pick", commit):
            print(f"pick  {subject}")
        elif git("diff", "--cached", "--name-only") == "" and not git.conflicts():
            git("cherry-pick", "--skip")
            print(f"skip  {subject} (already in)")
        else:
            raise SystemExit(f"cherry-pick of {commit[:7]} '{subject}' conflicts: resolve it, `git cherry-pick --continue`")


def publish(git: Git) -> None:
    old = git("rev-parse", "--short", f"origin/{TARGET}")
    new = git("rev-parse", WORK)
    tag = f"archive/{TARGET}-{old}"
    if not git.ok("rev-parse", "-q", "--verify", f"refs/tags/{tag}"):
        git("tag", tag, f"origin/{TARGET}")
    git("branch", "-f", TARGET, new) if git("rev-parse", "--abbrev-ref", "HEAD") != TARGET else git("reset", "-q", "--hard", new)
    git(*GH_PUSH, "push", "origin", f"refs/tags/{tag}")
    git(*GH_PUSH, "push", f"--force-with-lease={TARGET}:{git('rev-parse', f'origin/{TARGET}')}", "origin", f"{TARGET}:{TARGET}")
    print(f"published {TARGET} = {new} (old tip kept as {tag}); pin requirements.txt to @{new}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--clone", type=Path, default=DEFAULT_CLONE)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--resume", action="store_true", help="continue on the work branch after a resolved conflict")
    mode.add_argument("--publish", action="store_true", help="move engine-integration to the work branch and push")
    args = parser.parse_args()
    git = Git(args.clone)

    git("fetch", "-q", "upstream")
    git("fetch", "-q", "origin")
    if args.publish:
        publish(git)
        return
    stashed = stash(git)
    git("config", "rerere.enabled", "true")
    git("config", "rerere.autoupdate", "true")
    if args.resume:
        git("checkout", "-q", WORK)
    else:
        train_rerere(git)
        git("checkout", "-q", "-B", WORK, BASE)
    merge_branches(git)
    pick_fork_commits(git)
    if stashed:
        unstash(git)
    print(f"done: {WORK} = {git('rev-parse', '--short', 'HEAD')}. Run the CA checks, then --publish.")


if __name__ == "__main__":
    sys.exit(main())
