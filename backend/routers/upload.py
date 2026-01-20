# backend/routers/upload.py
# File Upload and Geometry Processing Endpoints

import os
import shutil
import logging
from fastapi import APIRouter, File, UploadFile, HTTPException

from services.geometry_service import GeometryService
from services.speckle_service import SpeckleService
from config.constants import TEMP_UPLOADS_DIR, SAMPLE_IFC_FILE_PATH


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["upload"])

# Initialize Speckle service (singleton pattern)
speckle_service = SpeckleService()


@router.post("/upload")
async def upload_and_process_file(file: UploadFile = File(...)):
    """
    Upload and process 3D model files (.obj, .stl, .ifc, .3dm)
    
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
        # Upload to Speckle (required now - not optional)
        speckle_data = None
        try:
            # Authenticate if not already authenticated
            if not speckle_service.client:
                if speckle_service.authenticate():
                    speckle_service.get_or_create_project()
            
            # Upload model to Speckle
            if speckle_service.project_id:
                speckle_data = speckle_service.upload_model(
                    file_path=temp_path,
                    file_type=file_type,
                    model_name=os.path.splitext(file.filename)[0]
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


@router.get("/load-sample-ifc")
async def load_sample_ifc():
    """Load the sample IFC model (Duplex_A_20110907.ifc)"""
    if not os.path.exists(SAMPLE_IFC_FILE_PATH):
        raise HTTPException(
            status_code=404,
            detail=f"Sample IFC file not found at {SAMPLE_IFC_FILE_PATH}"
        )

    try:
        return GeometryService.process_ifc_file(SAMPLE_IFC_FILE_PATH)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process sample IFC: {str(e)}")
