"""
LLM generation subprocess worker.

Runs as a subprocess via multiprocessing.Process.  Reports progress via
atomic JSON file writes to avoid GIL-starvation issues.

Progress file  (temp_dir/llm_progress_{generation_id}.json):
    {"value": 0-100, "status": "<human text>"}

Result file  (temp_dir/llm_result_{generation_id}.json):
    {"type": "done",  "result": {text, sounds, prompts, selected_entities}}
 or {"type": "error", "message": "<str>", "traceback": "<str>"}
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Optional

# Ensure absolute imports work when run as __main__
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.constants import DEFAULT_SPL_DB, LLM_SUGGESTED_INTERVAL_SECONDS, DEFAULT_LLM_MODEL


def _write_progress(progress_file: str, value: int, status: str) -> None:
    """Atomically write progress JSON via temp-file + os.replace()."""
    tmp = progress_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"value": value, "status": status}, f)
    os.replace(tmp, progress_file)


def _write_result(result_file: str, payload: dict) -> None:
    """Atomically write the final result/error JSON."""
    tmp = result_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, result_file)


def run_llm_generation(
    generation_id: str,
    progress_file: str,
    result_file: str,
    prompt: Optional[str],
    num_sounds: int,
    entities: Optional[list],
    llm_model: str = DEFAULT_LLM_MODEL,
    api_keys: Optional[dict] = None,
) -> None:
    """
    Full LLM generation pipeline, runs in a subprocess.

    Calls LLMService directly (same logic as the /api/generate-text endpoint).
    Progress is reported via atomic JSON file writes; result/error is written
    to result_file on exit.
    """
    try:
        # Apply runtime-injected API keys before any client is created
        if api_keys:
            for env_key, env_val in api_keys.items():
                if env_val:
                    os.environ[env_key] = env_val

        from services.llm_service import LLMService, GOOGLE_GENAI_AVAILABLE
        from config.constants import LLM_MODEL_OPENAI, LLM_MODEL_ANTHROPIC

        _write_progress(progress_file, 5, f"Initializing LLM client ({llm_model})...")

        if llm_model not in (LLM_MODEL_OPENAI, LLM_MODEL_ANTHROPIC) and GOOGLE_GENAI_AVAILABLE:
            import google.genai as genai
            client = genai.Client()
        else:
            client = None

        llm = LLMService(client=client)

        if entities and len(entities) > 0:
            entity_count = len(entities)
            _write_progress(
                progress_file,
                20,
                f"Generating {num_sounds} sound prompts for {entity_count} entities...",
            )
            sound_list = llm.generate_prompts_for_entities(
                entities,
                num_sounds,
                prompt,
                llm_model=llm_model,
            )

            _write_progress(progress_file, 80, "Processing entity prompts...")

            entity_prompts = []
            for sound_data in sound_list:
                entity_idx = sound_data.get("entity_index")
                entity_data = None
                if entity_idx is not None and 0 <= entity_idx < len(entities):
                    entity_data = entities[entity_idx]

                entity_prompts.append({
                    "entity": entity_data,
                    "prompt": sound_data["prompt"],
                    "display_name": sound_data["display_name"],
                    "spl_db": sound_data.get("spl_db", DEFAULT_SPL_DB),
                    "interval_seconds": sound_data.get("interval_seconds", LLM_SUGGESTED_INTERVAL_SECONDS),
                    "duration_seconds": sound_data.get("duration_seconds", 5.0),
                })

            _write_progress(progress_file, 95, "Finalizing...")
            result_payload = {
                "text": "\n".join(
                    f"{i + 1}. {p['prompt']}" for i, p in enumerate(entity_prompts)
                ),
                "sounds": [p["prompt"] for p in entity_prompts],
                "prompts": entity_prompts,
                "selected_entities": entities,
            }

        elif prompt and prompt.strip():
            _write_progress(progress_file, 20, "Generating sound prompts from description...")
            raw_text, sound_list = llm.generate_text_based_prompts(prompt, num_sounds, llm_model=llm_model)

            _write_progress(progress_file, 90, "Processing response...")
            result_payload = {
                "text": raw_text,
                "sounds": [s["prompt"] for s in sound_list],
                "prompts": sound_list,
                "selected_entities": None,
            }

        else:
            raise ValueError("Either prompt or entities must be provided")

        _write_result(result_file, {"type": "done", "result": result_payload})

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[llm_worker] Error: {exc}\n{tb}", file=sys.stderr)
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
