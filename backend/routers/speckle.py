# backend/routers/speckle.py
# Speckle Project & Model Browsing Endpoints

import os
import base64
import logging
import requests as _requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from config.constants import SPECKLE_SERVER_URL
from services.speckle_service import SpeckleService
from models.schemas import SpeckleProjectModelsResponse
from utils.file_operations import list_saved_soundscape_models


class SpeckleModelRequest(BaseModel):
    project_id: str
    version_id: str


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/speckle", tags=["speckle"])

# Initialize Speckle service (singleton pattern – same instance as upload.py)
speckle_service = SpeckleService()


def _ensure_authenticated() -> None:
    """Authenticate and initialise the Speckle project if not already done."""
    from services.runtime_config import speckle_token_is_set
    if not speckle_service.client:
        if not speckle_service.authenticate():
            if not speckle_token_is_set():
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
async def get_project_models(req: Request):
    """
    List all models in the current Speckle project with detailed metadata.

    Returns model list including author, timestamps, preview URLs and
    the latest version summary for each model.

    Each model is also annotated with ``last_saved_at`` — the time this
    workspace last saved a soundscape for that model (local SoundscapeStore
    save), which is independent of Speckle's own ``updated_at``.
    """
    _ensure_authenticated()

    result = await run_in_threadpool(speckle_service.get_project_models_detailed)

    if result is None:
        raise HTTPException(status_code=500, detail="Failed to retrieve Speckle models")

    # Annotate models the workspace has saved so the browser can surface them
    # first. Best-effort: a filesystem hiccup must not fail the model listing.
    try:
        saved = list_saved_soundscape_models(
            getattr(getattr(req, "state", None), "session_id", "") or ""
        )
        for model in result.get("models", []):
            model["last_saved_at"] = saved.get(model.get("id"))
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Could not resolve saved soundscape models: {exc}")

    # Attach auth_token so the frontend viewer can authenticate
    result["auth_token"] = speckle_service.auth_token

    return result


@router.get("/ingestion/{ingestion_id}")
async def get_ingestion_status(ingestion_id: str):
    """
    Poll the status of an asynchronous Speckle file ingestion.

    `POST /api/upload` triggers `startFileIngestion`, which creates the model
    version asynchronously. Clients poll this until ``status == "success"`` to get
    the resolved ``version_id`` / ``object_id`` (needed both to load the model in
    the viewer and to run acoustic simulations), or until a terminal failure.
    """
    _ensure_authenticated()

    status = await run_in_threadpool(speckle_service.get_ingestion_status, ingestion_id)

    if status is None:
        raise HTTPException(status_code=502, detail="Failed to query Speckle ingestion status")

    return status


@router.post("/model-entities")
async def get_model_entities(request: SpeckleModelRequest):
    """
    Extract entity metadata from a Speckle model version.

    Returns entities in the format consumed by select_diverse_entities() and
    analyze_3dmodel(): [{id, name, speckle_type, layer, material, bounds}, ...]
    """
    _ensure_authenticated()

    entities = await run_in_threadpool(
        speckle_service.get_model_entities,
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
        version = await run_in_threadpool(
            speckle_service.client.version.get,
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

    from services.runtime_config import resolve_speckle_token
    token = resolve_speckle_token()
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    try:
        resp = await run_in_threadpool(_requests.get, preview_url, headers=headers, timeout=30)
        resp.raise_for_status()
        preview_bytes = resp.content
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Speckle preview unavailable: {exc}")

    preview_b64 = f"data:image/png;base64,{base64.b64encode(preview_bytes).decode()}"
    return {"preview": preview_b64}
