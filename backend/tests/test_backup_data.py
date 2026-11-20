"""scripts/backup_data.py: when a snapshot is due, hardlinking, pruning, restore."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sqlite3
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
_spec = importlib.util.spec_from_file_location("backup_data", BACKEND / "scripts" / "backup_data.py")
bd = importlib.util.module_from_spec(_spec)
sys.modules["backup_data"] = bd
_spec.loader.exec_module(bd)


@pytest.fixture()
def env(tmp_path, monkeypatch):
    data = tmp_path / "data"
    model = data / "soundscapes" / "ws1" / "m1"
    (model / "audio").mkdir(parents=True)
    (model / "soundscape.json").write_text(json.dumps({"model_id": "m1", "version_id": "v1"}), encoding="utf-8")
    (model / "audio" / "a.wav").write_bytes(b"\0" * 1000)
    (data / "soundscapes" / "ws1" / "loadtest-vu-01").mkdir()
    (data / "soundscapes" / "ws1" / "loadtest-vu-01" / "soundscape.json").write_text("{}", encoding="utf-8")
    db = data / "app.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE workspaces (id TEXT, name TEXT, owner_hash TEXT)")
    con.execute("CREATE TABLE users (user_hash TEXT, email TEXT)")
    con.execute("CREATE TABLE sessions (token_hash TEXT, last_seen TEXT)")
    con.execute("INSERT INTO workspaces VALUES ('ws1', 'Mine', 'u1')")
    con.commit()
    con.close()
    monkeypatch.setattr(bd.C, "BACKUP_TREE_SOURCES", (("soundscapes", data / "soundscapes"),))
    monkeypatch.setattr(bd.C, "BACKUP_SQLITE_SOURCES", (("app.db", db),))
    monkeypatch.setattr(bd.C, "SOUNDSCAPE_DATA_DIR", str(data / "soundscapes"))
    monkeypatch.setattr(bd.C, "BACKUP_JSON_RETRY_DELAY_S", 0.0)
    bd.log.handlers.clear()
    return tmp_path / "backups", model, db


def _run(dest: Path, **kw) -> dict:
    args = argparse.Namespace(dest=dest, min_change_mb=kw.get("min_change_mb", 1), max_age_days=7,
                              keep_daily=14, keep_weekly=8, keep_monthly=12,
                              force=kw.get("force", False), dry_run=False)
    assert bd.cmd_run(args) == 0
    return json.loads((dest / bd.LAST_RUN).read_text(encoding="utf-8"))


def test_first_run_snapshots_everything_except_loadtests(env):
    dest, _, _ = env
    r = _run(dest)
    assert r["decision"] == "backup" and r["reason"] == "first snapshot"
    snap = bd._snapshot_dirs(dest)[-1]
    assert (snap / "soundscapes/ws1/m1/audio/a.wav").is_file()
    assert (snap / "app.db").is_file()
    assert not (snap / "soundscapes/ws1/loadtest-vu-01").exists()
    catalog = json.loads((snap / bd.CATALOG).read_text(encoding="utf-8"))["models"]
    assert catalog[0]["speckle_version_id"] == "v1" and catalog[0]["workspace_name"] == "Mine"


def test_unchanged_skips_and_session_rows_do_not_count(env):
    dest, _, db = env
    _run(dest)
    con = sqlite3.connect(db)
    con.execute("INSERT INTO sessions VALUES ('t', 'now')")
    con.commit()
    con.close()
    assert _run(dest)["reason"] == "no change"


def test_small_bulk_change_waits_but_soundscape_change_triggers(env):
    dest, model, _ = env
    _run(dest)
    (model / "audio" / "b.wav").write_bytes(b"\1" * 10)
    r = _run(dest)
    assert r["decision"] == "skip" and r["added"] == 1
    (model / "soundscape.json").write_text(json.dumps({"model_id": "m1", "version_id": "v2"}), encoding="utf-8")
    first = bd._snapshot_dirs(dest)[-1]
    first.rename(first.with_name("20200101-000000"))
    r = _run(dest)
    assert r["decision"] == "backup" and r["added"] == 1 and r["modified"] == 1
    old, new = bd._snapshot_dirs(dest)[0], bd._snapshot_dirs(dest)[-1]
    # Unchanged audio is a hardlink to the previous snapshot, not a copy.
    assert os.path.samefile(old / "soundscapes/ws1/m1/audio/a.wav", new / "soundscapes/ws1/m1/audio/a.wav")
    assert not os.path.samefile(old / "soundscapes/ws1/m1/soundscape.json",
                                new / "soundscapes/ws1/m1/soundscape.json")


def test_bulk_threshold_triggers(env):
    dest, model, _ = env
    _run(dest)
    (model / "audio" / "big.wav").write_bytes(b"\2" * (2 * bd.MB))
    assert _run(dest, min_change_mb=1)["decision"] == "backup"


def test_prune_keeps_newest_per_period(env, tmp_path):
    dest, _, _ = env
    root = dest / bd.SNAPSHOTS
    for name in ("20260101-020000", "20260101-030000", "20260102-020000", "20250601-020000"):
        (root / name).mkdir(parents=True)
        (root / name / bd.MANIFEST).write_text("{}", encoding="utf-8")
    removed = bd._prune(dest, keep_daily=1, keep_weekly=0, keep_monthly=0)
    assert removed == ["20250601-020000", "20260101-020000", "20260101-030000"]
    removed = bd._prune(dest, keep_daily=0, keep_weekly=0, keep_monthly=0)
    assert removed == []  # the newest snapshot is always kept


def test_restore_model_in_place_moves_live_copy_aside(env):
    dest, model, _ = env
    _run(dest)
    (model / "soundscape.json").write_text("{\"broken\": true}", encoding="utf-8")
    args = argparse.Namespace(dest=dest, snapshot="latest", model="m1", workspace=None, to=None, in_place=True)
    assert bd.cmd_restore(args) == 0
    assert json.loads((model / "soundscape.json").read_text(encoding="utf-8"))["version_id"] == "v1"
    assert os.access(model / "soundscape.json", os.W_OK)  # the app rewrites it in place
    aside = [p for p in model.parent.iterdir() if p.name.startswith("m1.pre-restore-")]
    assert len(aside) == 1
