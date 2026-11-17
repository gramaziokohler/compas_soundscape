"""API router for impulse response management"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Form, Request
from fastapi.responses import JSONResponse
from typing import Optional
import json
import os
import tempfile

from models.schemas import (
    ImpulseResponseMetadata,
    ImpulseResponseListResponse
)
from services.impulse_response_service import ImpulseResponseService
from services.io_jobs import run_blocking

# Router will be initialized in main.py
router = APIRouter()
ir_service: Optional[ImpulseResponseService] = None


def init_impulse_response_router(service: ImpulseResponseService):
    """Initialize router with service instance"""
    global ir_service
    ir_service = service


@router.post("/api/impulse-responses/upload", response_model=ImpulseResponseMetadata)
async def upload_impulse_response(
    req: Request,
    file: UploadFile = File(...),
    name: str = Form(...),
    acoustic_metrics: Optional[str] = Form(None),
):
    """
    Upload an impulse response file

    Accepts WAV files with 1, 2, 4, or 16+ channels.
    Files with >16 channels will be truncated to first 16 channels (TOA).
    Files with 5-15 channels will be truncated to first 4 channels (FOA).

    Args:
        file: WAV file upload
        name: User-provided name for the IR
        acoustic_metrics: Optional JSON ``{"acoustic_parameters": {...}, "acoustic_parameters_bands": {...}}``
            of an IR imported from a simulation run (measured on its untrimmed response); stored as-is
            instead of measuring the uploaded file again.

    Returns:
        Metadata for the processed IR
    """
    if not ir_service:
        raise HTTPException(status_code=500, detail="IR service not initialized")

    # Validate file type
    if not file.filename.endswith('.wav'):
        raise HTTPException(
            status_code=400,
            detail="Only WAV files are supported"
        )
    known_metrics = None
    if acoustic_metrics:
        try:
            parsed = json.loads(acoustic_metrics)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="acoustic_metrics must be JSON")
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=400, detail="acoustic_metrics must be an object")
        known_metrics = {k: v for k, v in parsed.items()
                         if k in ("acoustic_parameters", "acoustic_parameters_bands") and isinstance(v, dict)}

    # Save uploaded file to temporary location
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_path = tmp_file.name

        # Process IR file (workspace-scoped library dir); measuring it is CPU work, off the event loop
        workspace_id = getattr(getattr(req, "state", None), "session_id", None)
        metadata, output_path = await run_blocking(
            ir_service.process_ir_file, tmp_path, name, workspace_id, known_metrics,
        )
        
        # Clean up temp file
        os.unlink(tmp_path)
        
        return metadata
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error processing IR file: {str(e)}"
        )


@router.get("/api/impulse-responses", response_model=ImpulseResponseListResponse)
async def list_impulse_responses(req: Request):
    """
    List all available impulse responses
    
    Returns:
        List of IR metadata objects
    """
    if not ir_service:
        raise HTTPException(status_code=500, detail="IR service not initialized")
    
    try:
        workspace_id = getattr(getattr(req, "state", None), "session_id", None)
        irs = ir_service.list_impulse_responses(workspace_id)
        return ImpulseResponseListResponse(impulse_responses=irs)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error listing impulse responses: {str(e)}"
        )


@router.delete("/api/impulse-responses/{ir_id}")
async def delete_impulse_response(ir_id: str, req: Request):
    """
    Delete an impulse response
    
    Args:
        ir_id: ID of the IR to delete
        
    Returns:
        Success message
    """
    if not ir_service:
        raise HTTPException(status_code=500, detail="IR service not initialized")
    
    try:
        workspace_id = getattr(getattr(req, "state", None), "session_id", None)
        deleted = ir_service.delete_impulse_response(ir_id, workspace_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Impulse response '{ir_id}' not found")
        
        return {"message": f"Impulse response '{ir_id}' deleted successfully"}
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error deleting impulse response: {str(e)}"
        )
