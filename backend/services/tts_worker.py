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
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.tts_service import TTSService
from config.constants import (
    TTS_DEFAULT_VOICE,
    TTS_OUTPUT_URL_PREFIX,
    FILENAME_MAX_LENGTH,
    WINDOWS_ILLEGAL_FILENAME_CHARS,
)


def _write_progress(progress_file: str, value: int, status: str, completed: list | None = None) -> None:
    tmp = progress_file + ".tmp"
    data: dict = {"value": value, "status": status}
    if completed is not None:
        data["partial_sounds"] = completed
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, progress_file)


def _write_result(result_file: str, payload: dict) -> None:
    tmp = result_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, result_file)


def run_tts_generation(
    generation_id: str,
    progress_file: str,
    result_file: str,
    texts: list,
    output_dir: str,
    url_prefix: str = TTS_OUTPUT_URL_PREFIX,
) -> None:
    try:
        os.makedirs(output_dir, exist_ok=True)

        tts_service = TTSService()

        completed_sounds: list[dict] = []
        errors: list[str] = []
        n_total = len(texts)

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
                tts_service.generate_speech(
                    text=text,
                    output_path=output_path,
                    voice_name=voice_name,
                )
            except Exception as exc:
                errors.append(f"{display_short}: {exc}")
                _write_progress(
                    progress_file,
                    int((idx + 1) / n_total * 100) if n_total else 100,
                    f"Speech {idx + 1}/{n_total}: failed — {exc}",
                    completed_sounds,
                )
                continue

            position = item.get("position", [0, 0, 0])
            spl_db = item.get("spl_db", 70)

            voice_display = f"{voice_name} speech {voice_num}"

            sound_data: dict = {
                "id": f"tts_{prompt_index}_{copy_index}_{voice_name}",
                "prompt": text,
                "prompt_index": prompt_index,
                "copy_index": copy_index,
                "total_copies": total_copies,
                "display_name": voice_display,
                "url": f"{url_prefix}/{filename}",
                "duration": item.get("duration", 5),
                "position": position,
                "volume_db": spl_db,
                "voice_name": voice_name,
            }
            completed_sounds.append(sound_data)

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
