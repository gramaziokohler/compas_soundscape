# backend/tests/test_custom_materials.py
"""User-defined acoustic materials: SQLite CRUD + isolation, schema validation,
and inlining of custom ids into simulation material maps."""

import json
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from config.constants import CUSTOM_MATERIAL_CENTER_FREQS  # noqa: E402
from models.schemas import CustomMaterialInput  # noqa: E402
from services.custom_materials_service import inline_custom_materials, to_api  # noqa: E402
from services.metadata_store import MetadataStore  # noqa: E402

COEFFS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]
FREQS_JSON = json.dumps(CUSTOM_MATERIAL_CENTER_FREQS)


@pytest.fixture
def store(tmp_path):
    s = MetadataStore(db_path=str(tmp_path / "app.db"))
    s.init_db()
    return s


def test_crud_is_scoped_to_user(store):
    row = store.create_user_material("alice", "user_a", "Foam", "", json.dumps(COEFFS), FREQS_JSON)
    assert row["id"] == "user_a"
    assert [r["id"] for r in store.list_user_materials("alice")] == ["user_a"]
    assert store.list_user_materials("bob") == []

    # Another user can neither read, update nor delete it.
    assert store.get_user_material("bob", "user_a") is None
    assert store.update_user_material("bob", "user_a", "X", "", json.dumps(COEFFS)) is None
    assert store.delete_user_material("bob", "user_a") is None

    updated = store.update_user_material("alice", "user_a", "Thick foam", "d", json.dumps([0.9] * 7))
    assert updated["name"] == "Thick foam"
    assert store.count_user_materials("alice") == 1
    assert store.delete_user_material("alice", "user_a")["id"] == "user_a"
    assert store.list_user_materials("alice") == []


def test_to_api_computes_mean_absorption(store):
    row = store.create_user_material("alice", "user_a", "Foam", "", json.dumps(COEFFS), FREQS_JSON)
    material = to_api(row)
    assert material.absorption == pytest.approx(sum(COEFFS) / len(COEFFS))
    assert material.center_freqs == CUSTOM_MATERIAL_CENTER_FREQS
    assert material.category == "Custom"


@pytest.mark.parametrize("coeffs", [[0.5] * 6, [0.5] * 6 + [1.2], [-0.1] + [0.5] * 6])
def test_input_rejects_bad_coeffs(coeffs):
    with pytest.raises(ValidationError):
        CustomMaterialInput(name="Foam", coeffs=coeffs)


def test_input_rejects_blank_name():
    with pytest.raises(ValidationError):
        CustomMaterialInput(name="   ", coeffs=COEFFS)


def test_inline_replaces_only_custom_ids():
    custom = json.dumps({"user_a": {"coeffs": COEFFS, "center_freqs": CUSTOM_MATERIAL_CENTER_FREQS}})
    resolved = inline_custom_materials({"o1": "user_a", "o2": "hard_surface"}, custom)
    assert resolved["o2"] == "hard_surface"
    assert resolved["o1"] == {"id": "user_a", "coeffs": COEFFS, "center_freqs": CUSTOM_MATERIAL_CENTER_FREQS}


def test_inline_unknown_custom_id_is_400():
    with pytest.raises(HTTPException) as exc:
        inline_custom_materials({"o1": "user_missing"}, "{}")
    assert exc.value.status_code == 400


def test_inline_invalid_definition_is_400():
    custom = json.dumps({"user_a": {"coeffs": [2.0], "center_freqs": [1000]}})
    with pytest.raises(HTTPException) as exc:
        inline_custom_materials({"o1": "user_a"}, custom)
    assert exc.value.status_code == 400


def test_room_builder_accepts_inlined_material():
    pytest.importorskip("pyroomacoustics")
    from services.pyroomacoustics_room_builder import _absorption_bands

    absorption, _scattering = _absorption_bands(
        {"id": "user_a", "coeffs": COEFFS, "center_freqs": CUSTOM_MATERIAL_CENTER_FREQS}, 7,
    )
    assert absorption == pytest.approx(COEFFS)
