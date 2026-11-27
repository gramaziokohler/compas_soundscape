"""
GET /acoustics/engines
  Which geometric engine is the default and what it can do, so the simulation card only offers
  what will run.

Sound paths are no longer traced on demand: every compas_acoustics run stores them in its results
JSON (services/acoustic_paths_service.py).
"""
from __future__ import annotations

import importlib.util

from config.constants import (
    ACOUSTICS_ENGINE_COMPAS_ACOUSTICS,
    ACOUSTICS_ENGINE_DEFAULT,
    ACOUSTICS_ENGINE_PYROOMACOUSTICS,
    CA_AMBISONIC_ORDER_MAX,
    CA_DIFFRACTION_MODELS,
    CA_TAILS,
)
from fastapi import APIRouter

router = APIRouter(prefix="/api")


@router.get("/acoustics/engines")
async def get_engines():
    installed = importlib.util.find_spec("compas_acoustics") is not None
    hybrid = installed and importlib.util.find_spec("pyFDN") is not None
    return {
        "default": ACOUSTICS_ENGINE_DEFAULT,
        "engines": {
            ACOUSTICS_ENGINE_COMPAS_ACOUSTICS: {
                "available": installed,
                "modes": ["mono", "foa", "hoa"] if hybrid else ["mono"],
                "diffraction": [m for m in CA_DIFFRACTION_MODELS if hybrid or m != "btms"],
                "tails": list(CA_TAILS),
                "max_ambisonic_order": CA_AMBISONIC_ORDER_MAX,
            },
            ACOUSTICS_ENGINE_PYROOMACOUSTICS: {
                "available": True, "modes": ["mono", "foa"], "diffraction": ["off"], "tails": [],
                "max_ambisonic_order": 1,
            },
        },
    }
