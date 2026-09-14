"""SQLite metadata store — users, sessions, workspaces, membership, blob refs.

This is the durable metadata layer for multi-user / shared-session support.
It stores *metadata only*: all audio/media stays on the filesystem under
``data/`` (content-addressed blobs / workspace dirs). See ``services/paths.py``.

Design notes:
  * One process-wide connection, WAL mode, guarded by a lock. All calls are
    short and synchronous; ``sqlite3`` with ``check_same_thread=False`` is safe
    because every access is serialized by the lock.
  * No ORM / no async driver on purpose (keeps the no-heavy-DB footprint).
  * IDs are opaque strings; user identity is the **hash** of a verified email so
    the raw address is only stored in one place (``users.email``) should it ever
    need to be purged.
"""

import hashlib
import logging
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from config.constants import APP_DB_PATH

logger = logging.getLogger(__name__)


ROLE_OWNER = "owner"
ROLE_EDITOR = "editor"
ROLE_VIEWER = "viewer"
VALID_ROLES = (ROLE_OWNER, ROLE_EDITOR, ROLE_VIEWER)

SHARING_PRIVATE = "private"
SHARING_LINK = "link"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso_before(seconds: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_hash_for_email(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


def _new_id() -> str:
    return uuid.uuid4().hex


_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_hash     TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    display_name  TEXT,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash    TEXT PRIMARY KEY,
    user_hash     TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    last_seen     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
    id            TEXT PRIMARY KEY,
    owner_hash    TEXT NOT NULL,
    name          TEXT NOT NULL,
    sharing_mode  TEXT NOT NULL DEFAULT 'private',
    revision      INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id  TEXT NOT NULL,
    user_hash     TEXT NOT NULL,
    role          TEXT NOT NULL,
    joined_at     TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_hash)
);

CREATE TABLE IF NOT EXISTS invites (
    token_hash    TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    role          TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    expires_at    TEXT,
    revoked       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS model_workspace (
    model_id      TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blobs (
    hash          TEXT PRIMARY KEY,
    ext           TEXT,
    mime          TEXT,
    byte_size     INTEGER NOT NULL DEFAULT 0,
    duration      REAL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blob_refs (
    hash          TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    model_id      TEXT,
    kind          TEXT,
    ref_key       TEXT,
    PRIMARY KEY (hash, workspace_id, model_id, ref_key)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_hash);
CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_hash);
CREATE INDEX IF NOT EXISTS idx_model_workspace ON model_workspace(workspace_id);
CREATE INDEX IF NOT EXISTS idx_blob_refs_ws ON blob_refs(workspace_id, model_id);
"""


class MetadataStore:
    def __init__(self, db_path: str = APP_DB_PATH) -> None:
        self._db_path = db_path
        self._lock = threading.RLock()
        self._conn: Optional[sqlite3.Connection] = None

    # ── connection / schema ──────────────────────────────────────────────
    def _connect(self) -> sqlite3.Connection:
        if self._conn is None:
            Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(self._db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=5000")
            self._conn = conn
        return self._conn

    def init_db(self) -> None:
        with self._lock:
            conn = self._connect()
            conn.executescript(_SCHEMA)
            conn.commit()

    def _query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._connect().execute(sql, params).fetchall()

    def _execute(self, sql: str, params: tuple = ()) -> None:
        with self._lock:
            conn = self._connect()
            conn.execute(sql, params)
            conn.commit()

    # ── users ────────────────────────────────────────────────────────────
    def get_or_create_user(self, email: str, display_name: Optional[str] = None) -> dict:
        email = email.strip().lower()
        uh = user_hash_for_email(email)
        rows = self._query("SELECT * FROM users WHERE user_hash = ?", (uh,))
        if rows:
            return dict(rows[0])
        default_name = display_name or email.split("@")[0]
        self._execute(
            "INSERT OR IGNORE INTO users (user_hash, email, display_name, created_at) VALUES (?, ?, ?, ?)",
            (uh, email, default_name, _now()),
        )
        return dict(self._query("SELECT * FROM users WHERE user_hash = ?", (uh,))[0])

    def get_user(self, user_hash: str) -> Optional[dict]:
        rows = self._query("SELECT * FROM users WHERE user_hash = ?", (user_hash,))
        return dict(rows[0]) if rows else None

    def set_display_name(self, user_hash: str, display_name: str) -> None:
        self._execute("UPDATE users SET display_name = ? WHERE user_hash = ?", (display_name, user_hash))

    # ── workspaces ───────────────────────────────────────────────────────
    def create_workspace(self, owner_hash: str, name: str, workspace_id: Optional[str] = None) -> dict:
        wid = workspace_id or _new_id()
        now = _now()
        self._execute(
            "INSERT OR IGNORE INTO workspaces (id, owner_hash, name, sharing_mode, revision, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 1, ?, ?)",
            (wid, owner_hash, name, SHARING_PRIVATE, now, now),
        )
        self._execute(
            "INSERT OR IGNORE INTO workspace_members (workspace_id, user_hash, role, joined_at) VALUES (?, ?, ?, ?)",
            (wid, owner_hash, ROLE_OWNER, now),
        )
        return self.get_workspace(wid)  # type: ignore[return-value]

    def get_workspace(self, workspace_id: str) -> Optional[dict]:
        rows = self._query("SELECT * FROM workspaces WHERE id = ?", (workspace_id,))
        return dict(rows[0]) if rows else None

    def get_or_create_default_workspace(self, user_hash: str, name: str) -> dict:
        rows = self._query(
            "SELECT w.* FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id "
            "WHERE m.user_hash = ? AND w.owner_hash = ? ORDER BY w.created_at ASC LIMIT 1",
            (user_hash, user_hash),
        )
        if rows:
            return dict(rows[0])
        return self.create_workspace(user_hash, name)

    def set_sharing_mode(self, workspace_id: str, mode: str) -> None:
        if mode not in (SHARING_PRIVATE, SHARING_LINK):
            raise ValueError(f"invalid sharing mode: {mode}")
        self._execute(
            "UPDATE workspaces SET sharing_mode = ?, updated_at = ? WHERE id = ?",
            (mode, _now(), workspace_id),
        )

    def bump_revision(self, workspace_id: str) -> int:
        self._execute(
            "UPDATE workspaces SET revision = revision + 1, updated_at = ? WHERE id = ?",
            (_now(), workspace_id),
        )
        ws = self.get_workspace(workspace_id)
        return int(ws["revision"]) if ws else 0

    # ── membership ───────────────────────────────────────────────────────
    def add_member(self, workspace_id: str, user_hash: str, role: str) -> None:
        if role not in VALID_ROLES:
            raise ValueError(f"invalid role: {role}")
        self._execute(
            "INSERT INTO workspace_members (workspace_id, user_hash, role, joined_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(workspace_id, user_hash) DO UPDATE SET role = excluded.role",
            (workspace_id, user_hash, role, _now()),
        )

    def get_member_role(self, workspace_id: str, user_hash: str) -> Optional[str]:
        rows = self._query(
            "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_hash = ?",
            (workspace_id, user_hash),
        )
        return rows[0]["role"] if rows else None

    def list_workspaces_for_user(self, user_hash: str) -> list[dict]:
        rows = self._query(
            "SELECT w.*, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id "
            "WHERE m.user_hash = ? ORDER BY w.updated_at DESC",
            (user_hash,),
        )
        return [dict(r) for r in rows]

    # ── sessions ─────────────────────────────────────────────────────────
    def get_session(self, token: str) -> Optional[dict]:
        if not token:
            return None
        rows = self._query("SELECT * FROM sessions WHERE token_hash = ?", (hash_token(token),))
        return dict(rows[0]) if rows else None

    def create_session(self, token: str, user_hash: str, workspace_id: str) -> dict:
        now = _now()
        self._execute(
            "INSERT OR REPLACE INTO sessions (token_hash, user_hash, workspace_id, created_at, last_seen) "
            "VALUES (?, ?, ?, ?, ?)",
            (hash_token(token), user_hash, workspace_id, now, now),
        )
        return self.get_session(token)  # type: ignore[return-value]

    def touch_session(self, token: str, min_interval_s: int = 300) -> None:
        """Refresh last_seen, but only if it is stale (avoids a write per poll)."""
        if not token:
            return
        with self._lock:
            conn = self._connect()
            conn.execute(
                "UPDATE sessions SET last_seen = ? WHERE token_hash = ? "
                "AND (last_seen IS NULL OR last_seen < ?)",
                (_now(), hash_token(token), _iso_before(min_interval_s)),
            )
            conn.commit()

    def set_session_workspace(self, token: str, workspace_id: str) -> None:
        self._execute(
            "UPDATE sessions SET workspace_id = ?, last_seen = ? WHERE token_hash = ?",
            (workspace_id, _now(), hash_token(token)),
        )

    # ── model ↔ workspace index (for ?model_id= bootstrap) ───────────────
    def link_model(self, model_id: str, workspace_id: str) -> None:
        self._execute(
            "INSERT INTO model_workspace (model_id, workspace_id, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(model_id) DO UPDATE SET workspace_id = excluded.workspace_id, updated_at = excluded.updated_at",
            (model_id, workspace_id, _now()),
        )

    def resolve_model_workspace(self, model_id: str) -> Optional[str]:
        rows = self._query("SELECT workspace_id FROM model_workspace WHERE model_id = ?", (model_id,))
        return rows[0]["workspace_id"] if rows else None

    def unlink_model(self, model_id: str) -> None:
        self._execute("DELETE FROM model_workspace WHERE model_id = ?", (model_id,))

    # ── invites ──────────────────────────────────────────────────────────
    def create_invite(self, workspace_id: str, role: str, created_by: str, expires_at: Optional[str] = None) -> str:
        if role not in VALID_ROLES:
            raise ValueError(f"invalid role: {role}")
        token = uuid.uuid4().hex
        self._execute(
            "INSERT INTO invites (token_hash, workspace_id, role, created_by, created_at, expires_at, revoked) "
            "VALUES (?, ?, ?, ?, ?, ?, 0)",
            (hash_token(token), workspace_id, role, created_by, _now(), expires_at),
        )
        return token

    def resolve_invite(self, token: str) -> Optional[dict]:
        rows = self._query("SELECT * FROM invites WHERE token_hash = ?", (hash_token(token),))
        if not rows:
            return None
        invite = dict(rows[0])
        if invite["revoked"]:
            return None
        expires = invite.get("expires_at")
        if expires and expires < _now():
            return None
        return invite

    def revoke_invite(self, token: str) -> None:
        self._execute("UPDATE invites SET revoked = 1 WHERE token_hash = ?", (hash_token(token),))

    # ── blobs (media registry / refcounting — used by the media layer) ───
    def register_blob(self, blob_hash: str, ext: str = "", mime: str = "", byte_size: int = 0, duration: Optional[float] = None) -> None:
        self._execute(
            "INSERT OR IGNORE INTO blobs (hash, ext, mime, byte_size, duration, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (blob_hash, ext, mime, byte_size, duration, _now()),
        )

    def add_blob_ref(self, blob_hash: str, workspace_id: str, model_id: Optional[str], kind: str, ref_key: str) -> None:
        self._execute(
            "INSERT OR IGNORE INTO blob_refs (hash, workspace_id, model_id, kind, ref_key) VALUES (?, ?, ?, ?, ?)",
            (blob_hash, workspace_id, model_id, kind, ref_key),
        )

    def remove_model_blob_refs(self, workspace_id: str, model_id: str) -> list[str]:
        """Drop a model's refs; return the hashes that may now be unreferenced."""
        rows = self._query(
            "SELECT DISTINCT hash FROM blob_refs WHERE workspace_id = ? AND model_id = ?",
            (workspace_id, model_id),
        )
        hashes = [r["hash"] for r in rows]
        self._execute("DELETE FROM blob_refs WHERE workspace_id = ? AND model_id = ?", (workspace_id, model_id))
        return hashes

    def is_blob_referenced(self, blob_hash: str) -> bool:
        rows = self._query("SELECT 1 FROM blob_refs WHERE hash = ? LIMIT 1", (blob_hash,))
        return bool(rows)

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None


# Process-wide singleton.
metadata_store = MetadataStore()
