"""
Choras worker runner — child-process-per-job for DE/DG acoustic simulations.

The Speckle fetch + .geo write + solve all happen inside
services/choras_job.py's run_choras_simulation (subprocess target); this
runner just leases from queue:choras and forwards progress/result to Redis
(workers/_subprocess_common.py). A crash or cancel of the solver can no
longer take the API process down with it.
"""
from __future__ import annotations

from services.choras_job import run_choras_simulation
from services.job_store import Job
from workers._subprocess_common import MultiSlotSubprocessRunner
from config.constants import JOB_TYPE_CHORAS, JOB_TYPE_QUEUE


class ChorasRunner(MultiSlotSubprocessRunner):
    queue_key = JOB_TYPE_QUEUE[JOB_TYPE_CHORAS]

    def _resolve(self, job: Job):
        kwargs = dict(job.payload.get("kwargs", {}))
        return run_choras_simulation, kwargs
