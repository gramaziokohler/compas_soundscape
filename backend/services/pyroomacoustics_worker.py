"""
Pyroomacoustics simulation workers.

Both entry points (Speckle geometry and direct JSON geometry) run as a
subprocess via multiprocessing.Process.  They report progress via atomic JSON
file writes to avoid GIL-starvation issues with multiprocessing.Queue, and
share a single compute loop so the two geometry paths can't drift.

Progress file  (temp_dir/progress_{simulation_id}.json):
    {"value": 0-100, "status": "<human text>"}

Result file  (temp_dir/result_{simulation_id}.json):
    {"type": "done",  "result": {...}}
 or {"type": "error", "message": "<str>", "traceback": "<str>"}
"""

from __future__ import annotations

import json
import os
import time
import traceback
from collections import defaultdict
from pathlib import Path
from typing import Optional

import numpy as np
from config.constants import PYROOMACOUSTICS_DEFAULT_SCATTERING
from config.constants import PYROOMACOUSTICS_IR_TRIM_THRESHOLD
from config.constants import PYROOMACOUSTICS_SAMPLE_RATE
from config.constants import PYROOMACOUSTICS_SIMULATION_MODE_FOA
from config.constants import PYROOMACOUSTICS_SIMULATION_MODE_MONO
from scipy.io import wavfile
from services.pyroomacoustics_service import PyroomacousticsService
from services.speckle_service import SpeckleService
from utils.acoustic_measurement import AcousticMeasurement
from utils.audio_processing import trim_ir
from utils.geometry import fix_outward_winding


def _atomic_replace(src: str, dst: str) -> None:
    """os.replace with retry for Windows file-lock races."""
    for attempt in range(5):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.05 * (attempt + 1))


def _write_progress(progress_file: str, value: int, status: str) -> None:
    """Atomically write progress JSON via temp-file + os.replace()."""
    tmp = progress_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"value": value, "status": status}, f)
    _atomic_replace(tmp, progress_file)


def _write_result(result_file: str, payload: dict) -> None:
    """Atomically write the final result/error JSON."""
    tmp = result_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    _atomic_replace(tmp, result_file)


def _run_pyroomacoustics_compute_loop(
    simulation_id: str,
    progress_file: str,
    result_file: str,
    simulation_name: str,
    pairs_data: list,
    vertices: list,
    faces: list,
    face_material_map: Optional[dict],
    face_scattering_map: Optional[dict],
    simulation_mode: str,
    max_order: int,
    ray_tracing: bool,
    air_absorption: bool,
    n_rays: int,
    sound_speed: float,
    rir_dir: Path,
    tmp_dir: Path,
    entry_meta: dict,
    ray_tracing_entry_meta: Optional[dict] = None,
    header_meta: Optional[dict] = None,
) -> None:
    """
    Shared per-source compute pipeline used by both the Speckle worker and the
    direct-geometry worker.

    Welds the mesh ONCE, then runs one room.compute_rir() per unique source
    (with all receivers for that source).  Progress is reported via atomic
    JSON file writes; result/error is written to result_file on exit.
    """
    # ── Weld mesh ONCE ─────────────────────────────────────────────────────
    _write_progress(progress_file, 18, "Welding mesh...")
    welded_vertices, welded_faces, welded_face_materials, welded_face_scattering = (
        PyroomacousticsService.weld_mesh(
            vertices,
            faces,
            face_material_map if face_material_map else None,
            face_scattering_map,
        )
    )

    # ── Group pairs by source ───────────────────────────────────────────────
    num_channels = 1 if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO else 4
    channel_names_list = ["W", "Y", "Z", "X"]

    pairs_by_source: dict[str, list] = defaultdict(list)
    for pair_dict in pairs_data:
        pairs_by_source[pair_dict["source_id"]].append(pair_dict)

    unique_source_ids = list(pairs_by_source.keys())
    n_sources = len(unique_source_ids)

    ir_files: list[str] = []
    results_data: list[dict] = []
    total_pairs = len(pairs_data)
    pair_counter = 0  # cumulative pairs completed so far

    # ── Per-source compute_rir loop ─────────────────────────────────────────
    # Progress spread: 20% → 90% across all sources
    for src_idx, source_id in enumerate(unique_source_ids):
        source_pairs = pairs_by_source[source_id]
        source_position = source_pairs[0]["source_position"]
        n_pairs_this_source = len(source_pairs)
        pair_label_start = pair_counter + 1
        pair_label_end = pair_counter + n_pairs_this_source

        prog_build = 20 + src_idx * 70 // n_sources
        _write_progress(
            progress_file,
            prog_build,
            f"Building room (pair {pair_label_start}/{total_pairs})...",
        )

        # Build fresh room from pre-welded mesh (skip weld for speed)
        room = PyroomacousticsService.build_room_from_geometry(
            vertices=welded_vertices,
            faces=welded_faces,
            face_materials=welded_face_materials,
            face_scattering=welded_face_scattering,
            max_order=max_order,
            ray_tracing=ray_tracing,
            air_absorption=air_absorption,
            sound_speed=sound_speed,
            skip_weld=True,
        )

        # Single source per room
        room.add_source(source_position)

        # Add all unique receivers for this source
        receiver_local_indices: dict[str, int] = {}
        for pair_dict in source_pairs:
            r_id = pair_dict["receiver_id"]
            if r_id not in receiver_local_indices:
                receiver_local_indices[r_id] = len(receiver_local_indices)
                PyroomacousticsService.add_receiver_to_room(
                    room, pair_dict["receiver_position"], simulation_mode
                )

        if ray_tracing:
            PyroomacousticsService.enable_ray_tracing(room, n_rays=n_rays)

        prog_rir = 20 + src_idx * 70 // n_sources + 35 // n_sources
        if n_pairs_this_source == 1:
            rir_status = f"Computing pair {pair_label_start}/{total_pairs}..."
        else:
            rir_status = f"Computing pairs {pair_label_start}-{pair_label_end}/{total_pairs}..."
        _write_progress(progress_file, prog_rir, rir_status)

        # Blocking — subprocess is hard-killed here if cancelled
        room.compute_rir()

        # ── Extract and export RIRs for each pair with this source ────────
        for local_pair_idx, pair_dict in enumerate(source_pairs):
            receiver_id = pair_dict["receiver_id"]
            source_pos = pair_dict["source_position"]
            receiver_pos = pair_dict["receiver_position"]

            local_rcv_idx = receiver_local_indices[receiver_id]
            mic_start_idx = local_rcv_idx * num_channels
            source_in_room = 0  # only one source per room

            if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO:
                rir = room.rir[mic_start_idx][source_in_room]
                if rir is None or len(rir) == 0:
                    raise ValueError(f"Empty RIR for '{source_id}' -> '{receiver_id}'")
                rir_data = rir
            else:
                rir_channels = []
                for ch in range(num_channels):
                    mic_idx = mic_start_idx + ch
                    if mic_idx >= len(room.rir):
                        raise ValueError(f"Microphone index {mic_idx} out of range")
                    ch_rir = room.rir[mic_idx][source_in_room]
                    if ch_rir is None or len(ch_rir) == 0:
                        ch_name = channel_names_list[ch] if ch < len(channel_names_list) else f"Channel {ch}"
                        raise ValueError(f"Empty RIR for {ch_name} channel")
                    rir_channels.append(ch_rir)
                max_length = max(len(r) for r in rir_channels)
                padded = [
                    np.pad(r, (0, max_length - len(r)), mode="constant") if len(r) < max_length else r
                    for r in rir_channels
                ]
                rir_data = np.column_stack(padded)

            acoustic_params = None
            try:
                first_ch_rir = room.rir[mic_start_idx][source_in_room]
                acoustic_params = AcousticMeasurement.calculate_acoustic_parameters_from_rir(
                    first_ch_rir, PYROOMACOUSTICS_SAMPLE_RATE
                )
            except Exception as ap_err:
                print(f"  Warning: acoustic params failed for {source_id}->{receiver_id}: {ap_err}")

            rir_data = trim_ir(rir_data, threshold_fraction=PYROOMACOUSTICS_IR_TRIM_THRESHOLD)

            current_pair = pair_counter + local_pair_idx + 1
            _write_progress(
                progress_file,
                90 * current_pair // total_pairs,
                f"Exporting pair {current_pair}/{total_pairs}...",
            )

            ir_filename = f"sim_{simulation_id}_src_{source_id}_rcv_{receiver_id}.wav"
            ir_path = rir_dir / ir_filename
            rir_int16 = np.int16(rir_data * 32767)
            wavfile.write(str(ir_path), PYROOMACOUSTICS_SAMPLE_RATE, rir_int16)
            print(f"  Exported {num_channels}-channel IR: {ir_filename}")
            ir_files.append(ir_filename)

            result_entry: dict = {
                "source_id": source_id,
                "receiver_id": receiver_id,
                "source_position": source_pos,
                "receiver_position": receiver_pos,
                "ir_file": ir_filename,
                "sample_rate": PYROOMACOUSTICS_SAMPLE_RATE,
                "max_order": max_order,
                "ray_tracing": ray_tracing,
                "air_absorption": air_absorption,
                "simulation_mode": simulation_mode,
                "num_channels": num_channels,
            }
            result_entry.update(entry_meta)
            if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA:
                result_entry["channel_ordering"] = "ACN"
                result_entry["normalization_convention"] = "SN3D"
                result_entry["format"] = "AmbiX"
                result_entry["encoding_method"] = "directivity"
            if ray_tracing and ray_tracing_entry_meta:
                result_entry.update(ray_tracing_entry_meta)
            if acoustic_params:
                result_entry["acoustic_parameters"] = acoustic_params
            results_data.append(result_entry)

        pair_counter += n_pairs_this_source

    # ── Write results JSON ──────────────────────────────────────────────────
    _write_progress(progress_file, 95, "Saving results...")
    results_filename = f"simulation_{simulation_id}_results.json"
    results_json = {
        "simulation_id": simulation_id,
        "simulation_name": simulation_name,
        "results": results_data,
    }
    if header_meta:
        results_json.update(header_meta)
    with open(tmp_dir / results_filename, "w") as f:
        json.dump(results_json, f, indent=2)

    print(f"\n{'='*60}")
    print(f"Pyroomacoustics simulation completed: {simulation_id}")
    print(f"  IR files: {len(ir_files)}")
    print(f"{'='*60}\n")

    _write_result(result_file, {
        "type": "done",
        "result": {
            "simulation_id": simulation_id,
            "message": "Simulation completed successfully",
            "ir_files": ir_files,
            "results_file": results_filename,
        },
    })


def run_pyroomacoustics_simulation(
    simulation_id: str,
    progress_file: str,
    result_file: str,
    speckle_project_id: str,
    speckle_version_id: str,
    layer_name: str,
    object_ids_filter: Optional[list],
    object_materials_dict: dict,
    object_scattering_dict: dict,
    simulation_mode: str,
    max_order: int,
    ray_tracing: bool,
    air_absorption: bool,
    n_rays: int,
    sound_speed: float = 343.0,
    pairs_data: list = None,
    simulation_name: str = "",
    rir_output_dir: str = "",
    temp_dir: str = "",
) -> None:
    """
    Full pyroomacoustics simulation pipeline, runs in a subprocess.

    Fetches Speckle geometry, then delegates to the shared compute loop.
    Progress is reported via atomic JSON file writes; result/error is written
    to result_file on exit.
    """
    try:
        # ── Phase 1: Speckle auth + geometry fetch ────────────────────────────
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

        vertices = geometry_data.get("vertices", [])
        faces = geometry_data.get("faces", [])
        object_face_ranges: dict = geometry_data.get("object_face_ranges", {})

        if not vertices or not faces:
            if object_ids_filter:
                raise RuntimeError(
                    f"No geometry found for the {len(object_ids_filter)} object IDs sent from the frontend. "
                    f"Ensure the objects have mesh display values in Speckle."
                )
            raise RuntimeError(
                f"No valid geometry found in Speckle layer '{layer_name}'. "
                f"Ensure the layer contains mesh objects with display values."
            )

        geometry_units = geometry_data.get("units", "m")
        print(
            f"[{simulation_id[:8]}] Geometry: {len(vertices)} vertices, "
            f"{len(faces)} faces, {len(object_face_ranges)} objects "
            f"(source units: '{geometry_units}', vertices converted to meters)"
        )

        # ── Phase 2: Material + scattering mapping ────────────────────────────
        _write_progress(progress_file, 12, "Processing materials...")
        face_material_map: dict[int, str] = {}
        for obj_id, material_id in object_materials_dict.items():
            if obj_id not in object_face_ranges:
                print(f"  Warning: object '{obj_id}' not in geometry — skipping material")
                continue
            start_face, end_face = object_face_ranges[obj_id]
            for face_idx in range(start_face, end_face + 1):
                face_material_map[face_idx] = material_id

        face_scattering_map: Optional[dict[int, float]] = None
        if ray_tracing:
            face_scattering_map = {}
            for obj_id, scatter_val in object_scattering_dict.items():
                if obj_id not in object_face_ranges:
                    continue
                start_face, end_face = object_face_ranges[obj_id]
                for face_idx in range(start_face, end_face + 1):
                    face_scattering_map[face_idx] = float(scatter_val)
            print(
                f"[{simulation_id[:8]}] Scattering map: {len(face_scattering_map)} faces assigned, "
                f"rest default={PYROOMACOUSTICS_DEFAULT_SCATTERING}"
            )

        # ── Phase 3: Shared compute loop (welds + per-source compute_rir) ────
        _run_pyroomacoustics_compute_loop(
            simulation_id=simulation_id,
            progress_file=progress_file,
            result_file=result_file,
            simulation_name=simulation_name,
            pairs_data=pairs_data,
            vertices=vertices,
            faces=faces,
            face_material_map=face_material_map,
            face_scattering_map=face_scattering_map,
            simulation_mode=simulation_mode,
            max_order=max_order,
            ray_tracing=ray_tracing,
            air_absorption=air_absorption,
            n_rays=n_rays,
            sound_speed=sound_speed,
            rir_dir=Path(rir_output_dir),
            tmp_dir=Path(temp_dir),
            entry_meta={
                "speckle_source": {
                    "project_id": speckle_project_id,
                    "version_id": speckle_version_id,
                    "layer_name": layer_name,
                },
            },
            ray_tracing_entry_meta=(
                {"n_rays": n_rays, "scattering_per_object": object_scattering_dict}
                if ray_tracing else None
            ),
            header_meta={
                "speckle_source": {
                    "project_id": speckle_project_id,
                    "version_id": speckle_version_id,
                    "layer_name": layer_name,
                },
            },
        )

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"Pyroomacoustics simulation error [{simulation_id}]:\n{tb}")
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})


def run_pyroomacoustics_simulation_from_geometry(
    simulation_id: str,
    progress_file: str,
    result_file: str,
    geometry_file: str,
    simulation_mode: str,
    max_order: int,
    ray_tracing: bool,
    air_absorption: bool,
    n_rays: int,
    sound_speed: float,
    simulation_name: str = "",
    rir_output_dir: str = "",
    temp_dir: str = "",
) -> None:
    """
    Direct-geometry pyroomacoustics pipeline, runs in a subprocess.

    Geometry source is a JSON payload (written by the router, coordinates
    already in meters) instead of a Speckle fetch.  Faces whose group has no
    material assignment are skipped — they are not built as walls.

    Progress is reported via atomic JSON file writes; result/error is written
    to result_file on exit.
    """
    try:
        # ── Phase 1: Read geometry payload ────────────────────────────────────
        _write_progress(progress_file, 5, "Reading geometry payload...")
        with open(geometry_file, "r") as f:
            payload = json.load(f)

        vertices: list = payload["vertices"]
        faces: list = payload["faces"]
        face_groups: dict[str, list[int]] = payload.get("face_groups", {})
        materials: dict = payload.get("materials", {})
        sources: list = payload.get("sources", [])
        receivers: list = payload.get("receivers", [])

        if not vertices or not faces:
            raise RuntimeError("No geometry found in the geometry payload.")
        if not sources or not receivers:
            raise RuntimeError("No sources or receivers in the geometry payload.")

        # ── Phase 2: Material + scattering mapping (skip unassigned faces) ────
        _write_progress(progress_file, 12, "Processing materials...")

        group_material: dict[int, object] = {}
        group_scattering: dict[int, float] = {}
        face_to_group: dict[int, str] = {}
        for group_id, face_indices in face_groups.items():
            material = materials.get(group_id)
            if material is None:
                print(f"  Skipping group '{group_id}': no material assigned")
                continue
            if isinstance(material, dict) and material.get("coeffs"):
                # Pre-resolved per-band coefficients (material `name` path) —
                # create_room_from_mesh feeds these straight to pra.Material.
                group_material[group_id] = material
            else:
                group_material[group_id] = float(material.get("absorption", 1.0))
            if material.get("scattering") is not None:
                group_scattering[group_id] = float(material["scattering"])
            for face_idx in face_indices:
                face_to_group[face_idx] = group_id

        # Faces not present in any material-bearing group are skipped entirely.
        kept_faces: list[list[int]] = []
        face_material_map: dict[int, object] = {}
        face_scattering_map: Optional[dict[int, float]] = None
        if ray_tracing:
            face_scattering_map = {}
        for old_idx, face in enumerate(faces):
            group_id = face_to_group.get(old_idx)
            if group_id is None:
                print(f"  Skipping face {old_idx}: no material assigned")
                continue
            new_idx = len(kept_faces)
            kept_faces.append(face)
            face_material_map[new_idx] = group_material[group_id]
            if face_scattering_map is not None and group_id in group_scattering:
                face_scattering_map[new_idx] = group_scattering[group_id]

        if not kept_faces:
            raise RuntimeError("No faces remained after skipping unassigned material groups.")

        # A closed room volume needs at least 4 triangular faces.
        if len(kept_faces) < 4:
            raise RuntimeError(
                f"Only {len(kept_faces)} face(s) remain after skipping unassigned material "
                "groups — a room needs at least 4. Check that every wall/ceiling/floor mesh "
                "has a material assigned."
            )

        # Ensure outward-facing triangle normals before building walls.
        fix_outward_winding(vertices, kept_faces)

        print(
            f"[{simulation_id[:8]}] Geometry: {len(vertices)} vertices, "
            f"{len(kept_faces)}/{len(faces)} faces kept "
            f"(dropped {len(faces) - len(kept_faces)} with no material), "
            f"{len(sources)} sources, {len(receivers)} receivers"
        )

        # ── Phase 3: Build all source↔receiver pairs (cross product) ─────────
        pairs_data: list[dict] = []
        for src in sources:
            for rcv in receivers:
                pairs_data.append({
                    "source_id": src["id"],
                    "source_position": src["position"],
                    "receiver_id": rcv["id"],
                    "receiver_position": rcv["position"],
                })

        # ── Phase 4: Shared compute loop (welds + per-source compute_rir) ─────
        _run_pyroomacoustics_compute_loop(
            simulation_id=simulation_id,
            progress_file=progress_file,
            result_file=result_file,
            simulation_name=simulation_name,
            pairs_data=pairs_data,
            vertices=vertices,
            faces=kept_faces,
            face_material_map=face_material_map,
            face_scattering_map=face_scattering_map,
            simulation_mode=simulation_mode,
            max_order=max_order,
            ray_tracing=ray_tracing,
            air_absorption=air_absorption,
            n_rays=n_rays,
            sound_speed=sound_speed,
            rir_dir=Path(rir_output_dir),
            tmp_dir=Path(temp_dir),
            entry_meta={
                "geometry_source": {"format": "geometry-json", "units": "m"},
            },
            ray_tracing_entry_meta=(
                {"n_rays": n_rays, "scattering_per_group": dict(group_scattering)}
                if ray_tracing else None
            ),
            header_meta={
                "geometry_source": {"format": "geometry-json", "units": "m"},
            },
        )

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"Pyroomacoustics geometry simulation error [{simulation_id}]:\n{tb}")
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
