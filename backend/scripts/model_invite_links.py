"""Admin tool: mint a "Copy model invite link" for every user's chosen model.

Does server-side exactly what the CollaborationPanel button does for the owner:
a view-only invite to the user's own workspace, scoped to one model, giving
``<base-url>/?invite=<token>&model_id=<model_id>``. Server-shell only (writes
data/app.db directly; no HTTP endpoint). Run from backend/:

    python scripts/model_invite_links.py --dry-run          # who/which model, no invites
    python scripts/model_invite_links.py                    # one link per user (chosen model)
    python scripts/model_invite_links.py --all-models       # one link per saved model
    python scripts/model_invite_links.py --email a@x.com --model-id 3f2c...
    python scripts/model_invite_links.py --csv links.csv --expires-days 0

"Chosen model" = the soundscape the user saved most recently in a workspace they
own (soundscape.json mtime). The unsaved Home sandbox is never linked.

Invite tokens are stored hashed, so links can't be recovered later: every run
mints new invites. Revoke stale ones in Settings → Workspaces.
"""

import argparse
import csv
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

# Allow `python scripts/model_invite_links.py` from backend/ (imports config/, services/).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.constants import (  # noqa: E402
    INVITE_DEFAULT_TTL_S,
    INVITE_MAX_USES_DEFAULT,
    LOADTEST_EMAIL_DOMAIN,
    SANDBOX_MODEL_ID,
)
from scripts.transfer_scenes import SOUNDSCAPE_JSON, list_projects  # noqa: E402
from services.metadata_store import (  # noqa: E402
    ROLE_OWNER,
    ROLE_VIEWER,
    metadata_store,
    user_hash_for_email,
)
from services.paths import user_model_dir  # noqa: E402

DEFAULT_BASE_URL = os.environ.get("PUBLIC_APP_URL", "https://soundisblue.com")
SECONDS_PER_DAY = 24 * 3600
USERS_SQL = "SELECT user_hash, email, display_name FROM users ORDER BY email"
ANON_EMAIL_PREFIX = "anon+"  # middleware/session.py anonymous dev identity
MAX_SKIPPED_LISTED = 20  # above this only the count is printed


def saved_at(project: dict) -> float:
    """Last-save time of a project (its soundscape.json mtime)."""
    path = user_model_dir(project["workspace"], project["model_id"]) / SOUNDSCAPE_JSON
    return path.stat().st_mtime


def owned_projects(user_hash: str) -> list[dict]:
    """Every saved project in the user's owned workspaces, newest first."""
    workspaces = [
        {"id": w["id"], "name": w.get("name") or "", "role": w["role"]}
        for w in metadata_store.list_workspaces_for_user(user_hash)
        if w["role"] == ROLE_OWNER
    ]
    projects = [
        p for w in workspaces for p in list_projects(w) if p["model_id"] != SANDBOX_MODEL_ID
    ]
    return sorted(projects, key=saved_at, reverse=True)


def is_real_user(email: str) -> bool:
    """False for anonymous dev sessions and load-test virtual users."""
    return not email.startswith(ANON_EMAIL_PREFIX) and not email.endswith(f"@{LOADTEST_EMAIL_DOMAIN}")


def select_users(email: Optional[str], include_anon: bool) -> list[dict]:
    if email:
        user = metadata_store.get_user(user_hash_for_email(email))
        if not user:
            raise SystemExit(f"No user with email {email}")
        return [user]
    users = [dict(r) for r in metadata_store._query(USERS_SQL)]
    return users if include_anon else [u for u in users if is_real_user(u["email"])]


def select_projects(projects: list[dict], model_id: Optional[str], all_models: bool) -> list[dict]:
    if model_id:
        return [p for p in projects if p["model_id"] == model_id]
    return projects if all_models else projects[:1]


def mint_invite(project: dict, owner_hash: str, base_url: str, ttl_s: int, max_uses: int) -> tuple[str, Optional[str]]:
    """Create a viewer invite scoped to the project's model; returns (url, expires_at)."""
    expires_at = (
        None if ttl_s <= 0 else (datetime.now(timezone.utc) + timedelta(seconds=ttl_s)).isoformat()
    )
    token = metadata_store.create_invite(
        project["workspace"],
        ROLE_VIEWER,
        owner_hash,
        expires_at=expires_at,
        max_uses=max_uses,
        model_id=project["model_id"],
    )
    # Same shape as routers/workspaces.py create_invite + window.location.origin.
    return f"{base_url.rstrip('/')}/?invite={token}&model_id={project['model_id']}", expires_at


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", help="only this user")
    parser.add_argument("--model-id", help="link this model instead of the most recent one")
    parser.add_argument("--all-models", action="store_true", help="one link per saved model, not just the chosen one")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"app origin (default {DEFAULT_BASE_URL})")
    parser.add_argument(
        "--expires-days", type=float,
        help=f"link lifetime in days, 0 = never (default {INVITE_DEFAULT_TTL_S // SECONDS_PER_DAY})",
    )
    parser.add_argument("--max-uses", type=int, default=INVITE_MAX_USES_DEFAULT, help="0 = unlimited (default)")
    parser.add_argument("--csv", metavar="PATH", help="also write email,model,link rows to this CSV")
    parser.add_argument("--include-anon", action="store_true", help="also anonymous dev / load-test users")
    parser.add_argument("--dry-run", action="store_true", help="show the chosen models without creating invites")
    args = parser.parse_args()

    ttl_s = INVITE_DEFAULT_TTL_S if args.expires_days is None else int(args.expires_days * SECONDS_PER_DAY)
    rows: list[dict] = []
    skipped: list[str] = []

    for user in select_users(args.email, args.include_anon):
        projects = select_projects(owned_projects(user["user_hash"]), args.model_id, args.all_models)
        if not projects:
            skipped.append(user["email"])
            continue
        for p in projects:
            url, expires_at = ("(dry run)", None)
            if not args.dry_run:
                url, expires_at = mint_invite(p, user["user_hash"], args.base_url, ttl_s, args.max_uses)
            rows.append(
                {
                    "email": user["email"],
                    "model_name": p["name"],
                    "kind": p["kind"],
                    "model_id": p["model_id"],
                    "workspace_id": p["workspace"],
                    "saved_at": datetime.fromtimestamp(saved_at(p), timezone.utc).strftime("%Y-%m-%d %H:%M"),
                    "expires_at": expires_at or ("never" if ttl_s <= 0 else ""),
                    "link": url,
                }
            )

    print(f"{'EMAIL':34} {'MODEL':30} {'KIND':8} {'SAVED (UTC)':16}  LINK")
    for r in rows:
        print(f"{r['email'][:34]:34} {r['model_name'][:30]:30} {r['kind']:8} {r['saved_at']:16}  {r['link']}")
    if skipped and len(skipped) <= MAX_SKIPPED_LISTED:
        print(f"\nNo matching saved model: {', '.join(skipped)}")

    if args.csv and rows:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        print(f"\nWrote {len(rows)} row(s) to {args.csv}")

    verb = "would be created" if args.dry_run else "created"
    print(f"\n{len(rows)} invite(s) {verb}, {len(skipped)} user(s) without a matching saved model")
    return 0


if __name__ == "__main__":
    sys.exit(main())
