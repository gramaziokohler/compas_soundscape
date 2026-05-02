"""
Sound generation subprocess worker.

Runs as a subprocess via multiprocessing.Process.  Reports progress via
atomic JSON file writes to avoid GIL-starvation issues in diffusion loops.

Progress file  (temp_dir/sound_progress_{generation_id}.json):
    {"value": 0-100, "status": "<human text>", "partial_sounds": [...]}

Result file  (temp_dir/sound_result_{generation_id}.json):
    {"type": "done",  "result": [...]}
 or {"type": "error", "message": "<str>"}
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import traceback

# Ensure absolute imports work when run as __main__
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.audio_service import AudioService
from config.constants import (
    AUDIO_MODEL_AUDIOLDM2,
    DEFAULT_SPL_DB,
    DEFAULT_DURATION_SECONDS,
    DEFAULT_GUIDANCE_SCALE,
    DEFAULT_DIFFUSION_STEPS,
    DEFAULT_SEED_COPIES,
    DEFAULT_INTERVAL_BETWEEN_SOUNDS,
    GENERATED_SOUND_URL_PREFIX,
    GENERATED_SOUNDS_DIR,
    FILENAME_MAX_LENGTH,
    PARAM_HASH_LENGTH,
    WINDOWS_ILLEGAL_FILENAME_CHARS,
)


def _write_progress(
    progress_file: str,
    value: int,
    status: str,
    completed_sounds: list | None = None,
) -> None:
    """Atomically write progress JSON via temp-file + os.replace()."""
    tmp = progress_file + ".tmp"
    data: dict = {"value": value, "status": status}
    if completed_sounds is not None:
        data["partial_sounds"] = completed_sounds
    with open(tmp, "w") as f:
        json.dump(data, f)
    # On Windows, os.replace can raise PermissionError if the reader has the
    # target file open at the same instant — retry briefly to ride out the race.
    for attempt in range(10):
        try:
            os.replace(tmp, progress_file)
            break
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.02)


def _write_result(result_file: str, payload: dict) -> None:
    """Atomically write the final result/error JSON."""
    tmp = result_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, result_file)


def run_sound_generation(
    generation_id: str,
    progress_file: str,
    result_file: str,
    sound_configs: list,
    apply_denoising: bool,
    audio_model: str,
    output_dir: str,
    base_spl_db: float = None,
) -> None:
    """
    Full sound generation pipeline, runs in a subprocess.

    Iterates over sound_configs and generates each sound file.  Progress is
    reported via atomic JSON file writes; result/error is written to
    result_file on exit.  Output metadata mirrors AudioService.generate_multiple_sounds().
    """
    try:
        os.makedirs(output_dir, exist_ok=True)

        audio_service = AudioService()

        completed_sounds: list[dict] = []
        n_total = sum(cfg.get("seed_copies", DEFAULT_SEED_COPIES) for cfg in sound_configs)
        current = 0

        for idx, cfg in enumerate(sound_configs):
            prompt = cfg.get("prompt", "")
            duration = cfg.get("duration_seconds") or cfg.get("duration", DEFAULT_DURATION_SECONDS)
            guidance_scale = cfg.get("guidance_scale", DEFAULT_GUIDANCE_SCALE)
            seed_copies = cfg.get("seed_copies", DEFAULT_SEED_COPIES)
            steps = cfg.get("steps", DEFAULT_DIFFUSION_STEPS)
            spl_db = cfg.get("spl_db") or base_spl_db or DEFAULT_SPL_DB
            interval_seconds = cfg.get("interval_seconds", DEFAULT_INTERVAL_BETWEEN_SOUNDS)
            negative_prompt = cfg.get("negative_prompt", "")

            if not prompt:
                current += seed_copies
                continue

            # Replicate filename logic from AudioService.generate_multiple_sounds
            short_prompt = prompt[:FILENAME_MAX_LENGTH]
            for char in WINDOWS_ILLEGAL_FILENAME_CHARS:
                short_prompt = short_prompt.replace(char, "_")
            short_prompt = short_prompt.replace(" ", "_")

            display_name = cfg.get("display_name") or prompt

            param_string = f"{prompt}_{duration}_{guidance_scale}_{steps}_{apply_denoising}_{audio_model}"
            param_hash = hashlib.md5(param_string.encode()).hexdigest()[:PARAM_HASH_LENGTH]

            for copy_idx in range(seed_copies):
                display_short = display_name[:30]
                _write_progress(
                    progress_file,
                    int(current / n_total * 90),
                    f"Generating sound {current + 1}/{n_total} ({display_short})...",
                    completed_sounds,
                )

                filename = f"{short_prompt}_{param_hash}_copy{copy_idx}.wav"
                output_path = os.path.normpath(os.path.join(output_dir, filename))

                entity = cfg.get("entity")
                if entity and entity.get("position"):
                    position = entity["position"]
                    entity_index = entity.get("index")
                else:
                    position = [0, 0, 0]
                    entity_index = None

                # Skip if identical parameters already exist
                if os.path.exists(output_path):
                    print(f"Sound already exists, skipping: {filename}")
                else:
                    def step_cb(
                        step: int,
                        total: int,
                        _cur: int = current,
                        _n: int = n_total,
                        _d: str = display_short,
                    ) -> None:
                        _write_progress(
                            progress_file,
                            int((_cur + step / total) / _n * 90),
                            f"Generating sound {_cur + 1}/{_n} ({_d}): step {step}/{total}...",
                            completed_sounds,
                        )

                    if audio_model == AUDIO_MODEL_AUDIOLDM2:
                        audioldm2 = audio_service._init_audioldm2_service()
                        audioldm2.generate_sound_file(
                            prompt=prompt,
                            output_path=output_path,
                            duration=duration,
                            guidance_scale=guidance_scale,
                            steps=steps,
                            spl_db=spl_db,
                            apply_denoising=apply_denoising,
                            negative_prompt=negative_prompt or "Low quality, distorted",
                            progress_callback=step_cb,
                        )
                    else:
                        audio_service.generate_sound_file(
                            prompt=prompt,
                            output_path=output_path,
                            duration=duration,
                            guidance_scale=guidance_scale,
                            steps=steps,
                            spl_db=spl_db,
                            apply_denoising=apply_denoising,
                            audio_model=audio_model,
                            negative_prompt=negative_prompt,
                            progress_callback=step_cb,
                        )

                sound_data: dict = {
                    "id": f"generated_{idx}_{copy_idx}",
                    "prompt": prompt,
                    "prompt_index": idx,
                    "display_name": display_name,
                    "url": f"{GENERATED_SOUND_URL_PREFIX}/{filename}",
                    "duration": duration,
                    "copy_index": copy_idx,
                    "total_copies": seed_copies,
                    "position": position,
                    "volume_db": spl_db,
                    "interval_seconds": interval_seconds,
                }
                if entity_index is not None:
                    sound_data["entity_index"] = entity_index

                completed_sounds.append(sound_data)
                current += 1

        _write_progress(progress_file, 98, "Finalizing...", completed_sounds)
        _write_result(result_file, {"type": "done", "result": completed_sounds})

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[sounds_worker] Error: {exc}\n{tb}", file=sys.stderr)
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
