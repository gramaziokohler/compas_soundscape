"""
PFFDTD free positioning: IRs for a moved listener / source after a free-positioning run.

POST /api/pffdtd/free-ir
  {simulation_id, object_id, position} -> the nearest valid grid point's IRs (one WAV per fixed
  source in "listener" mode, per fixed listener in "source" mode), rendered by the resident
  compas-pffdtd IR server (services/pffdtd_ir_server.py) in ~50 ms (mono) / ~150 ms (FOA) per
  fixed object, or returned at once when cached. Fetch each WAV with
  GET /api/pffdtd/get-result-file/{simulation_id}/wav?ir_filename=<ir_file>.
  409 {code: "outside_grid"}: no valid grid point within PFFDTD_FREE_SNAP_RADIUS_M (re-run).
  409 {code: "superseded"}: a newer request for the same object arrived first (latest wins).
  404: not a free-positioning run, or its raw signals expired (temp janitor).
GET /api/pffdtd/free-grid/{simulation_id}/points
  float32 [n, 3] point positions, then uint8 [n] valid (1 = reached by sound).

A direct request (not a queued job): rendering one point is post-processing only.
"""
from __future__ import annotations

import itertools
import re
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from config.constants import AUDIO_SAMPLE_RATE, PFFDTD_FREE_SNAP_RADIUS_M, PFFDTD_RIR_DIR
from models.schemas import PffdtdFreeIRFile, PffdtdFreeIRRequest, PffdtdFreeIRResponse
from services.io_jobs import run_blocking
from services.pffdtd_free import free_dir, ir_filename, ir_metrics, load_meta, nearest_point, points_path
from services.pffdtd_ir_server import IrServerError, Superseded, ir_server

router = APIRouter(prefix="/api")

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")
_counter = itertools.count(1)
_latest: dict[tuple[str, str], int] = {}
_latest_lock = threading.Lock()


def _require_meta(simulation_id: str) -> dict:
    if not _SAFE_ID.match(simulation_id):
        raise HTTPException(status_code=400, detail="Invalid simulation id")
    meta = load_meta(simulation_id)
    if meta is None or "fixed_ids" not in meta:
        raise HTTPException(status_code=404, detail="No free-positioning data for this simulation (expired or not a free run); re-run it")
    return meta


def _claim(key: tuple[str, str]) -> int:
    with _latest_lock:
        token = next(_counter)
        _latest[key] = token
        return token


def _is_latest(key: tuple[str, str], token: int) -> bool:
    with _latest_lock:
        return _latest.get(key) == token


@router.post("/pffdtd/free-ir", response_model=PffdtdFreeIRResponse)
async def free_ir(body: PffdtdFreeIRRequest):
    meta = _require_meta(body.simulation_id)
    key = (body.simulation_id, body.object_id)
    token = _claim(key)
    try:
        point, snapped, distance = nearest_point(body.simulation_id, body.position)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=f"Free grid unavailable: {exc}")
    if distance > PFFDTD_FREE_SNAP_RADIUS_M:
        raise HTTPException(status_code=409, detail={
            "code": "outside_grid", "distance_m": distance, "snap_radius_m": PFFDTD_FREE_SNAP_RADIUS_M,
            "message": f"No simulated grid point within {PFFDTD_FREE_SNAP_RADIUS_M:g} m; re-run the simulation here.",
        })

    rir_dir = Path(PFFDTD_RIR_DIR)
    fixed_ids: list[str] = meta["fixed_ids"]
    names = [ir_filename(body.simulation_id, point, fid) for fid in fixed_ids]
    missing = [i for i, n in enumerate(names) if not (rir_dir / n).exists()]
    render_ms = 0.0
    if missing:
        try:
            render_ms = await run_blocking(
                ir_server.render, free_dir(body.simulation_id), point, missing,
                [rir_dir / names[i] for i in missing], lambda: _is_latest(key, token),
            )
        except Superseded:
            raise HTTPException(status_code=409, detail={"code": "superseded", "message": "A newer position was requested"})
        except IrServerError as exc:
            raise HTTPException(status_code=500, detail=f"IR rendering failed: {exc}")
    metrics = await run_blocking(lambda: [ir_metrics(rir_dir / n) for n in names])
    return PffdtdFreeIRResponse(
        point_index=point, snapped_position=snapped, distance_m=distance,
        num_channels=4 if meta["foa"] else 1, sample_rate=int(meta["post"]["out_fs"]) or AUDIO_SAMPLE_RATE,
        duration_s=float(meta["post"]["duration"]),
        irs=[PffdtdFreeIRFile(fixed_id=fid, ir_file=n, acoustic_parameters=m) for fid, n, m in zip(fixed_ids, names, metrics)],
        render_ms=render_ms,
    )


@router.get("/pffdtd/free-grid/{simulation_id}/points")
async def free_grid_points(simulation_id: str):
    _require_meta(simulation_id)
    path = points_path(simulation_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Free grid not found (expired); re-run the simulation")
    return FileResponse(path=str(path), media_type="application/octet-stream")
