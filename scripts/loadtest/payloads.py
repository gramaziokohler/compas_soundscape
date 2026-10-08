"""Request payload builders for the load test."""

from __future__ import annotations

import uuid

# Unique per run so prompt-level dedup/caching never short-circuits real work.
RUN_TAG = uuid.uuid4().hex[:6]

# ─── pyroomacoustics: 5 m x 4 m x 3 m box room (direct geometry, no Speckle) ──
_BOX_VERTS = [
    [0.0, 0.0, 0.0], [5.0, 0.0, 0.0], [5.0, 4.0, 0.0], [0.0, 4.0, 0.0],  # floor
    [0.0, 0.0, 3.0], [5.0, 0.0, 3.0], [5.0, 4.0, 3.0], [0.0, 4.0, 3.0],  # ceiling
]
_BOX_QUADS = [
    (0, 1, 2, 3), (4, 5, 6, 7),                              # floor, ceiling
    (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),  # walls
]


def _box_faces() -> list[list[int]]:
    faces: list[list[int]] = []
    for a, b, c, d in _BOX_QUADS:
        faces += [[a, b, c], [a, c, d]]
    return faces


def pyroom_box_payload(user_index: int) -> dict:
    faces = _box_faces()
    return {
        "vertices": _BOX_VERTS,
        "faces": faces,
        "face_groups": {"loadtest_walls": list(range(len(faces)))},
        "materials": {"loadtest_walls": {"absorption": 0.2, "scattering": 0.05}},
        "units": "m",
        "sources": [{"id": f"loadtest-src-{user_index}", "position": [1.0 + (user_index % 3) * 0.5, 1.0, 1.2]}],
        "receivers": [{"id": f"loadtest-rcv-{user_index}", "position": [3.5, 2.5, 1.5]}],
        "settings": {
            "max_order": 3,
            "ray_tracing": True,
            "air_absorption": True,
            "n_rays": 5000,
            "simulation_mode": "mono",
            "sound_speed": 343.0,
            "rir_duration": 1.0,
        },
        "simulation_name": f"loadtest-room-{user_index}",
    }


# ─── Text-to-audio generation ────────────────────────────────────────────────
def sound_generation_payload(user_index: int, audio_model: str | None) -> dict:
    payload: dict = {
        "sounds": [{
            "prompt": f"gentle rain on a tin roof, take {RUN_TAG}-{user_index}",
            "seed_copies": 1,
            "duration_seconds": 4,
            "steps": 20,
        }],
        "apply_denoising": False,
        "trim_silence": False,
    }
    if audio_model:  # omit → backend DEFAULT_AUDIO_MODEL (what real users get)
        payload["audio_model"] = audio_model
    return payload


# ─── LLM (SSE prompt generation) ─────────────────────────────────────────────
def llm_prompt_payload(user_index: int) -> dict:
    return {
        "context": f"Load test {RUN_TAG}-{user_index}: a busy urban square at rush hour with a fountain and a cafe.",
        "num_sounds": 3,
    }


# ─── Soundscape persistence ──────────────────────────────────────────────────
def soundscape_model_id(user_id: str) -> str:
    return f"loadtest-{user_id}"


def soundscape_save_payload(user_id: str, iteration: int, base_revision: int | None) -> dict:
    return {
        "soundscape_data": {
            "model_id": soundscape_model_id(user_id),
            "model_name": f"Load test {user_id} (save #{iteration})",
        },
        "audio_urls": [],
        "ir_urls": [],
        "analysis_ids": [],
        "scenario_ids": [],
        "base_revision": base_revision,
    }


# ─── Browsing ────────────────────────────────────────────────────────────────
BROWSE_GETS = (
    "/api/tts/dialects",
    "/api/pyroomacoustics/materials",
    "/api/choras/materials",
    "/api/impulse-responses",
    "/api/queue/status",
)
LIBRARY_QUERIES = ("rain", "footsteps", "birds", "traffic", "crowd", "wind")


def library_search_payload(query: str) -> dict:
    return {"prompt": query, "max_results": 5}
