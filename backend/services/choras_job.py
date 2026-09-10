"""
Choras (DE/DG) subprocess worker.

Runs as a subprocess via multiprocessing.Process (workers/choras_runner.py),
mirroring the pyroomacoustics_worker.py / sed_worker.py / loop_worker.py
pattern: Speckle fetch, geometry write, and the DE/DG solve all happen here
(previously the solve ran in a daemon thread inside the API process — see
routers/choras.py history — which meant a solver crash could take the API
down). Progress is reported via atomic JSON file writes; result/error is
written to result_file on exit. Cancellation is a hard kill of this process
(no cooperative should_stop) — matches workers/cpu_runner.py.

Progress file: {"value": 0-100, "status": "<human text>"}
Result file:   {"type": "done",  "result": {...}}
            or {"type": "error", "message": "<str>"}
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import sys
import time
import traceback
from collections import defaultdict
from pathlib import Path
from typing import Optional

from services.choras_service import ChorasService
from services.speckle_service import SpeckleService
from utils.speckle_geometry_mapper import (
    build_choras_temp_dir,
    build_material_absorption_dict,
    build_de_json_input,
    build_dg_json_input,
    write_geo_from_mesh,
)

logger = logging.getLogger(__name__)


def _write_progress(progress_file: str, value: int, status: str) -> None:
    tmp = progress_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"value": value, "status": status}, f)
    for attempt in range(10):
        try:
            os.replace(tmp, progress_file)
            break
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.02)


def _write_result(result_file: str, payload: dict) -> None:
    tmp = result_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, result_file)


# ─── Stdout progress capture ──────────────────────────────────────────────────
# Same regexes as the old routers/choras.py _ProgressCapture. No thread-id check
# is needed here — each simulation now owns its whole OS process.

_RE_GMSH_POINTS   = re.compile(r'Info\s*:\s*([\d\s,]+) points,\s*([\d\s,]+) elements')
_RE_GMSH_MESH3D   = re.compile(r'Info\s*:\s*Done meshing 3D')
_RE_GMSH_OPTIM    = re.compile(r'Info\s*:\s*Optimizing mesh')
_RE_GMSH_DONE_OPT = re.compile(r'Info\s*:\s*Done optimizing mesh')
_RE_DE_PROGRESS   = re.compile(r'(\d+)%\s+of\s+main\s+calculation\s+completed')
_RE_DG_STEP       = re.compile(r'Current/Total step\s+(\d+)/(\d+)')
_RE_DG_TIMELEFT   = re.compile(r'Estimated time left:\s*(.+)')
_RE_DG_PERCENT    = re.compile(r'Percentage done:\s*(\d+(?:\.\d+)?)\s*%')


class _ProgressStdoutCapture:
    """Wraps sys.stdout, parses solver/mesher output lines (gmsh, acousticDE
    FVM, edg_acoustics DG) and forwards progress to progress_file. All writes
    still pass through to the real stdout unchanged."""

    def __init__(self, real_stdout, progress_file: str):
        self._real = real_stdout
        self._progress_file = progress_file
        self._buf = ""
        self.pair_base: int = 5
        self.pair_top: int = 5

    def write(self, s: str):
        self._real.write(s)
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            if line.strip():
                self._parse(line)

    def flush(self):
        self._real.flush()

    def __getattr__(self, name):
        return getattr(self._real, name)

    def _frac(self, f: float) -> int:
        span = max(1, self.pair_top - self.pair_base)
        return self.pair_base + int(span * f)

    def _parse(self, line: str):
        m = _RE_GMSH_POINTS.search(line)
        if m:
            _write_progress(self._progress_file, self._frac(0.15), f"Meshing: {m.group(1).strip()} pts, {m.group(2).strip()} elements...")
            return
        if _RE_GMSH_MESH3D.search(line):
            _write_progress(self._progress_file, self._frac(0.25), "Done meshing 3D")
            return
        if _RE_GMSH_OPTIM.search(line):
            _write_progress(self._progress_file, self._frac(0.28), "Optimizing mesh...")
            return
        if _RE_GMSH_DONE_OPT.search(line):
            _write_progress(self._progress_file, self._frac(0.30), "Mesh ready, starting solver...")
            return
        m = _RE_DE_PROGRESS.search(line)
        if m:
            pct = int(m.group(1))
            _write_progress(self._progress_file, self._frac(0.30 + 0.70 * pct / 100), f"Solving DE ({pct}%)...")
            return
        m = _RE_DG_STEP.search(line)
        if m:
            cur, tot = int(m.group(1)), int(m.group(2))
            frac = cur / tot if tot > 0 else 0
            _write_progress(self._progress_file, self._frac(0.25 + 0.75 * frac), f"Solving DG (step {cur}/{tot})...")
            return
        m = _RE_DG_TIMELEFT.search(line)
        if m:
            _write_progress(self._progress_file, self.pair_base, f"Solving DG... {m.group(1).strip()} left")
            return
        m = _RE_DG_PERCENT.search(line)
        if m:
            pct = float(m.group(1))
            if pct > 0:
                _write_progress(self._progress_file, self._frac(0.25 + 0.75 * pct / 100), f"DG solver {int(pct)}% done")
            return


def run_choras_simulation(
    simulation_id: str,
    progress_file: str,
    result_file: str,
    speckle_project_id: str,
    speckle_version_id: str,
    layer_name: str,
    object_ids_filter: Optional[list],
    object_materials_dict: dict,
    simulation_method: str,
    de_settings: dict,
    dg_settings: dict,
    frequencies: list,
    source_receiver_pairs: list,
    simulation_name: str,
    temp_dir: str,
) -> None:
    """Full Choras DE/DG pipeline, runs in a subprocess.

    Fetches Speckle geometry, writes the shared .geo file, then runs the DE
    or DG solve per source/pair. Progress is reported via atomic JSON file
    writes; result/error is written to result_file on exit.
    """
    method = simulation_method.upper()
    ir_files: list[str] = []
    results_data: list[dict] = []

    orig_stdout = sys.stdout
    capture = _ProgressStdoutCapture(orig_stdout, progress_file)
    sys.stdout = capture

    try:
        _write_progress(progress_file, 2, "Authenticating with Speckle...")
        speckle_service = SpeckleService()
        if not speckle_service.authenticate():
            raise RuntimeError("Failed to authenticate with Speckle")

        _write_progress(progress_file, 5, "Fetching Speckle geometry...")
        geometry_data = speckle_service.get_model_geometry(
            project_id=speckle_project_id,
            version_id_or_object_id=speckle_version_id,
            layer_name=layer_name,
            object_ids_filter=object_ids_filter,
        )
        if not geometry_data:
            raise RuntimeError("Failed to retrieve geometry from Speckle")

        vertices: list = geometry_data["vertices"]
        faces: list = geometry_data["faces"]
        object_ids: list = geometry_data["object_ids"]
        object_face_ranges: dict = geometry_data["object_face_ranges"]
        if not vertices or not faces:
            raise RuntimeError("No geometry found in Speckle layer")

        sim_dir = build_choras_temp_dir(simulation_id)
        geo_path = sim_dir / "room.geo"
        write_geo_from_mesh(
            vertices=vertices,
            faces=faces,
            object_ids=object_ids,
            object_face_ranges=object_face_ranges,
            geo_file_path=str(geo_path),
        )

        absorption_coefficients = build_material_absorption_dict(
            object_ids=object_ids,
            object_material_names=object_materials_dict,
            frequencies=frequencies,
        )

        pairs_data = source_receiver_pairs

        if method == "DE":
            total = len(pairs_data)
            for i, pair_dict in enumerate(pairs_data):
                pair_base = 5 + int((i / total) * 85)
                pair_top = 5 + int(((i + 1) / total) * 85)
                capture.pair_base = pair_base
                capture.pair_top = pair_top
                _write_progress(progress_file, pair_base, f"Running DE ({i + 1}/{total})...")

                src_id = pair_dict["source_id"]
                rcv_id = pair_dict["receiver_id"]
                pair_key = f"{simulation_id}_src_{src_id}_rcv_{rcv_id}"

                pair_dir = sim_dir / f"pair_{src_id}_{rcv_id}"
                pair_dir.mkdir(exist_ok=True)
                shutil.copy(str(geo_path), str(pair_dir / "room.geo"))

                json_path = build_de_json_input(
                    sim_dir=pair_dir,
                    source_pos=pair_dict["source_position"],
                    receiver_pos=pair_dict["receiver_position"],
                    absorption_coefficients=absorption_coefficients,
                    settings=de_settings,
                )

                try:
                    ChorasService.run_de_simulation(pair_dir, json_path)
                except RuntimeError as sim_err:
                    logger.error(f"[DE] Pair {pair_key} failed: {sim_err}")
                    results_data.append({
                        "source_id": src_id, "receiver_id": rcv_id,
                        "source_position": pair_dict["source_position"],
                        "receiver_position": pair_dict["receiver_position"],
                        "ir_file": None, "method": "DE", "error": str(sim_err),
                    })
                    _write_progress(progress_file, pair_top, f"DE ({i + 1}/{total}) failed")
                    continue

                wav_path = ChorasService.de_results_to_wav(json_path, pair_dir, pair_key)
                if wav_path:
                    ir_files.append(wav_path.name)

                acoustic_params = ChorasService.extract_wav_acoustic_parameters(wav_path) if wav_path else {}
                de_spl = ChorasService.extract_de_spl(json_path)
                if de_spl is not None:
                    acoustic_params["spl"] = de_spl
                results_data.append({
                    "source_id": src_id, "receiver_id": rcv_id,
                    "source_position": pair_dict["source_position"],
                    "receiver_position": pair_dict["receiver_position"],
                    "ir_file": wav_path.name if wav_path else None,
                    "method": "DE", "acoustic_parameters": acoustic_params,
                })
                _write_progress(progress_file, pair_top, f"DE ({i + 1}/{total}) done")

        else:  # DG
            source_groups: dict[str, list[dict]] = defaultdict(list)
            source_positions: dict[str, list[float]] = {}
            for pair_dict in pairs_data:
                sid = pair_dict["source_id"]
                source_groups[sid].append(pair_dict)
                source_positions[sid] = pair_dict["source_position"]

            total = len(source_groups)
            for j, (src_id, source_pairs) in enumerate(source_groups.items()):
                pair_base = 5 + int((j / total) * 85)
                pair_top = 5 + int(((j + 1) / total) * 85)
                capture.pair_base = pair_base
                capture.pair_top = pair_top
                _write_progress(progress_file, pair_base, f"Running DG ({j + 1}/{total})...")

                source_dir = sim_dir / f"src_{src_id}"
                source_dir.mkdir(exist_ok=True)
                shutil.copy(str(geo_path), str(source_dir / "room.geo"))

                receiver_positions = [p["receiver_position"] for p in source_pairs]
                json_path = build_dg_json_input(
                    sim_dir=source_dir,
                    source_pos=source_positions[src_id],
                    receiver_positions=receiver_positions,
                    absorption_coefficients=absorption_coefficients,
                    settings=dg_settings,
                )

                try:
                    ChorasService.run_dg_simulation(source_dir, json_path)
                except RuntimeError as sim_err:
                    logger.error(f"[DG] Source {src_id} failed: {sim_err}")
                    for pair_dict in source_pairs:
                        results_data.append({
                            "source_id": src_id, "receiver_id": pair_dict["receiver_id"],
                            "source_position": pair_dict["source_position"],
                            "receiver_position": pair_dict["receiver_position"],
                            "ir_file": None, "method": "DG", "error": str(sim_err),
                        })
                    _write_progress(progress_file, pair_top, f"DG ({j + 1}/{total}) failed")
                    continue

                for rec_idx, pair_dict in enumerate(source_pairs):
                    rcv_id = pair_dict["receiver_id"]
                    pair_key = f"{simulation_id}_src_{src_id}_rcv_{rcv_id}"
                    wav_path = ChorasService.dg_results_to_wav(json_path, rec_idx, pair_key)
                    if wav_path:
                        ir_files.append(wav_path.name)
                    acoustic_params = ChorasService.extract_wav_acoustic_parameters(wav_path) if wav_path else {}
                    dg_spl = ChorasService.extract_dg_spl(json_path, rec_idx)
                    if dg_spl is not None:
                        acoustic_params["spl"] = dg_spl
                    results_data.append({
                        "source_id": src_id, "receiver_id": rcv_id,
                        "source_position": pair_dict["source_position"],
                        "receiver_position": pair_dict["receiver_position"],
                        "ir_file": wav_path.name if wav_path else None,
                        "method": "DG", "receiver_index": rec_idx,
                        "acoustic_parameters": acoustic_params,
                    })
                _write_progress(progress_file, pair_top, f"DG ({j + 1}/{total}) done")

        if not ir_files:
            failed = [r for r in results_data if r.get("error")]
            if failed:
                unique_errors = list(dict.fromkeys(
                    r["error"].replace("DE simulation failed: ", "").replace("DG simulation failed: ", "")
                    for r in failed
                ))
                _write_result(result_file, {"type": "error", "message": " | ".join(unique_errors[:3])})
                return

        _write_progress(progress_file, 98, "Saving results...")
        results_filename = f"choras_{simulation_id}_results.json"
        results_json = {
            "simulation_id": simulation_id,
            "simulation_name": simulation_name,
            "method": method,
            "results": results_data,
        }
        with open(Path(temp_dir) / results_filename, "w") as f:
            json.dump(results_json, f, indent=2)

        message = f"Choras {method} simulation completed successfully ({len(ir_files)} IR file(s) generated)"
        _write_result(result_file, {
            "type": "done",
            "result": {
                "simulation_id": simulation_id,
                "message": message,
                "ir_files": ir_files,
                "results_file": results_filename,
                "method": method,
            },
        })

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[choras_job] Error [{simulation_id}]: {exc}\n{tb}", file=sys.stderr)
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
    finally:
        sys.stdout = orig_stdout
