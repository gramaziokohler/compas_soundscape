"""Vendored PFFDTD (Brian Hamilton, MIT) plus the compas driver around it.

Upstream sources live in ``python/`` (setup, voxelizer, materials, numpy engine)
and ``c_cuda/`` (CUDA engine). See VENDORED.md for the local modifications.

This package runs in the isolated ``compas-pffdtd`` env, never in the API process.
Upstream modules use top-level imports (``from common.room_geo import ...``), so
``python/`` is put on ``sys.path`` here.
"""

import sys
from pathlib import Path

PFFDTD_ROOT = Path(__file__).resolve().parent
PFFDTD_PYTHON_DIR = PFFDTD_ROOT / "python"
PFFDTD_ENGINE_DIR = PFFDTD_ROOT / "c_cuda" / "bin"

if str(PFFDTD_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PFFDTD_PYTHON_DIR))
