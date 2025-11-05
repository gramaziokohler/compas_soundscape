# backend/routers/modal_analysis.py
# Router for Modal Analysis Endpoints

from fastapi import APIRouter, HTTPException
from models.schemas import ModalAnalysisRequest, ModalAnalysisResponse
from services.modal_analysis_service import ModalAnalysisService
from config.constants import MODAL_ANALYSIS_MATERIALS


router = APIRouter(prefix="/api/modal-analysis", tags=["Modal Analysis"])

# Service instance (will be injected)
modal_service: ModalAnalysisService = None


def init_modal_analysis_router(service: ModalAnalysisService):
    """Initialize router with modal analysis service"""
    global modal_service
    modal_service = service


@router.post("/analyze", response_model=ModalAnalysisResponse)
async def analyze_mesh_resonance(request: ModalAnalysisRequest):
    """
    Perform modal analysis on a mesh to find resonant frequencies.
    
    Computes vibration modes and natural frequencies using finite element analysis.
    
    **Parameters:**
    - `vertices`: List of vertex coordinates [[x, y, z], ...]
    - `faces`: List of face vertex indices [[v0, v1, v2], ...]
    - `num_modes`: Number of modes to compute (default: 10)
    - `material`: Material preset name (steel, aluminum, concrete, wood, glass)
    - `young_modulus`: Young's modulus in Pa (overrides material preset)
    - `poisson_ratio`: Poisson's ratio (overrides material preset)
    - `density`: Density in kg/m³ (overrides material preset)
    
    **Returns:**
    - `frequencies`: List of resonant frequencies in Hz
    - `mode_shapes`: List of normalized mode shape vectors
    - `material_properties`: Material properties used in analysis
    - `mesh_info`: Mesh statistics
    """
    if modal_service is None:
        raise HTTPException(
            status_code=500,
            detail="Modal analysis service not initialized"
        )

    try:
        # Resolve material properties
        young_modulus = request.young_modulus
        poisson_ratio = request.poisson_ratio
        density = request.density

        # If material preset is specified, use it (unless overridden)
        if request.material:
            material_lower = request.material.lower()
            if material_lower in MODAL_ANALYSIS_MATERIALS:
                material_props = MODAL_ANALYSIS_MATERIALS[material_lower]
                young_modulus = young_modulus or material_props["young_modulus"]
                poisson_ratio = poisson_ratio or material_props["poisson_ratio"]
                density = density or material_props["density"]
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown material: {request.material}. "
                           f"Available: {list(MODAL_ANALYSIS_MATERIALS.keys())}"
                )

        # Perform modal analysis
        result = modal_service.analyze_mesh(
            vertices=request.vertices,
            faces=request.faces,
            num_modes=request.num_modes,
            young_modulus=young_modulus,
            poisson_ratio=poisson_ratio,
            density=density,
        )

        # Compute frequency response characteristics
        if result["frequencies"]:
            frequency_response = modal_service.compute_frequency_response(
                frequencies=result["frequencies"]
            )
            result["frequency_response"] = frequency_response

        return ModalAnalysisResponse(**result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Modal analysis failed: {str(e)}"
        )


@router.get("/materials")
async def get_available_materials():
    """
    Get list of available material presets.
    
    **Returns:**
    Dictionary of material names and their properties:
    - `young_modulus`: Young's modulus in Pa
    - `poisson_ratio`: Poisson's ratio
    - `density`: Density in kg/m³
    """
    return {
        "materials": MODAL_ANALYSIS_MATERIALS,
        "description": {
            "young_modulus": "Young's modulus (Pa) - material stiffness",
            "poisson_ratio": "Poisson's ratio - lateral strain ratio",
            "density": "Density (kg/m³) - material mass per unit volume"
        }
    }
