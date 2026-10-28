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

import dataclasses
import json
import os
import time
import traceback
from concurrent.futures import FIRST_COMPLETED, wait
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import config.constants as constants
from config.constants import PYROOMACOUSTICS_DEFAULT_PARALLEL
from config.constants import PYROOMACOUSTICS_IR_TRIM_THRESHOLD
from config.constants import PYROOMACOUSTICS_RECIPROCITY_ENABLED
from config.constants import PYROOMACOUSTICS_SAMPLE_RATE
from config.constants import PYROOMACOUSTICS_SIMULATION_MODE_FOA
from config.constants import PYROOMACOUSTICS_SIMULATION_MODE_MONO
from models.schemas import MeshPrepSettings
from scipy.io import wavfile
from services.pyroomacoustics_directivity import add_source_with_directivity, directivity_result_entry
from services.pyroomacoustics_room_builder import build_room, pra_supports_two_sided, room_offset
from services.pyroomacoustics_service import PyroomacousticsService
from services.simulation_geometry_loader import load_speckle_simulation_geometry
from services.simulation_mesh_service import MeshPrepOptions, SimulationMeshService
from services.simulation_preflight_service import (
    ENGINE_PYROOMACOUSTICS,
    PreflightContext,
    SeedMeta,
    SimulationPreflightService,
    summarize,
)
from utils.acoustic_measurement import AcousticMeasurement
from utils.audio_processing import trim_ir
from utils.child_pool import child_pool
from utils.geometry import seeds_from_pairs
from utils.reciprocity import decide_reciprocity, group_pairs_by_emitter


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


def split_processes(max_processes: int, n_emitters: int) -> tuple[int, int]:
    """(emitter rooms simulated at once, processes splitting the rays of each room)."""
    at_once = max(1, min(max_processes, n_emitters))
    return at_once, max(1, max_processes // at_once)


def _simulate_emitter(ctx: dict, task: dict, progress: Callable[[float, str], None]) -> list[tuple[int, str, dict]]:
    """
    One room: the emitter, and every counterpart of its pairs as a microphone.
    Writes the IR WAVs and returns ``(pair index, IR file name, result entry)``
    per pair. ``progress(fraction of this room in [0, 1], status text)``.
    """
    mesh, offset = ctx["mesh"], ctx["offset"]
    simulation_mode = ctx["simulation_mode"]
    ray_tracing = ctx["ray_tracing"]
    num_channels = 1 if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO else 4
    channel_names_list = ["W", "Y", "Z", "X"]
    label = task["label"]
    directivity_spec = task["directivity_spec"]
    source_note = f" ({directivity_spec['label']} source)" if directivity_spec else ""
    if ctx["flipped"]:
        source_note = " (listener emits)"
    progress(0.0, f"{label}: Building room{source_note}...")

    # Fresh room per emitter from the prepared walls
    room = build_room(mesh, offset, ctx["max_order"], ray_tracing, ctx["air_absorption"], ctx["sound_speed"])

    # Single emitter per room, with its directivity pattern when it has one
    add_source_with_directivity(
        room, (np.asarray(task["emitter_position"], dtype=float) - offset).tolist(), directivity_spec,
    )

    # Add every unique counterpart (the listeners, or the sources when swapped) as a microphone
    receiver_local_indices: dict[str, int] = {}
    for _, pair_dict in task["pairs"]:
        r_id = pair_dict[ctx["mic_id_key"]]
        if r_id not in receiver_local_indices:
            receiver_local_indices[r_id] = len(receiver_local_indices)
            PyroomacousticsService.add_receiver_to_room(
                room,
                (np.asarray(pair_dict[ctx["mic_pos_key"]], dtype=float) - offset).tolist(),
                simulation_mode,
            )

    if ray_tracing:
        PyroomacousticsService.enable_ray_tracing(room, n_rays=ctx["n_rays"], n_processes=task["ray_processes"])

    # The first 80% of the room is compute (reported from inside compute_rir:
    # image sources -> chunked ray tracing -> RIR synthesis), the last 20% IR export.
    progress(0.0, f"{label}: Computing RIR...")
    room.compute_rir(progress_callback=lambda fraction, text: progress(0.8 * fraction, f"{label}: {text}"))

    # ── Extract and export RIRs for each pair with this emitter ───────────
    outputs = []
    n_pairs = len(task["pairs"])
    for local_pair_idx, (index, pair_dict) in enumerate(task["pairs"]):
        source_id = pair_dict["source_id"]
        receiver_id = pair_dict["receiver_id"]

        mic_start_idx = receiver_local_indices[pair_dict[ctx["mic_id_key"]]] * num_channels
        source_in_room = 0  # only one emitter per room

        if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO:
            rir = room.rir[mic_start_idx][source_in_room]
            if rir is None or len(rir) == 0:
                raise ValueError(f"Empty RIR for '{source_id}' -> '{receiver_id}'")
            if not np.any(rir):
                raise ValueError(
                    f"No sound path from '{source_id}' to '{receiver_id}': the direct path and every "
                    "reflection are blocked (a point inside a closed object, or outside the model?)"
                )
            rir_data = trim_ir(rir, threshold_fraction=PYROOMACOUSTICS_IR_TRIM_THRESHOLD)
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
            rir_data = trim_ir(np.column_stack(padded), threshold_fraction=PYROOMACOUSTICS_IR_TRIM_THRESHOLD)

        # Metrics are computed on the TRIMMED signal that is written to
        # disk, so RT60/EDT/DRR/C50/D50 describe the exact exported IR.
        # FOA metrics use the W (omni) channel — rir_data[:, 0].
        acoustic_params = None
        try:
            metric_rir = rir_data if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO else rir_data[:, 0]
            acoustic_params = AcousticMeasurement.calculate_acoustic_parameters_from_rir(
                metric_rir, PYROOMACOUSTICS_SAMPLE_RATE
            )
            if acoustic_params and not ray_tracing:
                # Pure ISM has no diffuse late field; its decay estimate is
                # inherently less trustworthy than the hybrid ray-traced one.
                acoustic_params["rt60_is_estimate"] = True
        except Exception as ap_err:
            print(f"  Warning: acoustic params failed for {source_id}->{receiver_id}: {ap_err}")

        progress(
            0.8 + 0.2 * (local_pair_idx + 1) / n_pairs,
            f"Pair {index + 1}/{ctx['total_pairs']}: Exporting IR...",
        )

        ir_filename = f"sim_{ctx['simulation_id']}_src_{source_id}_rcv_{receiver_id}.wav"
        rir_int16 = np.int16(rir_data * 32767)
        wavfile.write(str(Path(ctx["rir_dir"]) / ir_filename), PYROOMACOUSTICS_SAMPLE_RATE, rir_int16)
        print(f"  Exported {num_channels}-channel IR: {ir_filename}")

        result_entry: dict = {
            "source_id": source_id,
            "receiver_id": receiver_id,
            "source_position": pair_dict["source_position"],
            "receiver_position": pair_dict["receiver_position"],
            "ir_file": ir_filename,
            "sample_rate": PYROOMACOUSTICS_SAMPLE_RATE,
            "max_order": ctx["max_order"],
            "ray_tracing": ray_tracing,
            "air_absorption": ctx["air_absorption"],
            "simulation_mode": simulation_mode,
            "num_channels": num_channels,
        }
        result_entry.update(ctx["entry_meta"])
        if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA:
            result_entry["channel_ordering"] = "ACN"
            result_entry["normalization_convention"] = "SN3D"
            result_entry["format"] = "AmbiX"
            result_entry["encoding_method"] = "directivity"
        if ray_tracing and ctx["ray_tracing_entry_meta"]:
            result_entry.update(ctx["ray_tracing_entry_meta"])
        if directivity_spec:
            result_entry["source_directivity"] = directivity_result_entry(directivity_spec)
        if acoustic_params:
            result_entry["acoustic_parameters"] = acoustic_params
        outputs.append((index, ir_filename, result_entry))
    return outputs


def _simulate_emitter_in_pool(ctx: dict, task: dict, progress_path: str) -> list[tuple[int, str, dict]]:
    """Pool entry point: progress goes to a per-room file (value = fraction in per mille)."""
    def progress(fraction: float, text: str) -> None:
        _write_progress(progress_path, int(1000 * fraction), text)

    return _simulate_emitter(ctx, task, progress)


def _simulate_emitters_in_parallel(
    ctx: dict, tasks: list[dict], n_workers: int, progress_file: str
) -> list[tuple[int, str, dict]]:
    """Every emitter room in a pool of ``n_workers`` processes; the first failure aborts the rest."""
    paths = [f"{progress_file}.emitter{i}" for i in range(len(tasks))]
    outputs: list[tuple[int, str, dict]] = []
    try:
        with child_pool(n_workers) as pool:
            futures = {pool.submit(_simulate_emitter_in_pool, ctx, task, path): i
                       for i, (task, path) in enumerate(zip(tasks, paths))}
            pending = set(futures)
            while pending:
                done, pending = wait(pending, timeout=0.5, return_when=FIRST_COMPLETED)
                for future in done:
                    outputs += future.result()
                fractions = []
                for future, i in futures.items():
                    if future.done():
                        fractions.append(1.0)
                        continue
                    try:
                        with open(paths[i]) as f:
                            fractions.append(json.load(f)["value"] / 1000.0)
                    except (OSError, ValueError, KeyError):
                        fractions.append(0.0)
                value = int(20 + 70.0 * sum(fractions) / len(tasks))
                _write_progress(
                    progress_file,
                    min(value, 90),
                    f"Simulating {len(tasks)} emitters, {n_workers} at once: "
                    f"{len(tasks) - len(pending)}/{len(tasks)} done",
                )
    finally:
        for path in paths:
            for p in (path, path + ".tmp"):
                Path(p).unlink(missing_ok=True)
    return outputs


def _run_pyroomacoustics_compute_loop(
    simulation_id: str,
    progress_file: str,
    result_file: str,
    simulation_name: str,
    pairs_data: list,
    vertices: list,
    faces: list,
    object_face_ranges: dict,
    face_material_map: dict,
    face_scattering_map: Optional[dict],
    mesh_settings: Optional[dict],
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
    parallel: bool = PYROOMACOUSTICS_DEFAULT_PARALLEL,
) -> None:
    """
    Shared per-source compute pipeline used by both the Speckle worker and the
    direct-geometry worker. With ``parallel``, the emitter rooms run in up to
    PYROOMACOUSTICS_MAX_PROCESSES processes, and processes left over split the rays.

    Prepares the simulation mesh ONCE (weld, air-side orientation, two-sided
    detection, coplanar merge — identical to the geometry preflight), then
    runs one room.compute_rir() per unique source (with all receivers for
    that source). Progress is reported via atomic JSON file writes;
    result/error is written to result_file on exit.
    """
    # ── Prepare the simulation mesh ONCE ───────────────────────────────────
    _write_progress(progress_file, 15, "Preparing simulation mesh (weld, orientation, merge)...")
    seed_meta = seeds_from_pairs(pairs_data)
    mesh = SimulationMeshService.prepare(
        vertices, faces, object_face_ranges, face_material_map, face_scattering_map,
        [s["position"] for s in seed_meta],
        MeshPrepOptions.from_settings(MeshPrepSettings(**(mesh_settings or {}))),
    )
    analysis = SimulationPreflightService.analyze(mesh, PreflightContext(
        engine=ENGINE_PYROOMACOUSTICS,
        seeds=[SeedMeta(**s) for s in seed_meta],
        pairs=[(str(p["source_id"]), str(p["receiver_id"])) for p in pairs_data],
        max_order=max_order,
        ray_tracing=ray_tracing,
        two_sided_supported=pra_supports_two_sided(),
    ))
    geometry_diagnostics = {
        **summarize(analysis.issues),
        "issues": [
            {"severity": i.severity, "code": i.code, "title": i.title}
            for i in analysis.issues if i.severity != "info"
        ],
        "stats": {**mesh.stats, "air_volume_m3": mesh.air_volume_m3,
                  "air_volume_method": mesh.air_volume_method},
    }
    print(
        f"[{simulation_id[:8]}] Simulation mesh: {len(mesh.faces)} faces -> {len(mesh.walls)} walls, "
        f"{mesh.stats['flipped_faces']} flipped, {mesh.stats['two_sided_faces']} two-sided, "
        f"air volume {mesh.air_volume_m3:.1f} m^3 ({mesh.air_volume_method}); "
        f"{geometry_diagnostics['n_errors']} error(s), {geometry_diagnostics['n_warnings']} warning(s)"
    )
    for issue in analysis.issues:
        if issue.severity != "info":
            print(f"  [{issue.severity}] {issue.title}")
    # pra walls are float32: build around the model centre, shift positions too.
    offset = room_offset(mesh)

    # ── Group pairs by emitter ──────────────────────────────────────────────
    # Normally every source is an emitter and the listeners are its microphones.
    # With more sources than listeners the roles are swapped (acoustic
    # reciprocity): a room costs about the same whatever its microphone count,
    # so fewer emitters means fewer rooms.
    reciprocity = decide_reciprocity(pairs_data, simulation_mode, PYROOMACOUSTICS_RECIPROCITY_ENABLED)
    flipped = reciprocity.flipped
    emitter_pos_key, mic_pos_key, mic_id_key = (
        ("receiver_position", "source_position", "source_id")
        if flipped
        else ("source_position", "receiver_position", "receiver_id")
    )
    print(f"[{simulation_id[:8]}] Reciprocity: {reciprocity.reason}")

    pairs_by_source = group_pairs_by_emitter(pairs_data, flipped)  # emitter id -> its pairs
    n_sources = len(pairs_by_source)
    total_pairs = len(pairs_data)
    pair_index = {id(p): i for i, p in enumerate(pairs_data)}

    tasks: list[dict] = []
    pair_counter = 0
    for emitter_id, source_pairs in pairs_by_source.items():
        n_pairs = len(source_pairs)
        # Prefix every status line with the pair range so overall progress is
        # always visible, e.g. "Pair 2/14: Ray tracing source 1/1 ..."
        if n_pairs == 1:
            label = f"Pair {pair_counter + 1}/{total_pairs}"
        else:
            label = f"Pairs {pair_counter + 1}-{pair_counter + n_pairs}/{total_pairs}"
        pair_counter += n_pairs
        tasks.append({
            "label": label,
            "emitter_position": source_pairs[0][emitter_pos_key],
            # Directivity + orientation of this source (None = omnidirectional); resolved
            # by the router from the pair's `source_directivity` (services/directivity_service.py).
            # Never set when the roles are swapped (see utils/reciprocity.py).
            "directivity_spec": None if flipped else source_pairs[0].get("source_directivity_spec"),
            "pairs": [(pair_index[id(p)], p) for p in source_pairs],
        })

    # ── One room per emitter, in parallel processes ─────────────────────────
    max_processes = constants.PYROOMACOUSTICS_MAX_PROCESSES if parallel else 1
    at_once, ray_processes = split_processes(max_processes, n_sources)
    for task in tasks:
        task["ray_processes"] = ray_processes if ray_tracing else 1
    print(
        f"[{simulation_id[:8]}] {n_sources} emitter(s): {at_once} at once, "
        f"rays over {ray_processes if ray_tracing else 0} process(es) each"
    )

    ctx = {
        # build_room needs the walls and materials, not the air-visibility data
        "mesh": dataclasses.replace(mesh, visibility=None),
        "offset": offset,
        "simulation_id": simulation_id,
        "simulation_mode": simulation_mode,
        "max_order": max_order,
        "ray_tracing": ray_tracing,
        "air_absorption": air_absorption,
        "n_rays": n_rays,
        "sound_speed": sound_speed,
        "rir_dir": str(rir_dir),
        "mic_id_key": mic_id_key,
        "mic_pos_key": mic_pos_key,
        "flipped": flipped,
        "total_pairs": total_pairs,
        "entry_meta": entry_meta,
        "ray_tracing_entry_meta": ray_tracing_entry_meta,
    }

    # Progress spread: 20% → 90% across all emitters
    if at_once == 1:
        outputs = []
        for i, task in enumerate(tasks):
            def _progress(fraction, text, _i=i):
                value = int(20 + 70.0 * (_i + fraction) / n_sources)
                _write_progress(progress_file, min(value, 90), text)

            # Blocking — subprocess is hard-killed here if cancelled
            outputs += _simulate_emitter(ctx, task, _progress)
    else:
        outputs = _simulate_emitters_in_parallel(ctx, tasks, at_once, progress_file)

    outputs.sort(key=lambda out: out[0])
    ir_files = [out[1] for out in outputs]
    results_data = [out[2] for out in outputs]

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
    results_json["geometry_diagnostics"] = geometry_diagnostics
    results_json["reciprocity"] = reciprocity.as_dict()
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
    mesh_settings: Optional[dict] = None,
    parallel: bool = PYROOMACOUSTICS_DEFAULT_PARALLEL,
) -> None:
    """
    Full pyroomacoustics simulation pipeline, runs in a subprocess.

    Fetches Speckle geometry, then delegates to the shared compute loop.
    Progress is reported via atomic JSON file writes; result/error is written
    to result_file on exit.
    """
    try:
        # ── Phase 1-2: Speckle geometry + per-face materials / scattering ────
        inputs = load_speckle_simulation_geometry(
            speckle_project_id, speckle_version_id, layer_name, object_ids_filter,
            object_materials_dict, object_scattering_dict,
            progress=lambda v, st: _write_progress(progress_file, v, st),
        )
        print(
            f"[{simulation_id[:8]}] Geometry: {len(inputs.vertices)} vertices, "
            f"{len(inputs.faces)} faces, {len(inputs.object_face_ranges)} objects "
            f"(source units: '{inputs.units}', vertices converted to meters); "
            f"materials: {inputs.n_material_matched} object(s) matched, "
            f"{inputs.n_material_skipped} skipped"
        )

        # ── Phase 3: Shared compute loop (mesh prep + per-source compute_rir) ─
        _run_pyroomacoustics_compute_loop(
            simulation_id=simulation_id,
            progress_file=progress_file,
            result_file=result_file,
            simulation_name=simulation_name,
            pairs_data=pairs_data,
            vertices=inputs.vertices,
            faces=inputs.faces,
            object_face_ranges=inputs.object_face_ranges,
            face_material_map=inputs.face_materials,
            face_scattering_map=inputs.face_scattering,
            mesh_settings=mesh_settings,
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
            parallel=parallel,
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
    mesh_settings: Optional[dict] = None,
    parallel: bool = PYROOMACOUSTICS_DEFAULT_PARALLEL,
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

        # ── Phase 2: Group faces per material group (unassigned are dropped) ──
        # Faces are regrouped contiguously so each group becomes one "object"
        # with a face range, exactly like Speckle geometry; faces outside any
        # material-bearing group are dropped (same rule as the Speckle path).
        _write_progress(progress_file, 12, "Processing materials...")
        grouped_faces: list[list[int]] = []
        object_face_ranges: dict[str, list[int]] = {}
        face_material_map: dict[int, object] = {}
        face_scattering_map: dict[int, float] = {}
        group_scattering: dict[str, float] = {}
        for group_id, face_indices in face_groups.items():
            material = materials.get(group_id)
            if material is None:
                print(f"  Skipping group '{group_id}': no material assigned")
                continue
            if isinstance(material, dict) and material.get("coeffs"):
                # Pre-resolved per-band coefficients (material `name` path).
                value = material
            else:
                value = float(material.get("absorption", 1.0))
            if material.get("scattering") is not None:
                group_scattering[group_id] = float(material["scattering"])
            start_idx = len(grouped_faces)
            for face_idx in face_indices:
                new_idx = len(grouped_faces)
                grouped_faces.append(faces[face_idx])
                face_material_map[new_idx] = value
                if group_id in group_scattering:
                    face_scattering_map[new_idx] = group_scattering[group_id]
            if len(grouped_faces) > start_idx:
                object_face_ranges[str(group_id)] = [start_idx, len(grouped_faces) - 1]

        if len(grouped_faces) < 4:
            raise RuntimeError(
                f"Only {len(grouped_faces)} face(s) have a material — a room needs at least 4. "
                "Check that every wall/ceiling/floor mesh has a material assigned."
            )

        print(
            f"[{simulation_id[:8]}] Geometry: {len(vertices)} vertices, "
            f"{len(grouped_faces)}/{len(faces)} faces kept "
            f"(dropped {len(faces) - len(grouped_faces)} with no material), "
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
                    # optional worker-ready spec (tests / future Grasshopper support)
                    "source_directivity_spec": src.get("directivity_spec"),
                })

        # ── Phase 4: Shared compute loop (welds + per-source compute_rir) ─────
        _run_pyroomacoustics_compute_loop(
            simulation_id=simulation_id,
            progress_file=progress_file,
            result_file=result_file,
            simulation_name=simulation_name,
            pairs_data=pairs_data,
            vertices=vertices,
            faces=grouped_faces,
            object_face_ranges=object_face_ranges,
            face_material_map=face_material_map,
            face_scattering_map=face_scattering_map,
            mesh_settings=mesh_settings,
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
            parallel=parallel,
        )

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"Pyroomacoustics geometry simulation error [{simulation_id}]:\n{tb}")
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
