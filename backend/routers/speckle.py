# backend/routers/speckle.py
# Speckle Project & Model Browsing Endpoints

import logging
from fastapi import APIRouter, HTTPException

from services.speckle_service import SpeckleService
from models.schemas import SpeckleProjectModelsResponse


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/speckle", tags=["speckle"])

# Initialize Speckle service (singleton pattern – same instance as upload.py)
speckle_service = SpeckleService()


def _ensure_authenticated() -> None:
    """Authenticate and initialise the Speckle project if not already done."""
    if not speckle_service.client:
        if not speckle_service.authenticate():
            raise HTTPException(status_code=503, detail="Failed to authenticate with Speckle")
        speckle_service.get_or_create_project()

    if not speckle_service.project_id:
        speckle_service.get_or_create_project()
        if not speckle_service.project_id:
            raise HTTPException(status_code=503, detail="Speckle project not available")


@router.get("/models", response_model=SpeckleProjectModelsResponse)
async def get_project_models():
    """
    List all models in the current Speckle project with detailed metadata.

    Returns model list including author, timestamps, preview URLs and
    the latest version summary for each model.
    """
    _ensure_authenticated()

    result = speckle_service.get_project_models_detailed()

    if result is None:
        raise HTTPException(status_code=500, detail="Failed to retrieve Speckle models")

    # Attach auth_token so the frontend viewer can authenticate
    result["auth_token"] = speckle_service.auth_token

    return result
