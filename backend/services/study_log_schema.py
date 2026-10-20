"""Schema of the research-study log DB (``services/study_log_store.py``).

Timestamps are integer milliseconds since the Unix epoch (UTC).
"""

# Columns of study_events, in insert order.
EVENT_COLUMNS = (
    "id", "type", "ts_client", "ts_server", "seq", "tab_session_id", "user_hash",
    "workspace_id", "model_id", "version_id", "ui_mode", "source", "payload",
)

STUDY_SCHEMA = """
CREATE TABLE IF NOT EXISTS study_events (
    id             TEXT PRIMARY KEY,
    type           TEXT NOT NULL,
    ts_client      INTEGER,
    ts_server      INTEGER NOT NULL,
    seq            INTEGER,
    tab_session_id TEXT,
    user_hash      TEXT,
    workspace_id   TEXT,
    model_id       TEXT,
    version_id     TEXT,
    ui_mode        TEXT,
    source         TEXT NOT NULL,
    payload        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_snapshots (
    hash          TEXT PRIMARY KEY,
    sha256        TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    user_hash     TEXT,
    workspace_id  TEXT,
    model_id      TEXT,
    version_id    TEXT,
    size          INTEGER NOT NULL,
    data          BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS study_moments (
    id              TEXT PRIMARY KEY,
    event_id        TEXT NOT NULL,
    user_hash       TEXT,
    workspace_id    TEXT,
    note            TEXT,
    tags            TEXT,
    screenshot_path TEXT,
    snapshot_hash   TEXT,
    ts_client       INTEGER,
    ts_server       INTEGER NOT NULL,
    noted_at        INTEGER
);

CREATE TABLE IF NOT EXISTS study_audio (
    url             TEXT PRIMARY KEY,
    workspace_id    TEXT,
    archived_path   TEXT NOT NULL,
    sha256          TEXT NOT NULL,
    size            INTEGER NOT NULL,
    first_event_id  TEXT,
    archived_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS study_participants (
    user_hash   TEXT PRIMARY KEY,
    pseudonym   TEXT UNIQUE NOT NULL,
    first_seen  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_study_events_ws_ts ON study_events(workspace_id, ts_server);
CREATE INDEX IF NOT EXISTS idx_study_events_type ON study_events(type);
CREATE INDEX IF NOT EXISTS idx_study_moments_ws ON study_moments(workspace_id);
"""
