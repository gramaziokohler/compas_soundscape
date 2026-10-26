# backend/routers/upload.py
# File Upload and Geometry Processing Endpoints

import os
import shutil
import logging
from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.concurrency import run_in_threadpool

from services.speckle_service import SpeckleService
from config.constants import TEMP_UPLOADS_DIR, SAMPLE_IFC_FILE_PATH, SPECKLE_SUPPORTED_FORMATS
from models.schemas import (
    SpeckleUploadPrepareRequest,
    SpeckleUploadPrepareResponse,
    SpeckleUploadFinalizeRequest,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["upload"])

# Initialize Speckle service (singleton pattern)
speckle_service = SpeckleService()


def _ensure_speckle_project() -> None:
    """Authenticate the shared Speckle client on first use; 500 if no project."""
    if not speckle_service.client:
        if speckle_service.authenticate():
            speckle_service.get_or_create_project()
    if not speckle_service.project_id:
        raise HTTPException(status_code=500, detail="Speckle project not configured")


def _check_model_file_type(file_name: str) -> None:
    ext = os.path.splitext(file_name)[1].lstrip(".").lower()
    if ext not in SPECKLE_SUPPORTED_FORMATS:
        supported = ", ".join(f".{f}" for f in SPECKLE_SUPPORTED_FORMATS)
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Supported formats: {supported}")


@router.post("/upload/prepare", response_model=SpeckleUploadPrepareResponse)
async def prepare_model_upload(body: SpeckleUploadPrepareRequest):
    """
    Step 1 of the direct browser upload: return a presigned Speckle blob URL.

    The browser PUTs the file there itself, so model files never pass through
    the Cloudflare tunnel (100 MB request limit) or this server.
    """
    _check_model_file_type(body.file_name)
    await run_in_threadpool(_ensure_speckle_project)
    target = await run_in_threadpool(speckle_service.generate_upload_url, os.path.basename(body.file_name))
    if not target:
        raise HTTPException(status_code=502, detail="Could not get a Speckle upload URL")
    return SpeckleUploadPrepareResponse(upload_url=target["url"], file_id=target["file_id"])


@router.post("/upload/finalize")
async def finalize_model_upload(body: SpeckleUploadFinalizeRequest):
    """
    Step 2 of the direct browser upload: start Speckle ingestion of the uploaded
    blob. Returns the same ``{speckle, geometry}`` shape as ``POST /api/upload``;
    the client polls ``/api/speckle/ingestion/{id}`` for the created version.
    """
    _check_model_file_type(body.file_name)
    await run_in_threadpool(_ensure_speckle_project)
    file_name = os.path.basename(body.file_name)
    speckle_data = await run_in_threadpool(
        speckle_service.start_ingestion,
        file_id=body.file_id,
        etag=body.etag,
        file_name=file_name,
        model_name=os.path.splitext(file_name)[0],
        model_id=body.model_id or None,
    )
    if not speckle_data:
        raise HTTPException(status_code=502, detail="Failed to start Speckle ingestion")
    if speckle_service.auth_token:
        speckle_data["auth_token"] = speckle_service.auth_token
    return {"speckle": speckle_data, "geometry": {"vertices": [], "faces": []}}


@router.post("/upload")
async def upload_and_process_file(
    file: UploadFile = File(...),
    model_id: Optional[str] = Form(None),
):
    """
    Upload and process 3D model files (.obj, .stl, .ifc, .3dm)

    With ``model_id`` the file becomes a NEW VERSION of that existing model,
    whatever its file name; without it, the model is matched by file name.
    
    This endpoint now integrates with Speckle for cloud-based geometry storage
    while maintaining backward compatibility by returning both Speckle metadata
    and processed geometry data.
    """
    os.makedirs(TEMP_UPLOADS_DIR, exist_ok=True)
    temp_path = os.path.join(TEMP_UPLOADS_DIR, file.filename)

    try:
        # Save uploaded file temporarily
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        filename_lower = file.filename.lower()
        
        # Determine file type for Speckle upload
        if filename_lower.endswith('.ifc'):
            file_type = 'ifc'
        elif filename_lower.endswith('.3dm'):
            file_type = '3dm'
        elif filename_lower.endswith('.obj'):
            file_type = 'obj'
        elif filename_lower.endswith('.stl'):
            file_type = 'stl'
        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type. Supported formats: .obj, .stl, .ifc, .3dm"
            )

        # OLD WORKFLOW - COMMENTED OUT: No longer processing geometry locally
        # We now only use Speckle data and extract entities from WorldTree
        # geometry = None
        # if filename_lower.endswith('.ifc'):
        #     geometry = GeometryService.process_ifc_file(temp_path)
        # elif filename_lower.endswith('.3dm'):
        #     geometry = GeometryService.process_3dm_file(temp_path)
        # elif filename_lower.endswith('.obj'):
        #     geometry = GeometryService.process_obj_file(temp_path)
        # elif filename_lower.endswith('.stl'):
        #     geometry = GeometryService.process_stl_file(temp_path)

        # Upload to Speckle (required now - not optional)
        speckle_data = None
        try:
            # Authenticate if not already authenticated
            if not speckle_service.client:
                if speckle_service.authenticate():
                    speckle_service.get_or_create_project()
            
            # Upload model to Speckle.
            # `upload_model` performs blocking HTTP (S3 upload + GraphQL) so it must
            # run off the event loop. Speckle ingestion is async — the client polls
            # `/api/speckle/ingestion/{id}` for the created version.
            if speckle_service.project_id:
                speckle_data = await run_in_threadpool(
                    speckle_service.upload_model,
                    file_path=temp_path,
                    file_type=file_type,
                    model_name=os.path.splitext(file.filename)[0],
                    model_id=model_id or None,
                )
                
                if speckle_data:
                    # Add auth token for frontend viewer
                    if speckle_service.auth_token:
                        speckle_data["auth_token"] = speckle_service.auth_token
                    logger.info(f"Successfully uploaded to Speckle: {speckle_data['url']}")
                else:
                    logger.warning("Speckle upload returned no data")
                    raise HTTPException(status_code=500, detail="Failed to upload to Speckle")
            else:
                logger.error("Speckle project not available")
                raise HTTPException(status_code=500, detail="Speckle project not configured")
                
        except HTTPException:
            raise
        except Exception as speckle_error:
            # Speckle upload is now required - fail if it doesn't work
            logger.error(f"Speckle upload failed: {str(speckle_error)}")
            raise HTTPException(status_code=500, detail=f"Speckle upload failed: {str(speckle_error)}")

        # Return Speckle data only (no legacy geometry)
        if not speckle_data:
            raise HTTPException(status_code=500, detail="No Speckle data available")
            
        return {
            "speckle": speckle_data,
            "geometry": {"vertices": [], "faces": []}  # Empty geometry for backward compatibility
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")
    finally:
        # Clean up temporary file
        if os.path.exists(temp_path):
            os.remove(temp_path)

