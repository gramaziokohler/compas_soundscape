"""
Remove synthetic load-test users (loadtest-*@loadtest.local) and their workspaces
from the metadata DB. Dry run by default; stop the backend before using --apply.

Usage (on the server, from repo root):
    python scripts/loadtest/cleanup_db.py                 # show what would be removed
    python scripts/loadtest/cleanup_db.py --apply         # delete DB rows
    python scripts/loadtest/cleanup_db.py --apply --files # also delete workspace folders
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = REPO_ROOT / "backend" / "data" / "app.db"
WORKSPACE_DIRS = (
    REPO_ROOT / "backend" / "data" / "soundscapes",
    REPO_ROOT / "backend" / "temp" / "static" / "sounds" / "generated",
)
LOADTEST_EMAIL_LIKE = "loadtest-%@loadtest.local"   # backend LOADTEST_EMAIL_DOMAIN


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    p.add_argument("--files", action="store_true", help="also delete workspace folders on disk")
    args = p.parse_args()

    con = sqlite3.connect(args.db)
    users = [r[0] for r in con.execute("SELECT user_hash FROM users WHERE email LIKE ?", (LOADTEST_EMAIL_LIKE,))]
    uq = ",".join("?" * len(users))
    workspaces = [r[0] for r in con.execute(f"SELECT id FROM workspaces WHERE owner_hash IN ({uq})", users)]
    wq = ",".join("?" * len(workspaces))
    print(f"{len(users)} load-test users, {len(workspaces)} workspaces in {args.db}")

    if args.apply:
        statements = (
            (f"DELETE FROM workspace_members WHERE workspace_id IN ({wq}) OR user_hash IN ({uq})", workspaces + users),
            (f"DELETE FROM model_workspaces WHERE workspace_id IN ({wq})", workspaces),
            (f"DELETE FROM model_workspace WHERE workspace_id IN ({wq})", workspaces),
            (f"DELETE FROM sessions WHERE user_hash IN ({uq})", users),
            (f"DELETE FROM user_preferences WHERE user_hash IN ({uq})", users),
            (f"DELETE FROM workspaces WHERE id IN ({wq})", workspaces),
            (f"DELETE FROM users WHERE user_hash IN ({uq})", users),
        )
        with con:
            for sql, params in statements:
                con.execute(sql, params)
        print("Deleted DB rows.")
    con.close()

    for base in WORKSPACE_DIRS:
        for ws in workspaces:
            folder = base / ws
            if folder.is_dir():
                if args.apply and args.files:
                    shutil.rmtree(folder)
                    print(f"removed {folder}")
                else:
                    print(f"would remove {folder}" if not args.apply else f"left on disk: {folder}")

    if not args.apply:
        print("Dry run - pass --apply to delete.")


if __name__ == "__main__":
    main()
