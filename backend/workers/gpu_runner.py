"""
GPU worker runner — resident TangoFlux model, one clip-generation lane per process.

Design (see .cursor/plans/multi-user_distributed_backend_a4752c5d.plan.md §4.2):
  - The model is loaded once at process startup (paid once, not per-request) and
    warmed up with a throwaway 1s generation so the first real user pays nothing.
  - Cooperative cancel: should_stop() is polled once per diffusion step inside
    TangoFlux's inference_flow (see tangoflux/model.py GenerationCancelled).
  - Clip-level yielding: a multi-clip job re-queues its remaining clips under the
    same job_id (tail of queue:gpu) after finishing the current clip whenever
    another job is already waiting, so no single request can starve others for
    more than one clip's generation time.
"""
from __future__ import annotations

import os
import tempfile
import threading
import time

from services.audio_service import AudioService
from services.job_store import Job, WorkerJobStore
from utils.audio_processing import compute_noise_trim_region_from_file
from tangoflux.model import GenerationCancelled
from config.constants import (
    DEFAULT_AUDIO_MODEL,
    DEFAULT_DBFS,
    DEFAULT_GUIDANCE_SCALE,
    JOB_TYPE_SOUND,
    JOB_TYPE_QUEUE,
    TANGOFLUX_WARMUP_DURATION_SECONDS,
    TANGOFLUX_WARMUP_STEPS,
)


class GpuRunner:
    def __init__(self, job_store: WorkerJobStore, state, worker_id: str):
        self.job_store = job_store
        self.state = state
        self.worker_id = worker_id
        self.audio_service: AudioService | None = None
        self._queue_key = JOB_TYPE_QUEUE[JOB_TYPE_SOUND]

    def _ensure_model_loaded(self) -> None:
        if self.audio_service is not None:
            return
        print(f"[gpu:{self.worker_id}] loading TangoFlux model (resident)...")
        self.audio_service = AudioService()
        self.audio_service._init_tangoflux_model()

        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        try:
            t0 = time.time()
            self.audio_service.generate_sound_file(
                prompt="warm up",
                output_path=tmp.name,
                duration=TANGOFLUX_WARMUP_DURATION_SECONDS,
                guidance_scale=DEFAULT_GUIDANCE_SCALE,
                steps=TANGOFLUX_WARMUP_STEPS,
                dbfs=DEFAULT_DBFS,
                apply_denoising=False,
                audio_model=DEFAULT_AUDIO_MODEL,
            )
            print(f"[gpu:{self.worker_id}] warm-up generation done in {time.time() - t0:.1f}s")
        except Exception as exc:
            print(f"[gpu:{self.worker_id}] warm-up generation failed (non-fatal): {exc}")
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    def run_forever(self, shutdown: threading.Event) -> None:
        self._ensure_model_loaded()
        print(f"[gpu:{self.worker_id}] ready, leasing from {self._queue_key}")
        while not shutdown.is_set():
            try:
                job = self.job_store.lease([self._queue_key], timeout=5)
            except Exception as exc:
                print(f"[gpu:{self.worker_id}] lease error: {exc}")
                time.sleep(2)
                continue
            if job is None:
                continue
            self.state.start_job(job.job_id)
            try:
                self._run_job(job)
            except Exception as exc:
                print(f"[gpu:{self.worker_id}] job {job.job_id} failed: {exc}")
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
        apply_denoising = bool(payload.get("apply_denoising", False))
        trim_silence = bool(payload.get("trim_silence", False))
        audio_model = payload.get("audio_model", DEFAULT_AUDIO_MODEL)

        os.makedirs(output_dir, exist_ok=True)

        while clips:
            if self.job_store.is_cancel_requested(job.job_id) or self.state.should_stop(job.job_id):
                self.job_store.mark_cancelled(job.job_id)
                return

            clip = clips.pop(0)
            done_idx = total_clips - len(clips) - 1
            display_short = (clip.get("display_name") or clip["prompt"])[:30]
            output_path = os.path.normpath(os.path.join(output_dir, clip["filename"]))

            def progress_cb(step, total, _idx=done_idx, _n=total_clips, _d=display_short):
                pct = int((_idx + step / total) / _n * 90)
                self.job_store.set_progress(
                    job.job_id, pct,
                    f"Generating sound {_idx + 1}/{_n} ({_d}): step {step}/{total}...",
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
                print(f"[gpu:{self.worker_id}] sound already exists, skipping: {clip['filename']}")
            else:
                try:
                    self.audio_service.generate_sound_file(
                        prompt=clip["prompt"],
                        output_path=output_path,
                        duration=clip["duration"],
                        guidance_scale=clip["guidance_scale"],
                        steps=clip["steps"],
                        dbfs=clip["dbfs"],
                        apply_denoising=apply_denoising,
                        audio_model=audio_model,
                        negative_prompt=clip.get("negative_prompt", ""),
                        progress_callback=progress_cb,
                        stage_callback=stage_cb,
                        should_stop=should_stop,
                    )
                except GenerationCancelled:
                    self.job_store.mark_cancelled(job.job_id)
                    return

            sound_data = {
                "id": clip["id"],
                "prompt": clip["prompt"],
                "prompt_index": clip["prompt_index"],
                "display_name": clip.get("display_name") or clip["prompt"],
                "url": f"{url_prefix}/{clip['filename']}",
                "duration": clip["duration"],
                "copy_index": clip["copy_index"],
                "total_copies": clip["total_copies"],
                "position": clip.get("position", [0, 0, 0]),
                "volume_dbfs": clip["dbfs"],
                "interval_seconds": clip.get("interval_seconds", 0),
            }
            if clip.get("entity_index") is not None:
                sound_data["entity_index"] = clip["entity_index"]
            if trim_silence:
                sound_data["noise_trim"] = compute_noise_trim_region_from_file(output_path)

            completed.append(sound_data)
            self.job_store.set_progress(
                job.job_id, int((done_idx + 1) / total_clips * 90), "Finalizing clip...", partial=completed
            )

            # Clip-level yielding — don't let one multi-clip job starve other sessions.
            if clips and self.job_store.redis.llen(self._queue_key) > 0:
                remaining_payload = dict(payload)
                remaining_payload["clips"] = clips
                remaining_payload["completed_sounds"] = completed
                remaining_payload["total_clips"] = total_clips
                self.job_store.requeue_tail(job.job_id, remaining_payload)
                print(
                    f"[gpu:{self.worker_id}] yielding job {job.job_id} "
                    f"({len(clips)} clip(s) left) — another session is waiting"
                )
                return

        self.job_store.complete(job.job_id, completed)
