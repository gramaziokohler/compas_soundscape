# backend/routers/speckle.py
# Speckle Project & Model Browsing Endpoints

import os
import base64
import logging
import requests as _requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config.constants import SPECKLE_SERVER_URL
from services.speckle_service import SpeckleService
from models.schemas import SpeckleProjectModelsResponse


class SpeckleModelRequest(BaseModel):
    project_id: str
    version_id: str


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/speckle", tags=["speckle"])

# Initialize Speckle service (singleton pattern – same instance as upload.py)
speckle_service = SpeckleService()


def _ensure_authenticated() -> None:
    """Authenticate and initialise the Speckle project if not already done."""
    if not speckle_service.client:
        if not speckle_service.authenticate():
            token_set = bool(os.environ.get("SPECKLE_TOKEN"))
            if not token_set:
                raise HTTPException(
                    status_code=503,
                    detail="SPECKLE_TOKEN is not configured. Get a token at app.speckle.systems and add it in Advanced Settings."
                )
            raise HTTPException(
                status_code=503,
                detail="Failed to authenticate with Speckle. Your token may be invalid or expired — update it in Advanced Settings."
            )
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


@router.post("/model-entities")
async def get_model_entities(request: SpeckleModelRequest):
    """
    Extract entity metadata from a Speckle model version.

    Returns entities in the format consumed by select_diverse_entities() and
    analyze_3dmodel(): [{id, name, speckle_type, layer, material, bounds}, ...]
    """
    _ensure_authenticated()

    entities = speckle_service.get_model_entities(
        project_id=request.project_id,
        version_id_or_object_id=request.version_id,
    )

    return {"entities": entities, "count": len(entities)}


@router.post("/model-preview")
async def get_model_preview(request: SpeckleModelRequest):
    """
    Fetch the default pre-rendered preview PNG from the Speckle Preview Service
    and return it as a base64 data URI.
    """
    _ensure_authenticated()

    # Resolve the version's preview_url from specklepy (authoritative path)
    preview_url: str | None = None
    try:
        version = speckle_service.client.version.get(
            version_id=request.version_id,
            project_id=request.project_id,
        )
        preview_url = getattr(version, "preview_url", None)
    except Exception as exc:
        logger.warning(f"Could not fetch version for preview URL: {exc}")

    if not preview_url:
        preview_url = (
            f"https://{SPECKLE_SERVER_URL.rstrip('/')}"
            f"/preview/{request.project_id}/commits/{request.version_id}"
        )

    token = os.getenv("SPECKLE_TOKEN", "")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    try:
        resp = _requests.get(preview_url, headers=headers, timeout=30)
        resp.raise_for_status()
        preview_bytes = resp.content
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Speckle preview unavailable: {exc}")

    preview_b64 = f"data:image/png;base64,{base64.b64encode(preview_bytes).decode()}"
    return {"preview": preview_b64}
