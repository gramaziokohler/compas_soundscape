"""SQLite store for research-study interaction logs (own file: ``STUDY_DB_PATH``).

Same design as ``services/metadata_store.py``: one process-wide connection,
WAL, serialized by an RLock, ``check_same_thread=False``, ``busy_timeout``,
``CREATE IF NOT EXISTS`` + additive ``_migrate()``. Kept in a separate file so
study logging never contends with the metadata store's lock. Every method is
synchronous — async callers wrap them in ``asyncio.to_thread``.

Nothing is created on disk unless a method is actually called; ``init_db()``
is a no-op while ``STUDY_LOGGING_ENABLED`` is off.
"""

import asyncio
import hashlib
import json
import logging
import sqlite3
import threading
import time
import uuid
import zlib
from pathlib import Path
from typing import Any, Iterable, Optional

from config.constants import STUDY_DB_PATH, STUDY_PSEUDONYM_PREFIX
from services.study_config import study_enabled
from services.study_log_schema import EVENT_COLUMNS, STUDY_SCHEMA
from utils.study_sanitize import sanitize_payload

logger = logging.getLogger(__name__)

SOURCE_CLIENT = "client"
SOURCE_SERVER = "server"

def now_ms() -> int:
    return int(time.time() * 1000)


def _placeholders(n: int) -> str:
    return ",".join("?" * n)


def _version_from_snapshot(json_text: str) -> tuple[Optional[str], Optional[str]]:
    """Best-effort ``(model_id, version_id)`` from a snapshot's top-level keys."""
    try:
        data = json.loads(json_text)
    except ValueError:
        return None, None
    if not isinstance(data, dict):
        return None, None

    def pick(*keys: str) -> Optional[str]:
        for key in keys:
            value = data.get(key)
            if isinstance(value, (str, int)) and str(value):
                return str(value)[:256]
        return None

    return (
        pick("model_id", "modelId", "speckle_model_id"),
        pick("version_id", "versionId", "model_version_id", "loadedModelVersionId"),
    )


class StudyLogStore:
    def __init__(self, db_path: str = STUDY_DB_PATH) -> None:
        self._db_path = db_path
        self._lock = threading.RLock()
        self._conn: Optional[sqlite3.Connection] = None
        # Strong refs to fire-and-forget insert tasks (asyncio keeps only weak ones).
        self._pending: set[asyncio.Task] = set()

    # ── connection / schema ──────────────────────────────────────────────
    def _connect(self) -> sqlite3.Connection:
        if self._conn is None:
            Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(self._db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.executescript(STUDY_SCHEMA)
            self._migrate(conn)
            conn.commit()
            self._conn = conn
        return self._conn

    def init_db(self) -> None:
        """Create the study DB (lifespan). No-op — no file — when logging is off."""
        if not study_enabled():
            return
        with self._lock:
            self._connect()
        logger.info("Study logging enabled — DB at %s", self._db_path)

    def _migrate(self, conn: sqlite3.Connection) -> None:
        """Idempotent additive migrations for databases created by older builds."""
        audio_cols = {r["name"] for r in conn.execute("PRAGMA table_info(study_audio)").fetchall()}
        if "workspace_id" not in audio_cols:
            conn.execute("ALTER TABLE study_audio ADD COLUMN workspace_id TEXT")

    def _query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._connect().execute(sql, params).fetchall()

    def _execute(self, sql: str, params: tuple = ()) -> int:
        """Run one write and return the number of changed rows."""
        with self._lock:
            conn = self._connect()
            cur = conn.execute(sql, params)
            conn.commit()
            return cur.rowcount

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

    # ── participants ─────────────────────────────────────────────────────
    def register_participant(self, user_hash: Optional[str]) -> Optional[str]:
        """Return the participant's pseudonym, assigning the next ``P<nn>`` on first sight."""
        if not user_hash:
            return None
        with self._lock:
            rows = self._query("SELECT pseudonym FROM study_participants WHERE user_hash = ?", (user_hash,))
            if rows:
                return rows[0]["pseudonym"]
            count = self._query("SELECT COUNT(*) AS n FROM study_participants")[0]["n"]
            pseudonym = f"{STUDY_PSEUDONYM_PREFIX}{count + 1:02d}"
            self._execute(
                "INSERT INTO study_participants (user_hash, pseudonym, first_seen) VALUES (?, ?, ?)",
                (user_hash, pseudonym, now_ms()),
            )
            return pseudonym

    def list_participants(self) -> list[dict]:
        return [dict(r) for r in self._query("SELECT * FROM study_participants ORDER BY first_seen")]

    # ── events ───────────────────────────────────────────────────────────
    def insert_events(self, rows: list[dict]) -> int:
        """INSERT OR IGNORE a batch (dedupe by id); return how many were new.

        ``payload`` may be any object — it is sanitized and JSON-encoded here so
        the work happens off the event loop.
        """
        if not rows:
            return 0
        values = [
            tuple(
                json.dumps(sanitize_payload(row.get("payload") or {}), ensure_ascii=False)
                if col == "payload" else row.get(col)
                for col in EVENT_COLUMNS
            )
            for row in rows
        ]
        sql = (
            f"INSERT OR IGNORE INTO study_events ({','.join(EVENT_COLUMNS)}) "
            f"VALUES ({_placeholders(len(EVENT_COLUMNS))})"
        )
        with self._lock:
            conn = self._connect()
            before = conn.total_changes
            conn.executemany(sql, values)
            conn.commit()
            return conn.total_changes - before

    def _insert_server_event_safe(self, row: dict) -> None:
        try:
            self.insert_events([row])
        except Exception as exc:  # noqa: BLE001 - logging must never break callers
            logger.warning("Study server event %s not logged: %s", row.get("type"), exc)

    def log_server_event_nowait(
        self,
        event_type: str,
        payload: Any,
        user_hash: Optional[str],
        workspace_id: Optional[str],
    ) -> None:
        """Fire-and-forget server-side event. Never raises, never blocks the loop."""
        try:
            if not study_enabled():
                return
            ts = now_ms()
            row = {
                "id": uuid.uuid4().hex, "type": event_type, "ts_client": ts, "ts_server": ts,
                "seq": 0, "tab_session_id": "", "user_hash": user_hash,
                "workspace_id": workspace_id or None, "model_id": None, "version_id": None,
                "ui_mode": None, "source": SOURCE_SERVER, "payload": payload,
            }
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None
            if loop is None:
                self._insert_server_event_safe(row)
                return
            task = loop.create_task(asyncio.to_thread(self._insert_server_event_safe, row))
            self._pending.add(task)
            task.add_done_callback(self._pending.discard)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Study server event %s not logged: %s", event_type, exc)

    def list_events(
        self,
        since_ms: Optional[int] = None,
        until_ms: Optional[int] = None,
        workspace_ids: Optional[Iterable[str]] = None,
    ) -> list[dict]:
        clauses, params = ["1=1"], []
        if since_ms is not None:
            clauses.append("ts_server >= ?")
            params.append(since_ms)
        if until_ms is not None:
            clauses.append("ts_server < ?")
            params.append(until_ms)
        if workspace_ids is not None:
            ws = list(workspace_ids)
            clauses.append(f"workspace_id IN ({_placeholders(len(ws))})" if ws else "0=1")
            params.extend(ws)
        sql = (
            f"SELECT * FROM study_events WHERE {' AND '.join(clauses)} "
            "ORDER BY ts_server, ts_client, seq"
        )
        return [dict(r) for r in self._query(sql, tuple(params))]

    def event_counts(self, recent_since_ms: int) -> list[dict]:
        """Per (workspace, user): total events and events since ``recent_since_ms``."""
        rows = self._query(
            "SELECT workspace_id, user_hash, COUNT(*) AS total, "
            "SUM(CASE WHEN ts_server >= ? THEN 1 ELSE 0 END) AS recent, MAX(ts_server) AS last_ts "
            "FROM study_events GROUP BY workspace_id, user_hash ORDER BY workspace_id, user_hash",
            (recent_since_ms,),
        )
        return [dict(r) for r in rows]

    def workspace_first_seen(self) -> list[dict]:
        """Every workspace with events, oldest first (for automatic G1.. labels)."""
        rows = self._query(
            "SELECT workspace_id, MIN(ts_server) AS first_ts FROM study_events "
            "WHERE workspace_id IS NOT NULL GROUP BY workspace_id ORDER BY first_ts"
        )
        return [dict(r) for r in rows]

    # ── snapshots ────────────────────────────────────────────────────────
    def insert_snapshot(
        self, client_hash: str, json_text: str, user_hash: Optional[str], workspace_id: Optional[str]
    ) -> bool:
        """Store a zlib-compressed snapshot once per client hash; True when new."""
        if self._query("SELECT 1 FROM study_snapshots WHERE hash = ?", (client_hash,)):
            return False
        raw = json_text.encode("utf-8")
        model_id, version_id = _version_from_snapshot(json_text)
        changed = self._execute(
            "INSERT OR IGNORE INTO study_snapshots "
            "(hash, sha256, created_at, user_hash, workspace_id, model_id, version_id, size, data) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                client_hash, hashlib.sha256(raw).hexdigest(), now_ms(), user_hash, workspace_id,
                model_id, version_id, len(raw), zlib.compress(raw),
            ),
        )
        return changed > 0

    def known_snapshots(self, hashes: list[str]) -> list[str]:
        if not hashes:
            return []
        rows = self._query(
            f"SELECT hash FROM study_snapshots WHERE hash IN ({_placeholders(len(hashes))})",
            tuple(hashes),
        )
        return [r["hash"] for r in rows]

    def get_snapshots(self, hashes: Iterable[str]) -> list[dict]:
        """Rows (with ``data`` decompressed to ``json`` text) for the given hashes."""
        wanted = sorted(set(hashes))
        out: list[dict] = []
        for i in range(0, len(wanted), 500):
            chunk = wanted[i:i + 500]
            rows = self._query(
                f"SELECT * FROM study_snapshots WHERE hash IN ({_placeholders(len(chunk))})", tuple(chunk)
            )
            for r in rows:
                row = dict(r)
                row["json"] = zlib.decompress(row.pop("data")).decode("utf-8")
                out.append(row)
        return out

    def snapshot_hashes_for_workspaces(
        self, workspace_ids: list[str], since_ms: Optional[int], until_ms: Optional[int]
    ) -> list[str]:
        if not workspace_ids:
            return []
        sql = f"SELECT hash FROM study_snapshots WHERE workspace_id IN ({_placeholders(len(workspace_ids))})"
        params: list[Any] = list(workspace_ids)
        if since_ms is not None:
            sql += " AND created_at >= ?"
            params.append(since_ms)
        if until_ms is not None:
            sql += " AND created_at < ?"
            params.append(until_ms)
        return [r["hash"] for r in self._query(sql, tuple(params))]

    # ── moments ──────────────────────────────────────────────────────────
    def create_moment(self, row: dict) -> None:
        cols = ("id", "event_id", "user_hash", "workspace_id", "screenshot_path", "snapshot_hash",
                "ts_client", "ts_server")
        self._execute(
            f"INSERT INTO study_moments ({','.join(cols)}) VALUES ({_placeholders(len(cols))})",
            tuple(row.get(c) for c in cols),
        )

    def get_moment(self, moment_id: str) -> Optional[dict]:
        rows = self._query("SELECT * FROM study_moments WHERE id = ?", (moment_id,))
        return dict(rows[0]) if rows else None

    def note_moment(self, moment_id: str, note: str, tags: list[str]) -> None:
        self._execute(
            "UPDATE study_moments SET note = ?, tags = ?, noted_at = ? WHERE id = ?",
            (note, json.dumps(tags, ensure_ascii=False), now_ms(), moment_id),
        )

    def list_moments(self, workspace_ids: list[str]) -> list[dict]:
        if not workspace_ids:
            return []
        rows = self._query(
            f"SELECT * FROM study_moments WHERE workspace_id IN ({_placeholders(len(workspace_ids))}) "
            "ORDER BY ts_server",
            tuple(workspace_ids),
        )
        return [dict(r) for r in rows]

    # ── audio archive ────────────────────────────────────────────────────
    def is_audio_archived(self, url: str) -> bool:
        return bool(self._query("SELECT 1 FROM study_audio WHERE url = ?", (url,)))

    def record_audio(self, row: dict) -> None:
        cols = ("url", "workspace_id", "archived_path", "sha256", "size", "first_event_id", "archived_at")
        self._execute(
            f"INSERT OR IGNORE INTO study_audio ({','.join(cols)}) VALUES ({_placeholders(len(cols))})",
            tuple(row.get(c) for c in cols),
        )

    def list_audio(self, workspace_ids: list[str]) -> list[dict]:
        if not workspace_ids:
            return []
        rows = self._query(
            f"SELECT * FROM study_audio WHERE workspace_id IN ({_placeholders(len(workspace_ids))}) "
            "ORDER BY archived_at",
            tuple(workspace_ids),
        )
        return [dict(r) for r in rows]


study_log_store = StudyLogStore()
