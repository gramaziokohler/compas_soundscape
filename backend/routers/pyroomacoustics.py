"""
Pyroomacoustics acoustic simulation integration endpoints
"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path
from typing import Optional, List
import uuid
import json

from services.pyroomacoustics_service import PyroomacousticsService
from services.geometry_service import GeometryService
from config.constants import (
    PYROOMACOUSTICS_RIR_DIR,
    PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
    PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
    PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
    PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
    PYROOMACOUSTICS_DEFAULT_SCATTERING,
    AUDIO_SAMPLE_RATE
)

router = APIRouter()

# Ensure RIR output directory exists
RIR_OUTPUT_DIR = Path(PYROOMACOUSTICS_RIR_DIR)
RIR_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

TEMP_DIR = Path(__file__).parent.parent / "temp"
TEMP_DIR.mkdir(exist_ok=True)


class SimulationSettings(BaseModel):
    max_order: int = PYROOMACOUSTICS_DEFAULT_MAX_ORDER
    ray_tracing: bool = PYROOMACOUSTICS_DEFAULT_RAY_TRACING
    air_absorption: bool = PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION


class SourceReceiverPair(BaseModel):
    source_position: List[float]  # [x, y, z]
    receiver_position: List[float]  # [x, y, z]
    source_id: str
    receiver_id: str


class RunSimulationRequest(BaseModel):
    simulation_name: str
    settings: SimulationSettings
    source_receiver_pairs: List[SourceReceiverPair]
    selected_material_id: Optional[str] = None


class SimulationResult(BaseModel):
    simulation_id: str
    message: str
    ir_files: List[str]
    results_file: str


@router.get("/pyroomacoustics/materials")
async def get_materials():
    """
    Get available material presets for pyroomacoustics simulation.
    Returns materials from the service's material database.
    """
    try:
        materials_db = PyroomacousticsService.get_material_database()
        
        # Convert to format expected by frontend
        materials = [
            {
                "id": material_id,
                "name": material_id.replace("_", " ").title(),
                "description": props.get("description", ""),
                "category": props.get("category", "General"),
                "absorption": props.get("absorption", 0.5)
            }
            for material_id, props in materials_db.items()
        ]
        
        return materials
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load materials: {str(e)}")


@router.post("/pyroomacoustics/run-simulation", response_model=SimulationResult)
async def run_simulation(
    model_file: UploadFile = File(...),
    simulation_name: str = Form(...),
    max_order: int = Form(PYROOMACOUSTICS_DEFAULT_MAX_ORDER),
    ray_tracing: bool = Form(PYROOMACOUSTICS_DEFAULT_RAY_TRACING),
    air_absorption: bool = Form(PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION),
    n_rays: int = Form(PYROOMACOUSTICS_RAY_TRACING_N_RAYS),
    scattering: float = Form(PYROOMACOUSTICS_DEFAULT_SCATTERING),
    source_receiver_pairs: str = Form(...),  # JSON string
    face_materials: Optional[str] = Form(None)  # JSON string: {face_index: material_id}
):
    """
    Run pyroomacoustics simulation with the uploaded 3D model and settings.
    
    This endpoint:
    1. Parses the uploaded 3D model (3dm/obj/ifc)
    2. Creates a pyroomacoustics Room from the mesh with per-face materials
    3. Runs simulation for each source-receiver pair
    4. Exports impulse responses and results
    """
    simulation_id = str(uuid.uuid4())
    temp_model_path = None
    
    try:
        # Parse source-receiver pairs from JSON string
        import json
        pairs_data = json.loads(source_receiver_pairs)
        
        # Parse face materials
        face_materials_dict = json.loads(face_materials) if face_materials else {}
        
        # Log simulation parameters
        print(f"\n{'='*60}")
        print(f"Pyroomacoustics Simulation Request")
        print(f"{'='*60}")
        print(f"Simulation ID: {simulation_id}")
        print(f"Model File: {model_file.filename}")
        print(f"Simulation Name: {simulation_name}")
        print(f"Settings:")
        print(f"  - Max Order: {max_order}")
        print(f"  - Ray Tracing: {ray_tracing}")
        print(f"  - Air Absorption: {air_absorption}")
        if ray_tracing:
            print(f"  - Number of Rays: {n_rays}")
            print(f"  - Scattering: {scattering}")
        print(f"Source-Receiver Pairs: {len(pairs_data)}")
        print(f"Face Materials: {len(face_materials_dict)} faces assigned")
        if face_materials_dict:
            print(f"  Material IDs: {set(face_materials_dict.values())}")
        print(f"{'='*60}\n")
        
        # Build settings object
        settings = SimulationSettings(
            max_order=max_order,
            ray_tracing=ray_tracing,
            air_absorption=air_absorption
        )
        
        # Save uploaded file temporarily
        temp_model_path = TEMP_DIR / f"sim_{simulation_id}_{model_file.filename}"
        with open(temp_model_path, "wb") as f:
            content = await model_file.read()
            f.write(content)
        
        # Parse geometry based on file type
        file_ext = temp_model_path.suffix.lower()
        
        if file_ext == '.3dm':
            geometry_data = GeometryService.process_3dm_file(str(temp_model_path))
        elif file_ext == '.obj':
            geometry_data = GeometryService.process_obj_file(str(temp_model_path))
        elif file_ext == '.ifc':
            geometry_data = GeometryService.process_ifc_file(str(temp_model_path))
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {file_ext}")
        
        # Extract mesh data
        vertices = geometry_data.get("vertices", [])
        faces = geometry_data.get("faces", [])
        
        if not vertices or not faces:
            raise HTTPException(status_code=400, detail="No valid geometry found in model")
        
        # Convert face materials to absorption values
        face_material_map = {}
        if face_materials_dict:
            materials_db = PyroomacousticsService.get_material_database()

            # Convert face index (as string keys) to absorption values
            for face_idx_str, material_id in face_materials_dict.items():
                face_idx = int(face_idx_str)
                if material_id in materials_db:
                    absorption = materials_db[material_id]["absorption"]
                    face_material_map[face_idx] = absorption
                    print(f"  Face {face_idx}: {material_id} (α={absorption:.3f})")
                else:
                    print(f"  Warning: Material ID '{material_id}' not found in database")

        # Create scattering map (only if ray tracing is enabled)
        face_scattering_map = None
        if ray_tracing and face_material_map:
            # Apply the same scattering coefficient to all faces that have materials
            face_scattering_map = {face_idx: scattering for face_idx in face_material_map.keys()}
            print(f"  Applying scattering coefficient: {scattering:.2f} to {len(face_scattering_map)} faces")

        # Create room from mesh
        room = PyroomacousticsService.create_room_from_mesh(
            vertices=vertices,
            faces=faces,
            face_materials=face_material_map if face_material_map else None,
            face_scattering=face_scattering_map,
            fs=AUDIO_SAMPLE_RATE,
            max_order=settings.max_order,
            ray_tracing=settings.ray_tracing,
            air_absorption=settings.air_absorption
        )
        
        # Run simulation for each source-receiver pair
        ir_files = []
        results_data = []
        
        # Import acoustic measurement utilities
        from utils.acoustic_measurement import AcousticMeasurement
        
        for pair_dict in pairs_data:
            pair = SourceReceiverPair(**pair_dict)
            
            # Run simulation
            ray_tracing_params = {'n_rays': n_rays} if ray_tracing else None
            room_with_rir = PyroomacousticsService.simulate_room_acoustics(
                room=room,
                source_position=pair.source_position,
                receiver_position=pair.receiver_position,
                enable_ray_tracing=settings.ray_tracing,
                ray_tracing_params=ray_tracing_params
            )
            
            # Calculate acoustic parameters
            try:
                acoustic_params = AcousticMeasurement.calculate_acoustic_parameters(room_with_rir)
            except Exception as e:
                print(f"Warning: Failed to calculate acoustic parameters: {e}")
                acoustic_params = None
            
            # Export impulse response
            ir_filename = f"sim_{simulation_id}_src_{pair.source_id}_rcv_{pair.receiver_id}.wav"
            ir_path = RIR_OUTPUT_DIR / ir_filename
            PyroomacousticsService.export_impulse_response(room_with_rir, str(ir_path))
            ir_files.append(ir_filename)
            
            # Collect results data
            result_entry = {
                "source_id": pair.source_id,
                "receiver_id": pair.receiver_id,
                "source_position": pair.source_position,
                "receiver_position": pair.receiver_position,
                "ir_file": ir_filename,
                "sample_rate": AUDIO_SAMPLE_RATE,
                "max_order": settings.max_order,
                "ray_tracing": settings.ray_tracing,
                "air_absorption": settings.air_absorption
            }

            # Add ray tracing parameters if enabled
            if ray_tracing:
                result_entry["n_rays"] = n_rays
                result_entry["scattering"] = scattering

            # Add acoustic parameters if calculated successfully
            if acoustic_params:
                result_entry["acoustic_parameters"] = acoustic_params
            
            results_data.append(result_entry)
        
        # Save results JSON
        results_filename = f"simulation_{simulation_id}_results.json"
        results_path = TEMP_DIR / results_filename
        
        with open(results_path, "w") as f:
            json.dump({
                "simulation_id": simulation_id,
                "simulation_name": simulation_name,
                "settings": settings.dict(),
                "results": results_data
            }, f, indent=2)
        
        # Cleanup temporary model file
        temp_model_path.unlink(missing_ok=True)
        
        return SimulationResult(
            simulation_id=simulation_id,
            message="Simulation completed successfully",
            ir_files=ir_files,
            results_file=results_filename
        )
        
    except HTTPException:
        raise
    except Exception as e:
        # Cleanup on error
        if temp_model_path.exists():
            temp_model_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Simulation failed: {str(e)}")


@router.get("/pyroomacoustics/get-result-file/{simulation_id}/{file_type}")
async def get_result_file(simulation_id: str, file_type: str):
    """
    Retrieve a simulation result file (wav or json).
    
    Args:
        simulation_id: The simulation ID
        file_type: Either 'wav' or 'json'
    
    Returns:
        The file as a response
    """
    # Validate file_type
    if file_type not in ['wav', 'json']:
        raise HTTPException(status_code=400, detail="file_type must be 'wav' or 'json'")
    
    if file_type == 'json':
        # Return results JSON from temp directory
        filename = f"simulation_{simulation_id}_results.json"
        file_path = TEMP_DIR / filename
        media_type = "application/json"
    else:
        # For WAV files, we need to search for the first IR file
        # (In multi-receiver scenario, this gets the first one)
        ir_files = list(RIR_OUTPUT_DIR.glob(f"sim_{simulation_id}_*.wav"))
        if not ir_files:
            raise HTTPException(status_code=404, detail=f"No WAV files found for simulation {simulation_id}")
        
        file_path = ir_files[0]
        filename = file_path.name
        media_type = "audio/wav"
    
    # Check if file exists
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    
    # Return file
    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=filename
    )


def init_pyroomacoustics_router():
    """Initialize the Pyroomacoustics router (for dependency injection pattern)"""
    return router
