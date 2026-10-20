"""Smoke test for the research-study logger (backend only, no Redis / no servers).

Runs the real SessionMiddleware + /api/study router in a FastAPI TestClient
with STUDY_LOGGING_ENABLED=1, a temp STUDY_DIR, a temp app.db and fakeredis.
Covers: event batches (JSON + sendBeacon text/plain, dedupe, size caps), snapshots
(store, dedupe, known, cap), moments (JPEG, non-image, note, 403), the audio
archive (copy, traversal refusal, free-space guard), server job events incl. the
R6 unwritable-DB case, the export script, and 404s with the flag off (R7).

Usage (from backend/, env compas-toy):
    python scripts/smoke_study_log.py
"""

import base64
import contextlib
import io
import json
import logging
import os
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="study_smoke_"))
os.environ.update({
    "STUDY_LOGGING_ENABLED": "1",
    "STUDY_DIR": str(TMP / "study"),
    "CF_ACCESS_TEAM_DOMAIN": "",
    "CF_ACCESS_AUD": "",
    "AUTH_DEV_BYPASS": "",
})
BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import fakeredis  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import config.constants as constants  # noqa: E402
from config.constants import JOB_TYPE_LLM, JOB_TYPE_PYROOMACOUSTICS, SESSION_COOKIE  # noqa: E402
from middleware.session import SessionMiddleware  # noqa: E402
from routers import study  # noqa: E402
from services import study_audio_archive  # noqa: E402
from services.io_jobs import start_io_job  # noqa: E402
from services.job_store import job_store  # noqa: E402
from services.metadata_store import metadata_store  # noqa: E402
from services.study_log_store import StudyLogStore, study_log_store  # noqa: E402

FAILURES: list[str] = []


def check(cond: bool, label: str) -> None:
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        FAILURES.append(label)


def events_of(event_type: str) -> list[dict]:
    return [e for e in study_log_store.list_events() if e["type"] == event_type]


def wait_for(fn, timeout_s: float = 5.0):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.05)
    return fn()


class FakeLlmBody(BaseModel):
    prompt: str
    screenshot: str


def build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(SessionMiddleware)
    app.include_router(study.router)

    @app.post("/test/enqueue")
    async def test_enqueue(request: Request):
        payload = {"geometry": list(range(500)), "image": "data:image/png;base64,AAAA"}
        job_id = await job_store.enqueue(JOB_TYPE_PYROOMACOUSTICS, request.state.session_id, payload)
        return {"job_id": job_id}

    @app.post("/test/io")
    async def test_io(body: FakeLlmBody, request: Request):
        async def _run(job_id: str) -> None:
            await job_store.complete(job_id, {"answer": 42, "echo": body.prompt})

        return {"job_id": await start_io_job(JOB_TYPE_LLM, request.state.session_id, _run)}

    return app


def ev(event_type: str, ts: int, payload: dict, model_id: str = "m1") -> dict:
    return {"id": uuid.uuid4().hex, "type": event_type, "ts_client": ts, "seq": ts % 1000,
            "tab_session_id": "tab1", "model_id": model_id, "version_id": "v1", "ui_mode": "advanced",
            "payload": payload}


def main() -> int:
    metadata_store._db_path = str(TMP / "app.db")
    metadata_store.init_db()
    job_store.redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    warnings = io.StringIO()
    handler = logging.StreamHandler(warnings)
    handler.setLevel(logging.WARNING)
    logging.getLogger("services.study_log_store").addHandler(handler)

    tok_a, tok_b = str(uuid.uuid4()), str(uuid.uuid4())
    hdr_a = {"Cookie": f"{SESSION_COOKIE}={tok_a}"}
    hdr_b = {"Cookie": f"{SESSION_COOKIE}={tok_b}"}
    ws_a = tok_a  # anonymous fallback: cookie value == workspace id
    wav_dir = BACKEND / "temp" / "static" / "sounds" / "generated" / f"smoke_{ws_a}"
    wav_dir.mkdir(parents=True, exist_ok=True)
    (wav_dir / "a.wav").write_bytes(b"RIFF" + b"\0" * 64)
    (wav_dir / "b.wav").write_bytes(b"RIFF" + b"\1" * 64)
    wav_url = f"http://localhost:8000/static/sounds/generated/smoke_{ws_a}/a.wav?t=1"
    jpeg_url = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0" + b"\0" * 32).decode()

    try:
        with TestClient(build_app()) as client:
            print("config / participants")
            cfg = client.get("/api/study/config", headers=hdr_a).json()
            check(cfg.get("enabled") is True and cfg.get("pseudonym") == "P01", f"config A → P01 ({cfg})")
            check(set(cfg["features"]) == {"snapshots", "state_diff", "pose_sampling", "audio_archive",
                                           "moment_screenshot"} and all(cfg["features"].values()), "features")
            check(client.get("/api/study/config", headers=hdr_b).json()["pseudonym"] == "P02", "config B → P02")
            check(client.get("/api/study/config", headers=hdr_a).json()["pseudonym"] == "P01", "A stays P01")

            print("events")
            batch = [
                ev("listen.start", 1000, {"session_id": "s1", "scope": "timeline", "position_ms": 0,
                                          "listener": {"kind": "receiver", "id": "r1", "position": [1, 2, 3],
                                                       "orientation": {"yaw": 10, "pitch": 0, "roll": 0}},
                                          "render_mode": "binaural", "active_simulation": {"index": 0, "engine": "pra"},
                                          "playing_source_ids": ["a", "b"], "snapshot_hash": "snapA",
                                          "audio_refs": [wav_url, "/static/../main.py",
                                                         "/static/../../backend/main.py", "/api/x.wav"]}),
                ev("listen.stop", 4000, {"session_id": "s1", "listened_ms": 3000, "end_position_ms": 3000,
                                         "reason": "pause"}),
                ev("listen.start", 9000, {"session_id": "s2", "scope": "preview", "snapshot_hash": "snapB",
                                          "listener": "garbage"}),
                ev("intent.note", 9500, {"kind": "version", "from_version_id": "v1", "to_version_id": "v2",
                                         "answer": "Moved the fountain", "prompted_by_listening": "yes",
                                         "tags": ["layout"], "snapshot_hash": "snapB",
                                         "img": "data:image/png;base64,QUJD"}),
                {"id": "bad", "type": "x"},  # malformed: no ts_client → dropped, not a 422
            ]
            r = client.post("/api/study/events", json={"events": batch}, headers=hdr_a)
            check(r.status_code == 200 and r.json() == {"accepted": 4}, f"batch accepted=4 ({r.status_code} {r.text})")
            r = client.post("/api/study/events", json={"events": batch}, headers=hdr_a)
            check(r.json() == {"accepted": 4} and len(study_log_store.list_events()) == 4, "replay deduped by id")
            note = events_of("intent.note")[0]
            check(note["user_hash"] and note["workspace_id"] == ws_a and note["source"] == "client",
                  "identity stamped from session")
            check("<omitted" in json.loads(note["payload"])["img"], "data: URL stripped from client payload")
            beacon = json.dumps({"events": [ev("session.end", 9900, {"reason": "pagehide"})]})
            r = client.post("/api/study/events", content=beacon,
                            headers={**hdr_a, "Content-Type": "text/plain;charset=UTF-8"})
            check(r.status_code == 200 and r.json() == {"accepted": 1}, "sendBeacon text/plain accepted")
            too_many = [ev("x", i, {}) for i in range(constants.STUDY_MAX_BATCH_EVENTS + 1)]
            check(client.post("/api/study/events", json={"events": too_many}, headers=hdr_a).status_code == 413,
                  "too many events → 413")
            huge = {"events": [ev("x", 1, {"blob": "x" * (constants.STUDY_MAX_BATCH_BYTES + 10)})]}
            check(client.post("/api/study/events", json=huge, headers=hdr_a).status_code == 413, "batch bytes → 413")

            print("audio archive")
            archived = Path(constants.STUDY_AUDIO_DIR) / ws_a / "static" / "sounds" / "generated" / f"smoke_{ws_a}" / "a.wav"
            check(archived.is_file(), "referenced wav archived")
            check(study_log_store.is_audio_archived(f"/static/sounds/generated/smoke_{ws_a}/a.wav"), "audio row")
            check(len(study_log_store.list_audio([ws_a])) == 1, "traversal / non-static refs refused")
            real_usage = study_audio_archive.shutil.disk_usage
            study_audio_archive.shutil.disk_usage = lambda p: real_usage(p)._replace(free=0)
            try:
                b_url = f"/static/sounds/generated/smoke_{ws_a}/b.wav"
                copied = study_audio_archive.archive_urls([b_url, b_url], ws_a, "e1")
                study_audio_archive.archive_urls([b_url], ws_a, "e2")
            finally:
                study_audio_archive.shutil.disk_usage = real_usage
            check(copied == 0 and not study_log_store.is_audio_archived(b_url), "free-space guard stops copy")
            check(len(events_of("archive.paused")) == 1, "archive.paused logged once")

            print("snapshots")
            snap = {"hash": "snapA", "json": json.dumps({"model_id": "m1", "version_id": "v1", "x": [1, 2]})}
            r1 = client.post("/api/study/snapshots", json=snap, headers=hdr_a).json()
            r2 = client.post("/api/study/snapshots", json=snap, headers=hdr_b).json()
            check(r1 == {"hash": "snapA", "stored": True} and r2["stored"] is False, "snapshot stored once")
            row = study_log_store.get_snapshots(["snapA"])[0]
            check(row["json"] == snap["json"] and row["model_id"] == "m1" and len(row["sha256"]) == 64,
                  "snapshot round-trip + sha256 + model_id")
            known = client.get("/api/study/snapshots/known?hashes=snapA,nope", headers=hdr_a).json()
            check(known == {"known": ["snapA"]}, f"known hashes ({known})")
            big = {"hash": "big", "json": "x" * (constants.STUDY_MAX_SNAPSHOT_BYTES + 1)}
            check(client.post("/api/study/snapshots", json=big, headers=hdr_a).status_code == 413, "snapshot cap → 413")
            check(client.post("/api/study/snapshots", json={"hash": "../x", "json": "{}"},
                              headers=hdr_a).status_code == 422, "unsafe snapshot hash → 422")

            print("moments")
            r = client.post("/api/study/moments", json={"event_id": "e9", "screenshot": jpeg_url,
                                                        "snapshot_hash": "snapA", "ts_client": 9600}, headers=hdr_a)
            moment_id = r.json().get("id")
            check(r.status_code == 200 and bool(moment_id), "moment created")
            check((Path(constants.STUDY_MOMENTS_DIR) / ws_a / f"{moment_id}.jpg").is_file(), "moment JPEG saved")
            bad = "data:image/jpeg;base64," + base64.b64encode(b"not an image").decode()
            check(client.post("/api/study/moments", json={"event_id": "e", "screenshot": bad, "snapshot_hash": None,
                                                          "ts_client": 1}, headers=hdr_a).status_code == 400,
                  "non-image screenshot → 400")
            note_body = {"note": "The echo made me move it", "tags": ["insight"]}
            check(client.post(f"/api/study/moments/{moment_id}/note", json=note_body, headers=hdr_b).status_code == 403,
                  "other participant → 403")
            check(client.post(f"/api/study/moments/{moment_id}/note", json=note_body, headers=hdr_a).json() == {"ok": True},
                  "creator annotates")
            check(client.post("/api/study/moments/nope/note", json=note_body, headers=hdr_a).status_code == 404,
                  "unknown moment → 404")

            print("server job events")
            r = client.post("/test/enqueue", headers=hdr_a)
            check(r.status_code == 200, "enqueue ok")
            enq = wait_for(lambda: events_of("job.enqueued"))
            payload = json.loads(enq[0]["payload"]) if enq else {}
            check(bool(enq) and enq[0]["user_hash"] == note["user_hash"], "job.enqueued with identity")
            check("<omitted" in payload.get("payload", {}).get("image", "")
                  and len(payload.get("payload", {}).get("geometry", [])) == constants.STUDY_MAX_LIST_ITEMS + 1,
                  "job payload sanitized + summarized")
            r = client.post("/test/io", json={"prompt": "hi", "screenshot": jpeg_url}, headers=hdr_a)
            done = wait_for(lambda: events_of("job.completed"))
            body = json.loads(done[0]["payload"]) if done else {}
            check(body.get("result", {}).get("answer") == 42, "job.completed with result")
            check(body.get("request", {}).get("body", {}).get("prompt") == "hi"
                  and "<omitted" in body["request"]["body"]["screenshot"], "LLM request body logged, image stripped")

            print("R6: unwritable study DB")
            blocker = TMP / "not_a_dir"
            blocker.write_text("x")
            study_log_store.close()
            good_path = study_log_store._db_path
            study_log_store._db_path = str(blocker / "study_log.db")
            try:
                r = client.post("/test/enqueue", headers=hdr_a)
                job_id = r.json().get("job_id")
                check(r.status_code == 200 and bool(job_id), "enqueue still succeeds")
                r = client.post("/test/io", json={"prompt": "x", "screenshot": ""}, headers=hdr_a)
                io_id = r.json().get("job_id")
                view = wait_for(lambda: _job_status(client, io_id) == "completed" or None)
                check(r.status_code == 200 and view, "IO job still completes")
                check(bool(wait_for(lambda: "not logged" in warnings.getvalue())), "warning logged")
            finally:
                study_log_store.close()
                study_log_store._db_path = good_path

            print("listening / export")
            client.post("/api/study/events", headers=hdr_a, json={"events": [
                ev("listen.start", 20000, {"session_id": "s3", "snapshot_hash": "snapC"})]})
            run_export(["--out", str(TMP / "export_auto")])
            groups_csv = TMP / "groups.csv"
            groups_csv.write_text(f"owner_email,group_label,workspace_id\nanon+{tok_a}@local,A,\n,B,{tok_b}\n")
            run_export(["--out", str(TMP / "export"), "--groups", str(groups_csv)])
            g = TMP / "export" / "G-A"
            for name in ("events.jsonl", "events.csv", "listening_sessions.csv", "intent_notes.csv", "moments.csv",
                         "audio_manifest.csv", f"moments/{moment_id}.jpg", "snapshots/snapA.json"):
                check((g / name).is_file(), f"export G-A/{name}")
            check(any((g / "audio").rglob("a.wav")), "export audio copied")
            check((TMP / "export" / "participants.csv").is_file() and (TMP / "export" / "participants_key.csv").is_file(),
                  "participants.csv + participants_key.csv")
            check((TMP / "export_auto" / "G1" / "events.jsonl").is_file(), "auto G1 folder")
            with (g / "listening_sessions.csv").open(encoding="utf-8") as f:
                import csv
                rows = list(csv.DictReader(f))
            s1 = next((r for r in rows if r["session_id"] == "s1"), {})
            check(s1.get("duration_ms") == "3000" and s1.get("listened_ms") == "3000"
                  and s1.get("listener_kind") == "receiver" and s1.get("after_snapshot_hash") == "snapB"
                  and s1.get("participant") == "P01", f"listening session paired ({s1})")
            leaked = [p.name for p in g.rglob("*") if p.is_file() and p.suffix in (".csv", ".jsonl")
                      and note["user_hash"] in p.read_text(encoding="utf-8")]
            check(not leaked, f"no user_hash in group files {leaked}")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                run_export(["--summary"])
            check("P01" in out.getvalue() and "free disk" in out.getvalue(), "--summary output")

            print("R7: master switch off")
            constants.STUDY_LOGGING_ENABLED = False
            try:
                n_before = len(study_log_store.list_events())
                codes = [
                    client.get("/api/study/config", headers=hdr_a).status_code,
                    client.post("/api/study/events", json={"events": []}, headers=hdr_a).status_code,
                    client.post("/api/study/snapshots", json=snap, headers=hdr_a).status_code,
                    client.get("/api/study/snapshots/known?hashes=a", headers=hdr_a).status_code,
                    client.post("/api/study/moments", json={}, headers=hdr_a).status_code,
                    client.post(f"/api/study/moments/{moment_id}/note", json=note_body, headers=hdr_a).status_code,
                ]
                check(codes == [404] * 6, f"all study routes 404 ({codes})")
                client.post("/test/enqueue", headers=hdr_a)
                time.sleep(0.3)
                check(len(study_log_store.list_events()) == n_before, "no server events when off")
                fresh = TMP / "off" / "study_log.db"
                StudyLogStore(str(fresh)).init_db()
                check(not fresh.parent.exists(), "init_db creates nothing when off")
            finally:
                constants.STUDY_LOGGING_ENABLED = True
    finally:
        study_log_store.close()
        metadata_store.close()
        shutil.rmtree(wav_dir, ignore_errors=True)
        shutil.rmtree(TMP, ignore_errors=True)

    print(f"\n{'PASS' if not FAILURES else 'FAILED'}: {len(FAILURES)} failure(s)")
    for f in FAILURES:
        print("  -", f)
    return 1 if FAILURES else 0


def _job_status(client: TestClient, job_id: str):
    async def get():
        return (await job_store.get(job_id)).status
    return client.portal.call(get) if getattr(client, "portal", None) else None


def run_export(argv: list[str]) -> None:
    from scripts import export_study_logs  # noqa: PLC0415 - imported after env setup
    old = sys.argv
    sys.argv = ["export_study_logs.py", *argv]
    try:
        export_study_logs.main()
    finally:
        sys.argv = old


if __name__ == "__main__":
    sys.exit(main())
