"""
Schema round trip of the saved Object Explorer view on simulation cards
(`saved_object_visibility`). Without the field on the Pydantic model the backend
would silently drop it on save. Scenes carry it inside the free-form
`analysis_state` dict, so they need no schema change.

Run: pytest backend/tests/test_saved_object_visibility.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from models.schemas import SoundscapeSimulationConfig  # noqa: E402


def _sim(**extra):
    return {"id": "sim-1", "display_name": "Sim", "type": "pyroomacoustics", **extra}


def test_saved_object_visibility_round_trips():
    view = {"hidden_ids": ["a", "b"], "isolated_ids": ["c"], "excluded_ids": ["d"]}
    cfg = SoundscapeSimulationConfig(**_sim(saved_object_visibility=view))
    assert cfg.model_dump()["saved_object_visibility"] == view
    again = SoundscapeSimulationConfig(**cfg.model_dump())
    assert again.saved_object_visibility is not None
    assert again.saved_object_visibility.hidden_ids == ["a", "b"]


def test_saved_object_visibility_is_optional():
    cfg = SoundscapeSimulationConfig(**_sim())
    assert cfg.saved_object_visibility is None
