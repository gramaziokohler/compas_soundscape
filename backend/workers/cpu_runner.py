"""
CPU worker runner — N-slot child-process-per-job for pyroomacoustics
(simulation + geometry preflight)/PFFDTD voxel preview/SED/loop.

All three job families already have a top-level subprocess worker function
that follows the same progress_file/result_file JSON contract (see
services/pyroomacoustics_worker.py, services/sed_worker.py,
services/loop_worker.py); this runner just leases from queue:cpu, dispatches
to the right one based on the job payload's "variant", and forwards
progress/result to Redis (workers/_subprocess_common.py).
"""
from __future__ import annotations

import os
import time

# CPU worker never touches the GPU — keep TensorFlow/YAMNet off CUDA.
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")

from services.directivity_import_worker import run_directivity_import, run_directivity_preset_build
from services.job_store import Job
from services.loop_worker import run_loop_analysis
from services.pffdtd_preview_job import run_pffdtd_voxel_preview
from services.pyroomacoustics_worker import (
    run_pyroomacoustics_simulation,
    run_pyroomacoustics_simulation_from_geometry,
)
from services.sed_worker import run_sed_analysis
from services.simulation_preflight_worker import run_simulation_preflight
from services.heatmap_service import run_heatmap
from services.hybrid_job import run_hybrid_simulation
from workers._subprocess_common import MultiSlotSubprocessRunner

from config.constants import (
    CPU_LIGHT_SLOTS,
    QUEUE_CPU,
    QUEUE_CPU_LIGHT,
    SIM_MAX_CONCURRENT,
    SIM_START_MIN_FREE_GB,
)
from services.sim_scheduler import available_memory_gb

_TARGET_FNS = {
    "pyroomacoustics_speckle": run_pyroomacoustics_simulation,
    "pyroomacoustics_geometry": run_pyroomacoustics_simulation_from_geometry,
    "pyroomacoustics_preflight": run_simulation_preflight,
    "hybrid_rays": run_hybrid_simulation,  # hybrid card with the wave part off (parts="rays"): no GPU
    "heatmap": run_heatmap,  # per-source EnergyMap (SPL per band per point) for the Heatmap card
    "pffdtd_voxel_preview": run_pffdtd_voxel_preview,  # voxelise only (compas-pffdtd subprocess)
    "sed": run_sed_analysis,
    "loop": run_loop_analysis,
    "directivity_import": run_directivity_import,  # SOFA / BRAS balloon -> library .npz
    "directivity_preset_build": run_directivity_preset_build,
}


class CpuRunner(MultiSlotSubprocessRunner):
    """Two lanes in one worker process:

    * ``slots`` simulation slots: card simulations from the simulation scheduler
      (services/sim_scheduler.py: fair across workspaces, at most SIM_MAX_CONCURRENT at once),
      then jobs left in the old shared ``queue:cpu``;
    * CPU_LIGHT_SLOTS light slots: preflight, path views, heatmaps, voxel preview, SED, loop, directivity
      (``queue:cpu-light``), so they never wait behind a simulation.
    """

    queue_key = QUEUE_CPU_LIGHT

    def __init__(self, job_store, state, worker_id: str, slots: int):
        super().__init__(job_store, state, worker_id, slots)
        # Job processes are spawned and re-import config.constants: they size
        # PYROOMACOUSTICS_MAX_PROCESSES (cores // CPU_WORKER_SLOTS) on this worker's
        # real slot count, not the default, so the slots together fill the cores.
        os.environ["CPU_WORKER_SLOTS"] = str(max(1, slots))

    def lanes(self):
        return [
            ("sim", self.slots, _lease_simulation),
            ("light", CPU_LIGHT_SLOTS, lambda store: store.lease([QUEUE_CPU_LIGHT], timeout=5)),
        ]

    def _resolve(self, job: Job):
        variant = job.payload.get("variant")
        target_fn = _TARGET_FNS.get(variant)
        if target_fn is None:
            raise ValueError(f"Unknown CPU job variant: {variant!r}")
        kwargs = dict(job.payload.get("kwargs", {}))
        return target_fn, kwargs


def _lease_simulation(store):
    """Next simulation from the scheduler, else a job left in the old shared queue (blocks ~2 s)."""
    job = store.lease_simulation(SIM_MAX_CONCURRENT, SIM_START_MIN_FREE_GB, available_memory_gb)
    if job is not None:
        return job
    job = store.lease([QUEUE_CPU], timeout=2)
    if job is None:
        time.sleep(0.5)  # BLPOP may return at once on some Redis builds: never spin
    return job
