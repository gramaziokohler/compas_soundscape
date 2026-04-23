"""
Choras (DE/DG) acoustic simulation endpoints

Provides local DE (Diffusion Equation / FVM) and DG (Discontinuous Galerkin)
wave simulations driven by Speckle model geometry and frontend material
assignments, following the same patterns as ``routers/pyroomacoustics.py``.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import sys
import threading
import traceback
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Form
from fastapi.responses import FileResponse

from services.choras_service import ChorasService
from services.speckle_service import SpeckleService
from services.task_queue import unified_queue, UnifiedTask
from utils.speckle_geometry_mapper import (
    build_choras_temp_dir,
    build_material_absorption_dict,
    build_de_json_input,
    build_dg_json_input,
    write_geo_from_mesh,
)
from models.schemas import (
    ChorasSimulationResult,
    ChorasSimulationStartResponse,
    ChorasSimulationStatusResponse,
)
from config.constants import (
    CHORAS_RIR_DIR,
    CHORAS_TEMP_DIR,
    CHORAS_DE_DEFAULT_C0,
    CHORAS_DE_DEFAULT_IR_LENGTH,
    CHORAS_DE_DEFAULT_LC,
    CHORAS_DE_DEFAULT_EDT,
    CHORAS_DE_DEFAULT_SIM_LEN_TYPE,
    CHORAS_DG_DEFAULT_C0,
    CHORAS_DG_DEFAULT_RHO0,
    CHORAS_DG_DEFAULT_IR_LENGTH,
    CHORAS_DG_DEFAULT_FREQ_UPPER,
    CHORAS_DG_DEFAULT_POLY_ORDER,
    CHORAS_DG_DEFAULT_PPW,
    CHORAS_DG_DEFAULT_CFL,
    CHORAS_DEFAULT_FREQUENCIES,
    TEMP_SIMULATIONS_DIR,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Ensure output directories exist at import time
Path(CHORAS_RIR_DIR).mkdir(parents=True, exist_ok=True)
Path(CHORAS_TEMP_DIR).mkdir(parents=True, exist_ok=True)
Path(TEMP_SIMULATIONS_DIR).mkdir(parents=True, exist_ok=True)

TEMP_DIR = Path(TEMP_SIMULATIONS_DIR)
RIR_OUTPUT_DIR = Path(CHORAS_RIR_DIR)


class _CancelledError(BaseException):
    """Raised by _ProgressCapture when cancel_event is set.

    Derives from BaseException (not Exception) so it bypasses
    ``except Exception`` handlers inside the solver and service layers
    and propagates cleanly to our top-level handler.
    """


# ─── Stdout progress capture ──────────────────────────────────────────────────

# Compiled patterns for solver/mesher output lines
_RE_GMSH_POINTS   = re.compile(r'Info\s*:\s*([\d\s,]+) points,\s*([\d\s,]+) elements')
_RE_GMSH_MESH3D   = re.compile(r'Info\s*:\s*Done meshing 3D')
_RE_GMSH_OPTIM    = re.compile(r'Info\s*:\s*Optimizing mesh')
_RE_GMSH_DONE_OPT = re.compile(r'Info\s*:\s*Done optimizing mesh')
_RE_DE_PROGRESS   = re.compile(r'(\d+)%\s+of\s+main\s+calculation\s+completed')
_RE_DG_STEP       = re.compile(r'Current/Total step\s+(\d+)/(\d+)')
_RE_DG_TIMELEFT   = re.compile(r'Estimated time left:\s*(.+)')
_RE_DG_PERCENT    = re.compile(r'Percentage done:\s*(\d+(?:\.\d+)?)\s*%')


class _ProgressCapture:
    """
    Thread-aware ``sys.stdout`` wrapper.

    All writes pass through to the real stdout unchanged.  Writes that
    originate from the registered simulation thread are also line-buffered
    and parsed for progress/status patterns so ``task.progress`` and
    ``task.status`` update in real time.

    ``pair_base`` / ``pair_top`` define the progress range (0-100) allocated
    to the current pair/source.  Update them before each simulation step.
    """

    def __init__(self, real_stdout, thread_id: int, task: "UnifiedTask"):
        self._real = real_stdout
        self._tid  = thread_id
        self._task = task
        self._buf  = ""
        # Mutable context updated by the thread before each pair/source
        self.pair_base: int = 5
        self.pair_top:  int = 5

    # ── stdout protocol ───────────────────────────────────────────────────────

    def write(self, s: str):
        self._real.write(s)
        if threading.get_ident() != self._tid:
            return
        # Interrupt the solver mid-run when the user presses Stop.
        # Fires on every print() call (~every 10 DG steps, every DE % tick).
        if self._task.cancel_event.is_set():
            raise _CancelledError("Simulation cancelled by user")
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            if line.strip():
                self._parse(line)

    def flush(self):
        self._real.flush()

    def __getattr__(self, name):
        return getattr(self._real, name)

    # ── Line parser ───────────────────────────────────────────────────────────

    def _frac(self, f: float) -> int:
        """Map a 0.0-1.0 fraction to an absolute progress value."""
        span = max(1, self.pair_top - self.pair_base)
        return self.pair_base + int(span * f)

    def _parse(self, line: str):
        task = self._task

        # gmsh — "Info    : 57927 points, 327332 elements"
        m = _RE_GMSH_POINTS.search(line)
        if m:
            pts   = m.group(1).strip()
            elems = m.group(2).strip()
            task.status   = f"Meshing: {pts} pts, {elems} elements..."
            task.progress = self._frac(0.15)
            return

        # gmsh — "Info    : Done meshing 3D (Wall Xs, CPU Ys)"
        if _RE_GMSH_MESH3D.search(line):
            task.status   = "Done meshing 3D"
            task.progress = self._frac(0.25)
            return

        # gmsh — "Info    : Optimizing mesh..."
        if _RE_GMSH_OPTIM.search(line):
            task.status   = "Optimizing mesh..."
            task.progress = self._frac(0.28)
            return

        # gmsh — "Info    : Done optimizing mesh"
        if _RE_GMSH_DONE_OPT.search(line):
            task.status   = "Mesh ready, starting solver..."
            task.progress = self._frac(0.30)
            return

        # DE FVM — "40% of main calculation completed"
        m = _RE_DE_PROGRESS.search(line)
        if m:
            pct = int(m.group(1))
            task.status   = f"Solving DE ({pct}%)..."
            # Solver occupies 30-100 % of pair span (mesh took 0-30 %)
            task.progress = self._frac(0.30 + 0.70 * pct / 100)
            return

        # DG — "Current/Total step 811/651533"
        m = _RE_DG_STEP.search(line)
        if m:
            cur, tot = int(m.group(1)), int(m.group(2))
            frac = cur / tot if tot > 0 else 0
            task.progress = self._frac(0.25 + 0.75 * frac)
            return

        # DG — "Estimated time left: 138 minutes 14 seconds"
        m = _RE_DG_TIMELEFT.search(line)
        if m:
            task.status = f"Solving DG... {m.group(1).strip()} left"
            return

        # DG — "Percentage done: 40 %"
        m = _RE_DG_PERCENT.search(line)
        if m:
            pct = float(m.group(1))
            if pct > 0:
                task.progress = self._frac(0.25 + 0.75 * pct / 100)
                task.status   = f"DG solver {int(pct)}% done"
            return


def _run_simulation_in_thread(
    simulation_id: str,
    task: UnifiedTask,
    method: str,
    sim_dir: Path,
    geo_path: Path,
    pairs_data: list[dict],
    absorption_coefficients: dict,
    frequencies: list[int],
    de_settings: dict,
    dg_settings: dict,
    simulation_name: str,
) -> None:
    """
    Run the Choras DE or DG simulation in a daemon thread.

    Installs a thread-local stdout capture that parses solver/mesher output
    (gmsh, acousticDE FVM, edg_acoustics DG) and forwards progress to
    ``task.progress`` / ``task.status`` in real time.

    Checks ``task.cancel_event`` between every expensive pair/source step.
    Surfaces per-pair errors to the frontend if all pairs fail.
    """
    ir_files: list[str] = []
    results_data: list[dict] = []

    # Install thread-local stdout capture (restores on any exit path)
    capture = _ProgressCapture(sys.stdout, threading.get_ident(), task)
    _orig_stdout = sys.stdout
    sys.stdout = capture

    try:
        if method == "DE":
            total = len(pairs_data)

            for i, pair_dict in enumerate(pairs_data):
                if task.cancel_event.is_set():
                    task.cancelled = True
                    task.status = "Cancelled"
                    task.completed = True
                    return

                # Set capture range for this pair so sub-step messages map correctly
                pair_base = 5 + int((i / total) * 85)
                pair_top  = 5 + int(((i + 1) / total) * 85)
                capture.pair_base = pair_base
                capture.pair_top  = pair_top
                task.progress = pair_base
                task.status   = f"Running DE ({i + 1}/{total})..."

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
                        "source_id": src_id,
                        "receiver_id": rcv_id,
                        "source_position": pair_dict["source_position"],
                        "receiver_position": pair_dict["receiver_position"],
                        "ir_file": None,
                        "method": "DE",
                        "error": str(sim_err),
                    })
                    task.progress = pair_top
                    task.status   = f"DE ({i + 1}/{total}) failed"
                    continue

                wav_path = ChorasService.de_results_to_wav(json_path, pair_dir, pair_key)
                if wav_path:
                    ir_files.append(wav_path.name)

                acoustic_params = ChorasService.extract_wav_acoustic_parameters(wav_path) if wav_path else {}
                de_spl = ChorasService.extract_de_spl(json_path)
                if de_spl is not None:
                    acoustic_params["spl"] = de_spl
                results_data.append({
                    "source_id": src_id,
                    "receiver_id": rcv_id,
                    "source_position": pair_dict["source_position"],
                    "receiver_position": pair_dict["receiver_position"],
                    "ir_file": wav_path.name if wav_path else None,
                    "method": "DE",
                    "acoustic_parameters": acoustic_params,
                })
                task.progress = pair_top

        else:  # DG
            source_groups: dict[str, list[dict]] = defaultdict(list)
            source_positions: dict[str, list[float]] = {}
            for pair_dict in pairs_data:
                sid = pair_dict["source_id"]
                source_groups[sid].append(pair_dict)
                source_positions[sid] = pair_dict["source_position"]

            total = len(source_groups)

            for j, (src_id, source_pairs) in enumerate(source_groups.items()):
                if task.cancel_event.is_set():
                    task.cancelled = True
                    task.status = "Cancelled"
                    task.completed = True
                    return

                pair_base = 5 + int((j / total) * 85)
                pair_top  = 5 + int(((j + 1) / total) * 85)
                capture.pair_base = pair_base
                capture.pair_top  = pair_top
                task.progress = pair_base
                task.status   = f"Running DG ({j + 1}/{total})..."

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
                            "source_id": src_id,
                            "receiver_id": pair_dict["receiver_id"],
                            "source_position": pair_dict["source_position"],
                            "receiver_position": pair_dict["receiver_position"],
                            "ir_file": None,
                            "method": "DG",
                            "error": str(sim_err),
                        })
                    task.progress = pair_top
                    task.status   = f"DG ({j + 1}/{total}) failed"
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
                        "source_id": src_id,
                        "receiver_id": rcv_id,
                        "source_position": pair_dict["source_position"],
                        "receiver_position": pair_dict["receiver_position"],
                        "ir_file": wav_path.name if wav_path else None,
                        "method": "DG",
                        "receiver_index": rec_idx,
                        "acoustic_parameters": acoustic_params,
                    })
                task.progress = pair_top

        # ── Error check: surface errors if no IRs were produced ───────────────
        if not ir_files:
            failed = [r for r in results_data if r.get("error")]
            if failed:
                # Collect unique error messages (strip the wrapper prefix added by RuntimeError)
                unique_errors = list(dict.fromkeys(
                    r["error"].replace("DE simulation failed: ", "")
                              .replace("DG simulation failed: ", "")
                    for r in failed
                ))
                task.error = " | ".join(unique_errors[:3])
                task.status = "Error"
                task.completed = True
                return

        # ── Save results JSON ──────────────────────────────────────────────────
        task.progress = 98
        task.status = "Saving results..."

        results_filename = f"choras_{simulation_id}_results.json"
        results_path = TEMP_DIR / results_filename
        results_json = {
            "simulation_id":   simulation_id,
            "simulation_name": simulation_name,
            "method":          method,
            "results":         results_data,
        }
        with open(results_path, "w") as f:
            json.dump(results_json, f, indent=2)

        message = (
            f"Choras {method} simulation completed successfully "
            f"({len(ir_files)} IR file(s) generated)"
        )
        task.result = ChorasSimulationResult(
            simulation_id=simulation_id,
            message=message,
            ir_files=ir_files,
            results_file=results_filename,
            method=method,
        ).model_dump()
        task.progress = 100
        task.status = "Complete!"
        task.completed = True

    except _CancelledError:
        # User pressed Stop: cancel_event was set, _ProgressCapture raised this.
        task.cancelled = True
        task.status = "Cancelled"
        task.completed = True

    except Exception as exc:
        logger.error(f"[Choras] Thread error for {simulation_id}: {exc}\n{traceback.format_exc()}")
        task.error = str(exc)
        task.status = "Error"
        task.completed = True

    finally:
        sys.stdout = _orig_stdout


# ─── Materials ────────────────────────────────────────────────────────────────

@router.get("/choras/materials")
async def get_choras_materials():
    """Return available absorption materials for Choras (DE/DG) simulations."""
    try:
        return ChorasService.get_material_database()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load materials: {exc}")


# ─── Result file serving ──────────────────────────────────────────────────────

@router.get("/choras/get-result-file/{simulation_id}/{file_type}")
async def get_result_file(
    simulation_id: str,
    file_type: str,
    ir_filename: Optional[str] = None,
):
    """
    Retrieve a Choras simulation result file.

    Args:
        simulation_id: The simulation UUID.
        file_type: ``'wav'`` or ``'json'``.
        ir_filename: Specific WAV filename (for wav type only).  Must start with
            ``choras_{simulation_id}`` to prevent path traversal.
    """
    if file_type not in ("wav", "json"):
        raise HTTPException(status_code=400, detail="file_type must be 'wav' or 'json'")

    if file_type == "json":
        filename = f"choras_{simulation_id}_results.json"
        file_path = TEMP_DIR / filename
        media_type = "application/json"
    else:
        if ir_filename:
            # Security: ensure the filename belongs to this simulation
            expected_prefix = f"choras_{simulation_id}_"
            if not ir_filename.startswith(expected_prefix) and not ir_filename.startswith("choras_"):
                raise HTTPException(status_code=400, detail="Invalid IR filename for this simulation")
            file_path = RIR_OUTPUT_DIR / ir_filename
            filename = ir_filename
        else:
            wav_files = list(RIR_OUTPUT_DIR.glob(f"choras_{simulation_id}_*.wav"))
            if not wav_files:
                raise HTTPException(status_code=404, detail=f"No WAV files for simulation {simulation_id}")
            file_path = wav_files[0]
            filename = file_path.name
        media_type = "audio/wav"

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    return FileResponse(path=str(file_path), media_type=media_type, filename=filename)


# ─── Main simulation endpoint (non-blocking) ─────────────────────────────────

@router.post("/choras/run-simulation-speckle", response_model=ChorasSimulationStartResponse)
async def run_choras_simulation_speckle(
    simulation_name: str = Form(...),
    speckle_project_id: str = Form(...),
    speckle_version_id: str = Form(...),
    object_materials: str = Form(...),            # JSON: {"objectId": "materialId"}
    layer_name: str = Form("Acoustics"),
    geometry_object_ids: Optional[str] = Form(None),  # JSON: ["id1", ...]
    simulation_method: str = Form("DE"),          # "DE" or "DG"
    # ── DE settings ──────────────────────────────────────────────────────────
    de_sim_len_type: str = Form(CHORAS_DE_DEFAULT_SIM_LEN_TYPE),
    de_edt: float = Form(CHORAS_DE_DEFAULT_EDT),
    de_ir_length: float = Form(CHORAS_DE_DEFAULT_IR_LENGTH),
    de_c0: float = Form(CHORAS_DE_DEFAULT_C0),
    de_lc: float = Form(CHORAS_DE_DEFAULT_LC),
    # ── DG settings ──────────────────────────────────────────────────────────
    dg_freq_upper_limit: float = Form(CHORAS_DG_DEFAULT_FREQ_UPPER),
    dg_c0: float = Form(CHORAS_DG_DEFAULT_C0),
    dg_rho0: float = Form(CHORAS_DG_DEFAULT_RHO0),
    dg_ir_length: float = Form(CHORAS_DG_DEFAULT_IR_LENGTH),
    dg_poly_order: int = Form(CHORAS_DG_DEFAULT_POLY_ORDER),
    dg_ppw: float = Form(CHORAS_DG_DEFAULT_PPW),
    dg_cfl: float = Form(CHORAS_DG_DEFAULT_CFL),
    # ── Source-receiver pairs ─────────────────────────────────────────────────
    source_receiver_pairs: str = Form(...),        # JSON string
):
    """
    Start a Choras (DE or DG) acoustic simulation from a Speckle model.

    Returns immediately with a ``simulation_id``.  Poll
    ``GET /choras/simulation-status/{simulation_id}`` for progress updates.

    Workflow (synchronous setup, async execution):
    1. Parse inputs and authenticate with Speckle (fast — fails loudly).
    2. Fetch mesh geometry and write the shared .geo file.
    3. Queue the DE/DG loop in a daemon thread and return ``simulation_id``.
    4. The thread updates a shared progress dict after each pair/source step.
    """
    simulation_id = str(uuid.uuid4())
    method = simulation_method.upper()

    if method not in ("DE", "DG"):
        raise HTTPException(status_code=400, detail="simulation_method must be 'DE' or 'DG'")

    try:
        # ── Parse JSON inputs ────────────────────────────────────────────────
        pairs_data: list[dict] = json.loads(source_receiver_pairs)
        object_materials_dict: dict[str, str] = json.loads(object_materials)
        object_ids_filter: Optional[list[str]] = (
            json.loads(geometry_object_ids) if geometry_object_ids else None
        )

        if not pairs_data:
            raise HTTPException(status_code=400, detail="source_receiver_pairs is empty")

        # ── Fetch Speckle geometry (synchronous — fail fast on error) ────────
        speckle_service = SpeckleService()
        if not speckle_service.authenticate():
            raise HTTPException(status_code=500, detail="Failed to authenticate with Speckle")

        geometry_data = speckle_service.get_model_geometry(
            project_id=speckle_project_id,
            version_id_or_object_id=speckle_version_id,
            layer_name=layer_name,
            object_ids_filter=object_ids_filter,
        )
        if not geometry_data:
            raise HTTPException(status_code=500, detail="Failed to retrieve geometry from Speckle")

        vertices: list[list[float]]  = geometry_data["vertices"]
        faces: list[list[int]]       = geometry_data["faces"]
        object_ids: list[str]        = geometry_data["object_ids"]
        object_face_ranges: dict     = geometry_data["object_face_ranges"]

        if not vertices or not faces:
            raise HTTPException(status_code=400, detail="No geometry found in Speckle layer")

        # ── Create simulation working directory ──────────────────────────────
        sim_dir = build_choras_temp_dir(simulation_id)

        # ── Write shared GEO file (synchronous — fail fast on error) ────────
        geo_path = sim_dir / "room.geo"
        try:
            write_geo_from_mesh(
                vertices=vertices,
                faces=faces,
                object_ids=object_ids,
                object_face_ranges=object_face_ranges,
                geo_file_path=str(geo_path),
            )
        except Exception as geo_exc:
            logger.error(f"GEO generation failed: {geo_exc}")
            raise HTTPException(status_code=500, detail=f"Failed to generate GEO file: {geo_exc}")

        # ── Build absorption coefficient dict ────────────────────────────────
        frequencies = CHORAS_DEFAULT_FREQUENCIES
        absorption_coefficients = build_material_absorption_dict(
            object_ids=object_ids,
            object_material_names=object_materials_dict,
            frequencies=frequencies,
        )

        # ── Build method settings dicts ──────────────────────────────────────
        de_settings = {
            "sim_len_type": de_sim_len_type,
            "edt":          de_edt,
            "de_ir_length": de_ir_length,
            "de_c0":        de_c0,
            "de_lc":        de_lc,
            "frequencies":  frequencies,
        }
        dg_settings = {
            "dg_freq_upper_limit": dg_freq_upper_limit,
            "dg_c0":              dg_c0,
            "dg_rho0":            dg_rho0,
            "dg_ir_length":       dg_ir_length,
            "dg_poly_order":      dg_poly_order,
            "dg_ppw":             dg_ppw,
            "dg_cfl":             dg_cfl,
            "frequencies":        frequencies,
        }

        # ── Compute total steps for progress reporting ───────────────────────
        if method == "DE":
            total_steps = len(pairs_data)
        else:
            total_steps = len({p["source_id"] for p in pairs_data})

        # ── Build run_fn and enqueue ─────────────────────────────────────────
        # Capture all local variables in the closure now (before the async
        # response is sent) so the consumer thread sees the right values.
        _sim_id   = simulation_id
        _method   = method
        _sim_dir  = sim_dir
        _geo_path = geo_path
        _pairs    = pairs_data
        _absorp   = absorption_coefficients
        _freqs    = frequencies
        _de       = de_settings
        _dg       = dg_settings
        _name     = simulation_name

        def _choras_run_fn(task: UnifiedTask) -> None:
            task.progress = 5
            task.status = "Setting up simulation..."
            done = threading.Event()

            def _wrapper():
                try:
                    _run_simulation_in_thread(
                        _sim_id, task, _method, _sim_dir, _geo_path,
                        _pairs, _absorp, _freqs, _de, _dg, _name,
                    )
                finally:
                    done.set()

            t = threading.Thread(target=_wrapper, daemon=True)
            t.start()
            while not done.wait(timeout=1.0):
                pass
            t.join(timeout=5)

        unified_queue.enqueue(simulation_id, "choras", _choras_run_fn, cleanup_delay=600)

        return ChorasSimulationStartResponse(
            simulation_id=simulation_id,
            total_steps=total_steps,
            method=method,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Choras simulation setup error: {exc}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Choras simulation failed: {exc}")


# ─── Simulation status (polling endpoint) ─────────────────────────────────────

@router.get("/choras/simulation-status/{simulation_id}",
            response_model=ChorasSimulationStatusResponse)
async def get_simulation_status(simulation_id: str):
    """
    Poll the status of a running (or recently completed) Choras simulation.

    Returns live progress (0-100), a human-readable status string, and the
    full result once ``completed=True``.
    """
    task = unified_queue.get_task(simulation_id)
    if not task:
        raise HTTPException(status_code=404, detail="Simulation not found")

    q_pos, q_total = unified_queue.get_queue_status(simulation_id)
    status_str = f"Queued — position {q_pos} of {q_total}" if q_pos is not None else task.status

    result_obj = None
    if task.completed and task.result and not task.error and not task.cancelled:
        result_obj = ChorasSimulationResult(**task.result)

    return ChorasSimulationStatusResponse(
        simulation_id=simulation_id,
        progress=task.progress,
        status=status_str,
        completed=task.completed,
        cancelled=task.cancelled,
        error=task.error,
        result=result_obj,
        queue_position=q_pos,
        queue_total=q_total,
    )


# ─── Cancel simulation ────────────────────────────────────────────────────────

@router.post("/choras/cancel-simulation/{simulation_id}")
async def cancel_simulation(simulation_id: str):
    """
    Signal the running Choras simulation to stop after the current step.

    The worker thread checks the cancel flag between each pair/source iteration.
    """
    if not unified_queue.get_task(simulation_id):
        raise HTTPException(status_code=404, detail="Simulation not found")
    unified_queue.cancel(simulation_id)
    return {"cancelled": True}
