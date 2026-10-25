"""pytest config for the PFFDTD validation suite (run inside the compas-pffdtd env).

    cd backend
    python -m pytest pffdtd_backend/validation -m gpu -s [--quick] [--work-dir DIR]
"""

import sys
import tempfile
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def pytest_addoption(parser):
    parser.addoption("--quick", action="store_true", help="coarser grids / fewer cases")
    parser.addoption("--work-dir", default=None, help="where simulation folders are written")


def pytest_configure(config):
    config.addinivalue_line("markers", "gpu: needs the compiled CUDA engine and an NVIDIA GPU")


@pytest.fixture(scope="session")
def quick(request):
    return request.config.getoption("--quick")


@pytest.fixture(scope="session")
def work_dir(request):
    wd = request.config.getoption("--work-dir")
    path = Path(wd) if wd else Path(tempfile.mkdtemp(prefix="pffdtd_validation_"))
    path.mkdir(parents=True, exist_ok=True)
    return path
