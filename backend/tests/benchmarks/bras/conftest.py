"""BRAS benchmark: import paths, marker, the scene fixture (BRAS_SCENE, inputs linked in scenes.py)."""
import sys
from pathlib import Path

_TESTS = Path(__file__).resolve().parents[2]   # backend/tests
_BACKEND = _TESTS.parent                         # backend/
for _p in (str(_BACKEND), str(_TESTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import pytest  # noqa: E402


def pytest_configure(config):
    config.addinivalue_line("markers", "bras_benchmark: BRAS reference-scene benchmark of PFFDTD (BRAS data, GPU)")


@pytest.fixture(scope="session")
def scene_data():
    from benchmarks.bras.bras_benchmark import load_scene
    from benchmarks.bras.scenes import get_scene, missing_inputs

    scene = get_scene()
    missing = missing_inputs(scene)
    if missing:
        pytest.skip(f"{scene.name}: inputs missing (link them in scenes.py): {[str(p) for p in missing]}")
    return load_scene(scene)
