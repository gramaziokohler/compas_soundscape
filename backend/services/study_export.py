"""Write one group's study-log export folder (used by ``scripts/export_study_logs.py``).

Files per group folder: ``events.jsonl``, ``events.csv``,
``listening_sessions.csv``, ``intent_notes.csv``, ``moments.csv`` +
``moments/*``, ``snapshots/<hash>.json``, ``audio/`` + ``audio_manifest.csv``.
``user_hash`` never appears: every row carries the participant pseudonym.
"""

import csv
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

import config.constants as constants
from services.study_audio_archive import safe_path_component
from services.study_log_store import study_log_store

EVENT_CSV_COLUMNS = (
    "id", "type", "ts_client", "ts_server", "ts_server_iso", "seq", "tab_session_id", "participant",
    "workspace_id", "model_id", "version_id", "ui_mode", "source", "payload_json",
)
LISTENING_COLUMNS = (
    "participant", "session_id", "workspace_id", "model_id", "version_id", "ui_mode", "start_ts_client",
    "start_iso", "duration_ms", "listened_ms", "stop_reason", "scope", "sound_id", "position_ms",
    "end_position_ms", "listener_kind", "listener_id", "listener_x", "listener_y", "listener_z",
    "yaw", "pitch", "roll", "render_mode", "engine_mode", "active_simulation_index",
    "active_simulation_engine", "selected_ir_id", "playing_source_ids", "muted", "soloed",
    "master_volume", "snapshot_hash", "after_snapshot_hash",
)
INTENT_COLUMNS = (
    "participant", "type", "ts_client", "ts_iso", "model_id", "version_id", "kind", "from_version_id",
    "to_version_id", "answer", "prompted_by_listening", "listening_detail", "tags", "snapshot_hash",
)
MOMENT_COLUMNS = (
    "id", "event_id", "participant", "ts_client", "ts_server_iso", "snapshot_hash", "note", "tags",
    "noted_at_iso", "screenshot",
)
AUDIO_COLUMNS = ("url", "file", "sha256", "size", "first_event_id", "archived_at_iso", "copied")


def iso(ms: Optional[int]) -> str:
    if ms is None:
        return ""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def _obj(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _joined(value: Any) -> str:
    if isinstance(value, list):
        return ";".join(str(v) for v in value)
    return "" if value is None else str(value)


def _write_csv(path: Path, columns: Iterable[str], rows: Iterable[dict]) -> int:
    count = 0
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(columns), extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
            count += 1
    return count


def _event_record(event: dict, pseudonym: Callable[[Optional[str]], str]) -> dict:
    record = {k: v for k, v in event.items() if k not in ("user_hash", "payload")}
    record["participant"] = pseudonym(event.get("user_hash"))
    record["ts_server_iso"] = iso(event.get("ts_server"))
    try:
        record["payload"] = _obj(json.loads(event.get("payload") or "{}"))
    except ValueError:
        record["payload"] = {}
    return record


def _start_ts(r: dict) -> Any:
    """Click time of a listen.start: the client logs the event once the design
    snapshot is hashed (up to ~1.5 s later) and keeps the real time in started_at."""
    started = r["payload"].get("started_at")
    return started if isinstance(started, (int, float)) else r.get("ts_client")


def _listening_rows(records: list[dict]) -> list[dict]:
    """Pair listen.start/listen.stop by (participant, payload.session_id)."""
    stops = {
        (r["participant"], r["payload"].get("session_id")): r
        for r in records if r["type"] == "listen.stop"
    }
    starts = [r for r in records if r["type"] == "listen.start"]
    starts.sort(key=lambda r: (_start_ts(r) or 0, r.get("seq") or 0))
    # after_snapshot_hash = snapshot of the same participant's next listen.start on the same model.
    next_snapshot: dict[str, Any] = {}
    last_by_key: dict[tuple, dict] = {}
    for r in starts:
        key = (r["participant"], r.get("model_id"))
        if key in last_by_key:
            next_snapshot[last_by_key[key]["id"]] = r["payload"].get("snapshot_hash")
        last_by_key[key] = r

    rows = []
    for r in starts:
        p = r["payload"]
        stop = stops.get((r["participant"], p.get("session_id")))
        sp = stop["payload"] if stop else {}
        listener = _obj(p.get("listener"))
        pos = listener.get("position") if isinstance(listener.get("position"), list) else []
        orient = _obj(listener.get("orientation"))
        sim = _obj(p.get("active_simulation"))
        start_ts = _start_ts(r)
        duration = (stop["ts_client"] - start_ts) if stop and stop.get("ts_client") and start_ts else ""
        rows.append({
            "participant": r["participant"], "session_id": p.get("session_id"),
            "workspace_id": r.get("workspace_id"), "model_id": r.get("model_id"),
            "version_id": r.get("version_id"), "ui_mode": r.get("ui_mode"),
            "start_ts_client": start_ts, "start_iso": iso(start_ts),
            "duration_ms": duration, "listened_ms": sp.get("listened_ms", ""),
            "stop_reason": sp.get("reason", ""), "scope": p.get("scope"), "sound_id": p.get("sound_id"),
            "position_ms": p.get("position_ms"), "end_position_ms": sp.get("end_position_ms", ""),
            "listener_kind": listener.get("kind"), "listener_id": listener.get("id"),
            "listener_x": pos[0] if len(pos) > 0 else None,
            "listener_y": pos[1] if len(pos) > 1 else None,
            "listener_z": pos[2] if len(pos) > 2 else None,
            "yaw": orient.get("yaw"), "pitch": orient.get("pitch"), "roll": orient.get("roll"),
            "render_mode": p.get("render_mode"), "engine_mode": p.get("engine_mode"),
            "active_simulation_index": sim.get("index"), "active_simulation_engine": sim.get("engine"),
            "selected_ir_id": p.get("selected_ir_id"),
            "playing_source_ids": _joined(p.get("playing_source_ids")),
            "muted": _joined(p.get("muted")), "soloed": _joined(p.get("soloed")),
            "master_volume": p.get("master_volume"), "snapshot_hash": p.get("snapshot_hash"),
            "after_snapshot_hash": next_snapshot.get(r["id"]) or "",
        })
    return rows


def _intent_rows(records: list[dict]) -> list[dict]:
    rows = []
    for r in records:
        if r["type"] not in ("intent.note", "intent.skipped"):
            continue
        p = r["payload"]
        rows.append({
            "participant": r["participant"], "type": r["type"], "ts_client": r.get("ts_client"),
            "ts_iso": iso(r.get("ts_client")), "model_id": r.get("model_id"), "version_id": r.get("version_id"),
            "kind": p.get("kind"), "from_version_id": p.get("from_version_id"),
            "to_version_id": p.get("to_version_id"), "answer": p.get("answer"),
            "prompted_by_listening": p.get("prompted_by_listening"),
            "listening_detail": p.get("listening_detail"), "tags": _joined(p.get("tags")),
            "snapshot_hash": p.get("snapshot_hash"),
        })
    return rows


def _export_moments(out: Path, workspace_ids: list[str], pseudonym: Callable) -> tuple[list[dict], int]:
    moments_dir = out / "moments"
    moments_dir.mkdir(exist_ok=True)
    rows = []
    for m in study_log_store.list_moments(workspace_ids):
        shot = ""
        if m.get("screenshot_path"):
            src = Path(constants.STUDY_MOMENTS_DIR) / m["screenshot_path"]
            if src.is_file():
                shot = f"moments/{safe_path_component(m['id'])}{src.suffix}"
                shutil.copy2(src, out / shot)
        try:
            tags = json.loads(m.get("tags") or "[]")
        except ValueError:
            tags = []
        rows.append({
            "id": m["id"], "event_id": m["event_id"], "participant": pseudonym(m.get("user_hash")),
            "ts_client": m.get("ts_client"), "ts_server_iso": iso(m.get("ts_server")),
            "snapshot_hash": m.get("snapshot_hash"), "note": m.get("note") or "", "tags": _joined(tags),
            "noted_at_iso": iso(m.get("noted_at")), "screenshot": shot,
        })
    return rows, _write_csv(out / "moments.csv", MOMENT_COLUMNS, rows)


def _export_snapshots(out: Path, hashes: set[str]) -> int:
    snap_dir = out / "snapshots"
    snap_dir.mkdir(exist_ok=True)
    count = 0
    for row in study_log_store.get_snapshots(hashes):
        (snap_dir / f"{safe_path_component(row['hash'])}.json").write_text(row["json"], encoding="utf-8")
        count += 1
    return count


def _export_audio(out: Path, workspace_ids: list[str], copy_files: bool) -> int:
    rows = []
    for a in study_log_store.list_audio(workspace_ids):
        src = Path(constants.STUDY_AUDIO_DIR) / a["archived_path"]
        rel = f"audio/{a['archived_path']}"
        copied = False
        if copy_files and src.is_file():
            dest = out / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            copied = True
        rows.append({
            "url": a["url"], "file": rel if copied else "", "sha256": a["sha256"], "size": a["size"],
            "first_event_id": a.get("first_event_id"), "archived_at_iso": iso(a.get("archived_at")),
            "copied": copied,
        })
    return _write_csv(out / "audio_manifest.csv", AUDIO_COLUMNS, rows)


def export_group(
    out: Path,
    workspace_ids: list[str],
    pseudonym: Callable[[Optional[str]], str],
    since_ms: Optional[int],
    until_ms: Optional[int],
    copy_audio: bool,
) -> tuple[dict[str, int], set[str]]:
    """Write every file of one group folder; return ``(row counts, user_hashes seen)``."""
    out.mkdir(parents=True, exist_ok=True)
    events = study_log_store.list_events(since_ms, until_ms, workspace_ids)
    records = [_event_record(e, pseudonym) for e in events]

    with (out / "events.jsonl").open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    _write_csv(out / "events.csv", EVENT_CSV_COLUMNS, (
        {**r, "payload_json": json.dumps(r["payload"], ensure_ascii=False)} for r in records
    ))

    counts = {"events": len(records)}
    counts["listening_sessions"] = _write_csv(out / "listening_sessions.csv", LISTENING_COLUMNS, _listening_rows(records))
    counts["intent_notes"] = _write_csv(out / "intent_notes.csv", INTENT_COLUMNS, _intent_rows(records))
    moment_rows, counts["moments"] = _export_moments(out, workspace_ids, pseudonym)

    hashes = {r["payload"].get("snapshot_hash") for r in records} | {m["snapshot_hash"] for m in moment_rows}
    hashes |= set(study_log_store.snapshot_hashes_for_workspaces(workspace_ids, since_ms, until_ms))
    counts["snapshots"] = _export_snapshots(out, {h for h in hashes if isinstance(h, str) and h})
    counts["audio"] = _export_audio(out, workspace_ids, copy_audio)
    return counts, {e["user_hash"] for e in events if e.get("user_hash")}
