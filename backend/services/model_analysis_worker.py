"""
3D model analysis subprocess worker.

Runs as a subprocess via multiprocessing.Process.  Reports progress via
atomic JSON file writes to avoid GIL-starvation issues.

Progress file  (temp_dir/model_analysis_progress_{analysis_id}.json):
    {"value": 0-100, "status": "<human text>"}

Result file  (temp_dir/model_analysis_result_{analysis_id}.json):
    {"type": "done",  "result": {"objects": [...], "space_description": "..."}}
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

from config.constants import DEFAULT_LLM_MODEL


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


def _normalize_objects(raw: list) -> list[dict]:
    """Clamp and coerce raw object dicts from the LLM into consistent types."""
    out = []
    for obj in raw:
        if not isinstance(obj, dict):
            continue
        try:
            # object_ids comes in as dict[str, dict] (already resolved by analyze_3dmodel)
            # or as list[str] (legacy / fallback — convert to empty-bounds dict)
            raw_oids = obj.get("object_ids", {})
            if isinstance(raw_oids, dict):
                object_ids: dict[str, dict] = {
                    str(k): v if isinstance(v, dict) else {}
                    for k, v in raw_oids.items()
                }
            else:
                object_ids = {str(x): {} for x in raw_oids}

            out.append({
                "name":        str(obj.get("name", "Unknown")),
                "description": str(obj.get("description", "")),
                "material":    str(obj.get("material", "")),
                "quantity":    max(1, int(obj.get("quantity", 1))),
                "object_ids":  object_ids,
            })
        except (ValueError, TypeError):
            continue
    return out

def run_model_analysis(
    analysis_id: str,
    progress_file: str,
    result_file: str,
    entities: list[dict],
    screenshots: Optional[list[str]],
    user_context: Optional[str],
    llm_model: str = DEFAULT_LLM_MODEL,
    api_keys: Optional[dict] = None,
) -> None:
    """
    Full 3D model analysis pipeline, runs in a subprocess.

    Calls LLMService.analyze_3dmodel() directly.
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

        screenshot_count = len(screenshots) if screenshots else 0
        _write_progress(
            progress_file,
            20,
            f"Analyzing {len(entities)} objects"
            + (f" with {screenshot_count} screenshot(s)" if screenshot_count else " (metadata only)")
            + "...",
        )

        raw_result = llm.analyze_3dmodel(
            entities=entities,
            screenshots=screenshots,
            user_context=user_context,
            llm_model=llm_model,
        )
        # object_ids are already resolved and filled with bounds by analyze_3dmodel.
        objects = _normalize_objects(raw_result.get("objects", []))
        space_description = raw_result.get("space_description", "")

        _write_progress(progress_file, 95, "Finalizing...")

        result_payload = {
            "objects":           objects,
            "space_description": space_description,
        }
        _write_result(result_file, {"type": "done", "result": result_payload})

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[model_analysis_worker] Error: {exc}\n{tb}", file=sys.stderr)
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
