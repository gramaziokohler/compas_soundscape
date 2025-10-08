# backend/routers/upload.py
# File Upload and Geometry Processing Endpoints

import os
import shutil
from fastapi import APIRouter, File, UploadFile, HTTPException

from services.geometry_service import GeometryService


router = APIRouter(prefix="/api", tags=["upload"])


@router.post("/upload")
async def upload_and_process_file(file: UploadFile = File(...)):
    """Upload and process 3D model files (.obj, .stl, .ifc, .3dm)"""
    temp_dir = "temp_uploads"
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, file.filename)

    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        filename_lower = file.filename.lower()

        if filename_lower.endswith('.ifc'):
            return GeometryService.process_ifc_file(temp_path)
        elif filename_lower.endswith('.3dm'):
            return GeometryService.process_3dm_file(temp_path)
        elif filename_lower.endswith('.obj'):
            return GeometryService.process_obj_file(temp_path)
        elif filename_lower.endswith('.stl'):
            return GeometryService.process_stl_file(temp_path)
        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type. Supported formats: .obj, .stl, .ifc, .3dm"
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@router.get("/load-sample-ifc")
async def load_sample_ifc():
    """Load the sample IFC model (Duplex_A_20110907.ifc)"""
    sample_ifc_path = "data/Duplex_A_20110907.ifc"

    if not os.path.exists(sample_ifc_path):
        raise HTTPException(
            status_code=404,
            detail=f"Sample IFC file not found at {sample_ifc_path}"
        )

    try:
        return GeometryService.process_ifc_file(sample_ifc_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process sample IFC: {str(e)}")
