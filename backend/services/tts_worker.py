"""
TTS generation subprocess worker.

Runs as a subprocess via multiprocessing.Process.  Reports progress via
atomic JSON file writes.

Progress file  (temp_dir/tts_progress_{generation_id}.json):
    {"value": 0-100, "status": "<human text>", "partial_sounds": [...]}

Result file  (temp_dir/tts_result_{generation_id}.json):
    {"type": "done",  "result": [...]}
 or {"type": "error", "message": "<str>"}
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback

import torch
import torchaudio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import Optional

from services.tts_service import TTSService
from utils.audio_processing import (
    apply_dbfs_calibration,
    normalize_audio_rms,
)
from config.constants import (
    TTS_DEFAULT_VOICE,
    TTS_OUTPUT_URL_PREFIX,
    DEFAULT_TTS_MODEL,
    FILENAME_MAX_LENGTH,
    WINDOWS_ILLEGAL_FILENAME_CHARS,
    DEFAULT_DBFS,
    TARGET_RMS,
)


def _atomic_replace(tmp: str, dest: str, retries: int = 5, delay: float = 0.05) -> None:
    """os.replace() can raise PermissionError on Windows when the destination
    is transiently locked by a reader.  Retry a few times before giving up."""
    import time
    for attempt in range(retries):
        try:
            os.replace(tmp, dest)
            return
        except PermissionError:
            if attempt == retries - 1:
                raise
            time.sleep(delay)


def _write_progress(progress_file: str, value: int, status: str, completed: list | None = None) -> None:
    tmp = progress_file + ".tmp"
    data: dict = {"value": value, "status": status}
    if completed is not None:
        data["partial_sounds"] = completed
    with open(tmp, "w") as f:
        json.dump(data, f)
    _atomic_replace(tmp, progress_file)


def _write_result(result_file: str, payload: dict) -> None:
    tmp = result_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    _atomic_replace(tmp, result_file)


def _calibrate_wav_to_dbfs(input_path: str, target_dbfs: float) -> None:
    """Normalize RMS then apply dBFS calibration to a WAV in place.

    Mirrors the TangoFlux/AudioLDM2 and /api/calibrate-audio post-processing so
    TTS speech sits at the same dBFS anchor as every other sound mode — without
    it, ``volume_dbfs`` would claim a level the file never received.
    """
    import soundfile as sf

    audio_np, sample_rate = sf.read(input_path)
    if audio_np.ndim > 1:
        audio_np = audio_np.mean(axis=1)
    audio_tensor = torch.from_numpy(audio_np).float().unsqueeze(0)
    audio_tensor = normalize_audio_rms(audio_tensor, target_rms=TARGET_RMS)
    audio_tensor = apply_dbfs_calibration(audio_tensor, target_dbfs=target_dbfs)
    torchaudio.save(input_path, audio_tensor.cpu(), sample_rate)
    print(
        f"[tts_worker] Calibrated {os.path.basename(input_path)} -> {target_dbfs} dBFS",
        file=sys.stderr, flush=True,
    )


def run_tts_generation(
    generation_id: str,
    progress_file: str,
    result_file: str,
    texts: list,
    output_dir: str,
    url_prefix: str = TTS_OUTPUT_URL_PREFIX,
    language: Optional[str] = None,
    tts_model: str = DEFAULT_TTS_MODEL,
) -> None:
    try:
        os.makedirs(output_dir, exist_ok=True)

        tts_service = TTSService()

        completed_sounds: list[dict] = []
        errors: list[str] = []
        n_total = len(texts)

        print(f"[tts_worker] Starting — {n_total} item(s)", file=sys.stderr, flush=True)
        for i, item in enumerate(texts):
            print(
                f"[tts_worker] item[{i}]: text={repr(item.get('text') or '')!r} "
                f"voice={item.get('voice_name')!r} "
                f"prompt_index={item.get('prompt_index')!r} "
                f"speech_card_index={item.get('speech_card_index')!r}",
                file=sys.stderr, flush=True,
            )

        voice_counters: dict[str, int] = {}

        for idx, item in enumerate(texts):
            text = (item.get("text") or "").strip()
            voice_name = item.get("voice_name", TTS_DEFAULT_VOICE)
            display_name = item.get("display_name") or text

            # Use the caller-supplied config index + variant index when present so
            # variant grouping survives any filtering/re-indexing of this flat list.
            # Mirrors the text-to-audio flow (sounds_worker) which echoes these back.
            prompt_index = item.get("prompt_index", idx)
            copy_index = item.get("copy_index", 0)
            total_copies = item.get("total_copies", 1)

            voice_counters[voice_name] = voice_counters.get(voice_name, 0) + 1
            voice_num = voice_counters[voice_name]

            if not text:
                _write_progress(
                    progress_file,
                    int(idx / n_total * 100) if n_total else 0,
                    f"Speech {idx + 1}/{n_total}: skipped (empty text)",
                    completed_sounds,
                )
                continue

            display_short = display_name[:30]
            _write_progress(
                progress_file,
                int(idx / n_total * 100) if n_total else 0,
                f"Generating speech {idx + 1}/{n_total} ({display_short})...",
                completed_sounds,
            )

            short_name = text[:FILENAME_MAX_LENGTH]
            for char in WINDOWS_ILLEGAL_FILENAME_CHARS:
                short_name = short_name.replace(char, "_")
            short_name = short_name.replace(" ", "_")

            if not short_name:
                short_name = "speech"

            filename = f"tts_{voice_name}_{voice_num}_{short_name}.wav"
            output_path = os.path.normpath(os.path.join(output_dir, filename))

            try:
                # Retry with exponential backoff: the Gemini TTS API can return
                # 400 INVALID_ARGUMENT or empty content when rate-limited (rather
                # than a clean 429).  Wait before retrying so the quota resets.
                MAX_RETRIES = 4
                RETRY_DELAYS = [3, 6, 12, 24]  # seconds between attempts
                last_exc: Exception | None = None
                real_duration_seconds: float = 5.0
                for attempt in range(MAX_RETRIES):
                    if attempt > 0:
                        delay = RETRY_DELAYS[attempt - 1]
                        print(
                            f"[tts_worker] item[{idx}] retry {attempt}/{MAX_RETRIES - 1} "
                            f"after {delay}s (prev error: {last_exc})",
                            file=sys.stderr, flush=True,
                        )
                        time.sleep(delay)
                    try:
                        _, real_duration_seconds = tts_service.generate_speech(
                            text=text,
                            output_path=output_path,
                            voice_name=voice_name,
                            language=language,
                            model=tts_model or DEFAULT_TTS_MODEL,
                        )
                        print(
                            f"copy_index={copy_index} voice={voice_name!r} "
                            f"real_duration_seconds={real_duration_seconds:.3f}",
                            file=sys.stderr, flush=True,
                        )
                        last_exc = None
                        break  # success
                    except Exception as exc:
                        last_exc = exc
                if last_exc is not None:
                    raise last_exc

                # Calibrate the raw TTS WAV to the requested dBFS so the reported
                # volume_dbfs is truthful. Runs inside the outer try — a calibration
                # failure fails the item instead of claiming a level the file lacks.
                dbfs = item.get("dbfs", DEFAULT_DBFS)
                _calibrate_wav_to_dbfs(output_path, dbfs)
            except Exception as exc:
                print(f"[tts_worker] item[{idx}] FAILED: {exc}", file=sys.stderr, flush=True)
                errors.append(f"{display_short}: {exc}")
                _write_progress(
                    progress_file,
                    int((idx + 1) / n_total * 100) if n_total else 100,
                    f"Speech {idx + 1}/{n_total}: failed — {exc}",
                    completed_sounds,
                )
                continue

            position = item.get("position", [0, 0, 0])

            voice_display = f"{voice_name} speech {voice_num}"

            sound_data: dict = {
                "id": f"tts_{prompt_index}_{copy_index}_{voice_name}",
                "prompt": text,
                "prompt_index": prompt_index,
                "copy_index": copy_index,
                "total_copies": total_copies,
                # Echo back the original card index for speech lines so the frontend
                # can look up the correct SoundGenerationConfig via speech_card_index.
                "speech_card_index": item.get("speech_card_index"),
                "display_name": voice_display,
                "url": f"{url_prefix}/{filename}",
                # Real measured length of the generated clip — NOT a nominal/
                # placeholder guess. The frontend's bakeOrchestrateSchedule uses
                # this to space out dependent sounds/dialogue via after()/
                # alignEnd() links, so it must reflect the actual audio length.
                "duration": round(real_duration_seconds, 3),
                "position": position,
                "volume_dbfs": dbfs,
                "voice_name": voice_name,
            }
            print(
                f"duration={sound_data['duration']} prompt_index={prompt_index} copy_index={copy_index}",
                file=sys.stderr, flush=True,
            )
            completed_sounds.append(sound_data)
            # Brief pause after each successful call so the Gemini TTS quota
            # has time to recover before the next request.
            if idx < n_total - 1:
                time.sleep(2)

        # Consistency with the text-to-audio flow (sounds_worker): if nothing could
        # be generated, surface the failure instead of returning an empty "done"
        # result (which the frontend would render as "nothing generated").
        if not completed_sounds and errors:
            _write_result(
                result_file,
                {"type": "error", "message": "TTS generation failed — " + "; ".join(errors[:3])},
            )
            return

        _write_progress(progress_file, 98, "Finalizing...", completed_sounds)
        _write_result(result_file, {"type": "done", "result": completed_sounds})

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[tts_worker] Error: {exc}\n{tb}", file=sys.stderr)
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
