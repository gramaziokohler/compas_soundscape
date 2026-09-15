"""Workspace presence tracking (who else is viewing/editing a workspace).

Lives in Redis (ephemeral by design ÔÇö presence is not durable). Uses a sorted
set per workspace: member = session token, score = last-heartbeat unix time.
Stale members are pruned by score, so a crashed tab disappears after the TTL.

All helpers degrade gracefully (return a safe default) when Redis is down, so
presence never blocks the app.
"""

import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

PRESENCE_TTL_S = 60          # a member is "active" if seen within this window
PRESENCE_KEY_TTL_S = 300     # the key itself expires if nobody heartbeats


def _key(workspace_id: str) -> str:
    return f"ws:{workspace_id}:presence"


async def heartbeat(redis, workspace_id: str, token: str, ttl_s: int = PRESENCE_TTL_S) -> int:
    """Record a heartbeat and return the number of active members."""
    if not workspace_id or not token:
        return 1
    if redis is None:
        return 1
    now = time.time()
    key = _key(workspace_id)
    try:
        pipe = redis.pipeline()
        pipe.zremrangebyscore(key, 0, now - ttl_s)
        pipe.zadd(key, {token: now})
        pipe.expire(key, PRESENCE_KEY_TTL_S)
        pipe.zcard(key)
        results = await pipe.execute()
        return int(results[-1]) if results else 1
    except Exception as exc:  # noqa: BLE001 - presence must never break a request
        logger.debug("presence heartbeat failed: %s", exc)
        return 1


async def active_count(redis, workspace_id: str, ttl_s: int = PRESENCE_TTL_S) -> int:
    """Return the number of members seen within the TTL window."""
    if not workspace_id or redis is None:
        return 1
    now = time.time()
    key = _key(workspace_id)
    try:
        pipe = redis.pipeline()
        pipe.zremrangebyscore(key, 0, now - ttl_s)
        pipe.zcard(key)
        results = await pipe.execute()
        count = int(results[-1]) if results else 0
        return max(count, 1)
    except Exception as exc:  # noqa: BLE001
        logger.debug("presence count failed: %s", exc)
        return 1


def active_members(redis_keys: Optional[list] = None) -> list:
    """Reserved for a future per-member breakdown (names/roles)."""
    return []
