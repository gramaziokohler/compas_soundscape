"""Admin tool (read-only): every user's email and the workspace they are in now.

Reads data/app.db (SELECT only) and the Redis presence sets. Run from backend/:

    python scripts/list_users.py                 # all users
    python scripts/list_users.py --active 30     # only users seen in the last 30 min

Columns:
    LIVE       * = heartbeat in that workspace within the last 60 s (Redis presence)
    LAST SEEN  newest session activity (refreshed at most every 5 min)
    CURRENT WORKSPACE  the workspace their most recent session is bound to
    OWNS       every workspace id they own, oldest first (older builds allowed
               several; use one with transfer_scenes.py --*-workspace)
"""

import argparse
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.constants import APP_DB_PATH, REDIS_URL  # noqa: E402

PRESENCE_WINDOW_S = 60  # services/presence.py PRESENCE_TTL_S
PRESENCE_KEY_PATTERN = "ws:*:presence"  # services/presence.py _key()
REDIS_TIMEOUT_S = 2

USERS_SQL = """
SELECT u.user_hash, u.email, u.display_name,
       (SELECT GROUP_CONCAT(id, ', ') FROM (
          SELECT w.id FROM workspaces w WHERE w.owner_hash = u.user_hash
          ORDER BY w.created_at))                              AS owned_ws,
       s.workspace_id                                          AS current_ws,
       cw.name                                                 AS current_ws_name,
       m.role                                                  AS current_role,
       s.last_seen                                             AS last_seen
FROM users u
LEFT JOIN sessions s ON s.token_hash = (
    SELECT token_hash FROM sessions WHERE user_hash = u.user_hash
    ORDER BY last_seen DESC LIMIT 1)
LEFT JOIN workspaces cw ON cw.id = s.workspace_id
LEFT JOIN workspace_members m ON m.workspace_id = s.workspace_id AND m.user_hash = u.user_hash
ORDER BY s.last_seen DESC
"""


def live_presence() -> dict[str, set[str]]:
    """``{user_hash: {workspace_id, ...}}`` for heartbeats within the window."""
    try:
        import redis  # noqa: PLC0415

        client = redis.Redis.from_url(
            REDIS_URL, socket_connect_timeout=REDIS_TIMEOUT_S, socket_timeout=REDIS_TIMEOUT_S,
            decode_responses=True,
        )
        live: dict[str, set[str]] = {}
        since = time.time() - PRESENCE_WINDOW_S
        for key in client.scan_iter(PRESENCE_KEY_PATTERN):
            ws = key.split(":")[1]
            for user_hash in client.zrangebyscore(key, since, "+inf"):
                live.setdefault(user_hash, set()).add(ws)
        return live
    except Exception as exc:  # noqa: BLE001 - presence is optional
        print(f"(live presence unavailable: {exc})\n")
        return {}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--active", type=int, metavar="MIN", help="only users seen in the last MIN minutes")
    args = parser.parse_args()

    conn = sqlite3.connect(f"file:{APP_DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(USERS_SQL).fetchall()
    conn.close()

    if args.active is not None:
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=args.active)).isoformat()
        rows = [r for r in rows if r["last_seen"] and r["last_seen"] >= cutoff]

    live = live_presence()
    print(f"{'LIVE':4} {'EMAIL':34} {'LAST SEEN (UTC)':19} {'CURRENT WORKSPACE':52} {'OWNS'}")
    for r in rows:
        live_ws = live.get(r["user_hash"], set())
        current = r["current_ws"] or "-"
        if r["current_ws"]:
            current = f"{r['current_ws_name'] or '?'} [{r['current_role'] or 'no role'}] {r['current_ws'][:8]}"
        seen = (r["last_seen"] or "-")[:19].replace("T", " ")
        mark = "*" if live_ws else ""
        print(f"{mark:4} {r['email'][:34]:34} {seen:19} {current[:52]:52} {r['owned_ws'] or '-'}")
        for ws in sorted(live_ws - {r["current_ws"]}):
            print(f"{'':4} {'':34} {'':19} also live in {ws}")

    print(f"\n{len(rows)} user(s), {sum(1 for r in rows if r['user_hash'] in live)} live now")
    return 0


if __name__ == "__main__":
    sys.exit(main())
