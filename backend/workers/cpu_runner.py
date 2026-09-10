"""
CPU worker runner — N-slot child-process-per-job for pyroomacoustics/SED/loop.

All three job families already have a top-level subprocess worker function
that follows the same progress_file/result_file JSON contract (see
services/pyroomacoustics_worker.py, services/sed_worker.py,
services/loop_worker.py); this runner just leases from queue:cpu, dispatches
to the right one based on the job payload's "variant", and forwards
progress/result to Redis (workers/_subprocess_common.py).
"""
from __future__ import annotations

import os

# CPU worker never touches the GPU — keep TensorFlow/YAMNet off CUDA.
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")

from services.job_store import Job
from services.loop_worker import run_loop_analysis
from services.pyroomacoustics_worker import (
    run_pyroomacoustics_simulation,
    run_pyroomacoustics_simulation_from_geometry,
)
from services.sed_worker import run_sed_analysis
from workers._subprocess_common import MultiSlotSubprocessRunner
from config.constants import JOB_TYPE_PYROOMACOUSTICS, JOB_TYPE_QUEUE

_TARGET_FNS = {
    "pyroomacoustics_speckle": run_pyroomacoustics_simulation,
    "pyroomacoustics_geometry": run_pyroomacoustics_simulation_from_geometry,
    "sed": run_sed_analysis,
    "loop": run_loop_analysis,
}


class CpuRunner(MultiSlotSubprocessRunner):
    queue_key = JOB_TYPE_QUEUE[JOB_TYPE_PYROOMACOUSTICS]  # "queue:cpu" — shared by pyroom/sed/loop

    def _resolve(self, job: Job):
        variant = job.payload.get("variant")
        target_fn = _TARGET_FNS.get(variant)
        if target_fn is None:
            raise ValueError(f"Unknown CPU job variant: {variant!r}")
        kwargs = dict(job.payload.get("kwargs", {}))
        return target_fn, kwargs
