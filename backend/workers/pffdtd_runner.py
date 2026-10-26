"""
PFFDTD worker runner — child-process-per-job for GPU FDTD wave simulations.

Leases from queue:pffdtd: simulations ("pffdtd") and on-demand wave animations of finished
runs ("pffdtd_animation", services/pffdtd_animation_job.py). The child (services/pffdtd_job.py) runs in this
worker's env (compas-toy): Speckle fetch + mesh prep + scene export, then it
drives the isolated compas-pffdtd env (PFFDTD_PYTHON) for voxelisation, the
CUDA engine and output processing. Cancel hard-kills the child; the pipeline
process watches its parent PID and stops the engine when the child dies.
Run one slot per GPU.
"""
from __future__ import annotations

from services.job_store import Job
from services.pffdtd_animation_job import run_pffdtd_animation
from services.pffdtd_job import run_pffdtd_simulation
from workers._subprocess_common import MultiSlotSubprocessRunner
from config.constants import JOB_TYPE_PFFDTD, JOB_TYPE_PFFDTD_ANIMATION, JOB_TYPE_QUEUE


class PffdtdRunner(MultiSlotSubprocessRunner):
    queue_key = JOB_TYPE_QUEUE[JOB_TYPE_PFFDTD]

    def _resolve(self, job: Job):
        kwargs = dict(job.payload.get("kwargs", {}))
        if job.type == JOB_TYPE_PFFDTD_ANIMATION:
            return run_pffdtd_animation, kwargs
        return run_pffdtd_simulation, kwargs
