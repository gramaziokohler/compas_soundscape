"""
Stable Audio 3 GPU worker runner — resident model, one clip lane per process.

Runs INSIDE the isolated `compas-sa3` conda env (see deploy/README.md and
services/stable_audio_service.py) and leases `queue:sa3`. Mirrors GpuRunner:
  - the model is loaded once at startup (resident) and warmed up,
  - cooperative cancel via should_stop() polled once per sampler step,
  - per-clip progress + partial results streamed to Redis.

The FastAPI process must NOT import services.stable_audio_service; only this
worker (launched with the compas-sa3 interpreter) does.
"""
from __future__ import annotations

import os
import threading
import time

from services.job_store import Job, WorkerJobStore
from services.stable_audio_service import StableAudioService, StableAudioCancelled
from config.constants import (
    JOB_TYPE_SA3,
    JOB_TYPE_QUEUE,
    STABLE_AUDIO_DEFAULT_STEPS,
    STABLE_AUDIO_DEFAULT_GUIDANCE,
    STABLE_AUDIO_DEFAULT_DURATION_PADDING_S,
    STABLE_AUDIO_DEFAULT_SAMPLER,
    STABLE_AUDIO_MODE_TEXT,
    DEFAULT_DBFS,
)


class Sa3Runner:
    def __init__(self, job_store: WorkerJobStore, state, worker_id: str):
        self.job_store = job_store
        self.state = state
        self.worker_id = worker_id
        self.service: StableAudioService | None = None
        self._queue_key = JOB_TYPE_QUEUE[JOB_TYPE_SA3]

    def _ensure_model_loaded(self) -> None:
        if self.service is not None:
            return
        print(f"[sa3:{self.worker_id}] loading Stable Audio 3 model (resident)...")
        self.service = StableAudioService()
        self.service._ensure_model()
        print(f"[sa3:{self.worker_id}] warming up...")
        self.service.warm_up()

    def run_forever(self, shutdown: threading.Event) -> None:
        self._ensure_model_loaded()
        print(f"[sa3:{self.worker_id}] ready, leasing from {self._queue_key}")
        while not shutdown.is_set():
            try:
                job = self.job_store.lease([self._queue_key], timeout=5)
            except Exception as exc:
                print(f"[sa3:{self.worker_id}] lease error: {exc}")
                time.sleep(2)
                continue
            if job is None:
                continue
            self.state.start_job(job.job_id)
            try:
                self._run_job(job)
            except Exception as exc:
                print(f"[sa3:{self.worker_id}] job {job.job_id} failed: {exc}")
                try:
                    self.job_store.fail(job.job_id, str(exc))
                except Exception:
                    pass
            finally:
                self.state.end_job(job.job_id)

    def _run_job(self, job: Job) -> None:
        payload = job.payload
        clips = list(payload.get("clips", []))
        completed = list(payload.get("completed_sounds", []))
        total_clips = payload.get("total_clips") or (len(clips) + len(completed)) or 1
        output_dir = payload["output_dir"]
        url_prefix = payload["url_prefix"]

        os.makedirs(output_dir, exist_ok=True)

        while clips:
            if self.job_store.is_cancel_requested(job.job_id) or self.state.should_stop(job.job_id):
                self.job_store.mark_cancelled(job.job_id)
                return

            clip = clips.pop(0)
            done_idx = total_clips - len(clips) - 1
            display_short = (clip.get("display_name") or clip.get("prompt") or "audio")[:30]
            output_path = os.path.normpath(os.path.join(output_dir, clip["filename"]))
            mode = clip.get("generation_mode") or STABLE_AUDIO_MODE_TEXT

            def progress_cb(step, total, _idx=done_idx, _n=total_clips, _d=display_short, _m=mode):
                pct = int((_idx + step / max(total, 1)) / _n * 90)
                self.job_store.set_progress(
                    job.job_id, pct,
                    f"Generating sound {_idx + 1}/{_n} ({_d}) [{_m}]: step {step}/{total}...",
                    partial=completed,
                )
                self.job_store.heartbeat(job.job_id, self.worker_id)

            def stage_cb(stage, _idx=done_idx, _n=total_clips, _d=display_short):
                self.job_store.set_progress(
                    job.job_id, int((_idx + 1) / _n * 90),
                    f"Generating sound {_idx + 1}/{_n} ({_d}): {stage}",
                    partial=completed,
                )

            def should_stop(_jid=job.job_id):
                return self.job_store.is_cancel_requested(_jid) or self.state.should_stop(_jid)

            if os.path.exists(output_path):
                print(f"[sa3:{self.worker_id}] sound already exists, skipping: {clip['filename']}")
            else:
                try:
                    self.service.generate_clip(
                        output_path=output_path,
                        prompt=clip.get("prompt", ""),
                        mode=mode,
                        negative_prompt=clip.get("negative_prompt", ""),
                        duration=clip.get("duration", 8.0),
                        steps=clip.get("steps") or STABLE_AUDIO_DEFAULT_STEPS,
                        cfg_scale=clip.get("cfg_scale", clip.get("guidance_scale", STABLE_AUDIO_DEFAULT_GUIDANCE)),
                        seed=clip.get("seed", -1),
                        dbfs=clip.get("dbfs", DEFAULT_DBFS),
                        init_audio_path=clip.get("init_audio_path"),
                        init_noise_level=clip.get("init_noise_level", 0.9),
                        inpaint_audio_path=clip.get("inpaint_audio_path"),
                        inpaint_regions=clip.get("inpaint_regions"),
                        duration_padding_sec=clip.get("duration_padding_sec", STABLE_AUDIO_DEFAULT_DURATION_PADDING_S),
                        sampler_type=clip.get("sampler_type") or STABLE_AUDIO_DEFAULT_SAMPLER,
                        progress_callback=progress_cb,
                        stage_callback=stage_cb,
                        should_stop=should_stop,
                    )
                except StableAudioCancelled:
                    self.job_store.mark_cancelled(job.job_id)
                    return

            sound_data = {
                "id": clip["id"],
                "prompt": clip.get("prompt", ""),
                "prompt_index": clip.get("prompt_index", 0),
                "display_name": clip.get("display_name") or clip.get("prompt") or "audio",
                "url": f"{url_prefix}/{clip['filename']}",
                "duration": clip.get("duration", 8.0),
                "copy_index": clip.get("copy_index", 0),
                "total_copies": clip.get("total_copies", 1),
                "position": clip.get("position", [0, 0, 0]),
                "volume_dbfs": clip.get("dbfs", DEFAULT_DBFS),
                "interval_seconds": clip.get("interval_seconds", 0),
                "generation_mode": mode,
            }
            if clip.get("entity_index") is not None:
                sound_data["entity_index"] = clip["entity_index"]

            completed.append(sound_data)
            self.job_store.set_progress(
                job.job_id, int((done_idx + 1) / total_clips * 90), "Finalizing clip...", partial=completed
            )

            # Clip-level yielding — never let one multi-clip request starve others.
            if clips and self.job_store.redis.llen(self._queue_key) > 0:
                remaining_payload = dict(payload)
                remaining_payload["clips"] = clips
                remaining_payload["completed_sounds"] = completed
                remaining_payload["total_clips"] = total_clips
                self.job_store.requeue_tail(job.job_id, remaining_payload)
                print(
                    f"[sa3:{self.worker_id}] yielding job {job.job_id} "
                    f"({len(clips)} clip(s) left) — another session is waiting"
                )
                return

        self.job_store.complete(job.job_id, completed)
