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
import numpy as np
from scipy.io import wavfile

from services.pyroomacoustics_service import PyroomacousticsService
from services.geometry_service import GeometryService
from services.speckle_service import SpeckleService
from config.constants import (
    PYROOMACOUSTICS_RIR_DIR,
    PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
    PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
    PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
    PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
    PYROOMACOUSTICS_DEFAULT_SCATTERING,
    PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
    PYROOMACOUSTICS_SIMULATION_MODE_MONO,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA_RAYTRACING,
    AUDIO_SAMPLE_RATE,
    TEMP_SIMULATIONS_DIR,
    PYROOMACOUSTICS_DEFAULT_ABSORPTION
)

router = APIRouter()

# Ensure RIR output directory exists
RIR_OUTPUT_DIR = Path(PYROOMACOUSTICS_RIR_DIR)
RIR_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

TEMP_DIR = Path(TEMP_SIMULATIONS_DIR)
TEMP_DIR.mkdir(parents=True, exist_ok=True)


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
                "absorption": sum(props.get("absorption", [])) / len(props.get("absorption", [])) if props.get("absorption") else PYROOMACOUSTICS_DEFAULT_ABSORPTION
            }
            for material_id, props in materials_db.items()
        ]
        
        return materials
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load materials: {str(e)}")


@router.get("/pyroomacoustics/get-result-file/{simulation_id}/{file_type}")
async def get_result_file(simulation_id: str, file_type: str, ir_filename: Optional[str] = None):
    """
    Retrieve a simulation result file (wav or json).

    Args:
        simulation_id: The simulation ID
        file_type: Either 'wav' or 'json'
        ir_filename: Optional specific IR filename (for wav files only)

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
        # For WAV files, support retrieving specific IR by filename
        if ir_filename:
            # Validate filename belongs to this simulation
            if not ir_filename.startswith(f"sim_{simulation_id}_"):
                raise HTTPException(status_code=400, detail="Invalid IR filename for this simulation")

            file_path = RIR_OUTPUT_DIR / ir_filename
            filename = ir_filename
        else:
            # Fallback: return first IR file if no specific filename given
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


@router.post("/pyroomacoustics/run-simulation-speckle", response_model=SimulationResult)
async def run_simulation_speckle(
    simulation_name: str = Form(...),
    speckle_project_id: str = Form(...),
    speckle_version_id: str = Form(...),
    object_materials: str = Form(...),  # JSON: {"object_id": "material_id"}
    layer_name: str = Form("Acoustics"),
    max_order: int = Form(PYROOMACOUSTICS_DEFAULT_MAX_ORDER),
    ray_tracing: bool = Form(PYROOMACOUSTICS_DEFAULT_RAY_TRACING),
    air_absorption: bool = Form(PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION),
    n_rays: int = Form(PYROOMACOUSTICS_RAY_TRACING_N_RAYS),
    scattering: float = Form(PYROOMACOUSTICS_DEFAULT_SCATTERING),
    simulation_mode: str = Form(PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE),
    source_receiver_pairs: str = Form(...),  # JSON string
):
    """
    Run pyroomacoustics simulation with Speckle geometry.
    
    This endpoint:
    1. Authenticates with Speckle and fetches geometry from the specified version
    2. Extracts mesh data from Speckle display values
    3. Maps object materials to faces
    4. Creates a pyroomacoustics Room from the mesh
    5. Runs simulation for each source-receiver pair
    6. Exports impulse responses and results
    """
    simulation_id = str(uuid.uuid4())
    
    try:
        # Parse JSON inputs
        import json
        pairs_data = json.loads(source_receiver_pairs)
        object_materials_dict = json.loads(object_materials)
        
        # Log simulation parameters
        print(f"\n{'='*60}")
        print(f"Pyroomacoustics Speckle Simulation Request")
        print(f"{'='*60}")
        print(f"Simulation ID: {simulation_id}")
        print(f"Speckle Project ID: {speckle_project_id}")
        print(f"Speckle Version ID: {speckle_version_id}")
        print(f"Layer Name: {layer_name}")
        print(f"Simulation Name: {simulation_name}")
        print(f"Settings:")
        print(f"  - Simulation Mode: {simulation_mode}")
        print(f"  - Max Order: {max_order}")
        print(f"  - Ray Tracing: {ray_tracing}")
        print(f"  - Air Absorption: {air_absorption}")
        if ray_tracing:
            print(f"  - Number of Rays: {n_rays}")
            print(f"  - Scattering: {scattering}")
        print(f"Source-Receiver Pairs: {len(pairs_data)}")
        print(f"Object Materials: {len(object_materials_dict)} objects assigned")
        if object_materials_dict:
            print(f"  Material IDs: {set(object_materials_dict.values())}")
        print(f"{'='*60}\n")
        
        # Initialize Speckle service and authenticate
        speckle_service = SpeckleService()
        if not speckle_service.authenticate():
            raise HTTPException(status_code=500, detail="Failed to authenticate with Speckle")
        
        # Fetch geometry from Speckle using display values
        print(f"Fetching geometry from Speckle...")
        geometry_data = speckle_service.get_model_geometry(
            project_id=speckle_project_id,
            version_id_or_object_id=speckle_version_id,
            layer_name=layer_name
        )
        
        if not geometry_data:
            raise HTTPException(status_code=500, detail="Failed to retrieve geometry from Speckle")
        
        # Extract mesh data
        vertices = geometry_data.get("vertices", [])
        faces = geometry_data.get("faces", [])
        object_ids = geometry_data.get("object_ids", [])
        object_face_ranges = geometry_data.get("object_face_ranges", {})
        
        print(f"Geometry data returned: vertices={len(vertices)}, faces={len(faces)}, objects={len(object_ids)}")
        print(f"Geometry data keys: {list(geometry_data.keys())}")
        
        if not vertices or not faces:
            # Try without layer filter to debug
            print(f"No geometry found with layer filter '{layer_name}'. Trying without filter...")
            geometry_data_no_filter = speckle_service.get_model_geometry(
                project_id=speckle_project_id,
                version_id_or_object_id=speckle_version_id,
                layer_name=None  # No filter
            )
            if geometry_data_no_filter:
                verts_no_filter = geometry_data_no_filter.get("vertices", [])
                faces_no_filter = geometry_data_no_filter.get("faces", [])
                print(f"Without filter: {len(verts_no_filter)} vertices, {len(faces_no_filter)} faces")
                if verts_no_filter and faces_no_filter:
                    print(f"WARNING: Geometry found WITHOUT layer filter. The layer name '{layer_name}' may not match.")
                    print(f"Available objects: {geometry_data_no_filter.get('object_names', [])}")
            
            raise HTTPException(
                status_code=400, 
                detail=f"No valid geometry found in Speckle layer '{layer_name}'. "
                       f"Ensure the layer contains mesh objects with display values."
            )
        
        print(f"Extracted geometry: {len(vertices)} vertices, {len(faces)} faces from {len(object_ids)} objects")
        
        # Map object materials to face materials
        face_material_map = {}
        materials_db = PyroomacousticsService.get_material_database()
        
        for obj_id, material_id in object_materials_dict.items():
            if obj_id not in object_face_ranges:
                print(f"  Warning: Object ID '{obj_id}' not found in geometry")
                continue
            
            if material_id not in materials_db:
                print(f"  Warning: Material ID '{material_id}' not found in database")
                continue
            
            # Get face range for this object
            start_face, end_face = object_face_ranges[obj_id]
            absorption = materials_db[material_id]["absorption"]
            
            # Assign material to all faces in this object
            for face_idx in range(start_face, end_face + 1):
                face_material_map[face_idx] = absorption
            
            # print(f"  Object {obj_id}: {material_id} (α={absorption:.3f}) -> faces {start_face}-{end_face}")
        
        print(f"Mapped materials to {len(face_material_map)} faces")
        
        # Create scattering map (only if ray tracing is enabled)
        face_scattering_map = None
        if ray_tracing and face_material_map:
            face_scattering_map = {face_idx: scattering for face_idx in face_material_map.keys()}
            print(f"  Applying scattering coefficient: {scattering:.2f} to {len(face_scattering_map)} faces")
        
        # Build settings object
        settings = SimulationSettings(
            max_order=max_order,
            ray_tracing=ray_tracing,
            air_absorption=air_absorption
        )
        
        # Extract unique sources and receivers from pairs
        unique_sources = {}
        unique_receivers = {}
        
        for pair_dict in pairs_data:
            pair = SourceReceiverPair(**pair_dict)
            
            if pair.source_id not in unique_sources:
                unique_sources[pair.source_id] = (pair.source_position, len(unique_sources))
            
            if pair.receiver_id not in unique_receivers:
                unique_receivers[pair.receiver_id] = (pair.receiver_position, len(unique_receivers))
        
        print(f"  Unique sources: {len(unique_sources)}, Unique receivers: {len(unique_receivers)}")
        print(f"  Simulation mode: {simulation_mode}")
        
        # Determine number of channels
        if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO:
            num_channels = 1
        elif simulation_mode in [PYROOMACOUSTICS_SIMULATION_MODE_FOA, PYROOMACOUSTICS_SIMULATION_MODE_FOA_RAYTRACING]:
            num_channels = 4
        else:
            raise HTTPException(status_code=400, detail=f"Invalid simulation mode: {simulation_mode}")
        
        print(f"  Number of channels per receiver: {num_channels}")
        
        # Create room from Speckle geometry
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
        
        # Add all sources
        for source_id, (source_position, _) in unique_sources.items():
            try:
                room.add_source(source_position)
                print(f"  Added source {source_id} at {source_position}")
            except (ValueError, AssertionError) as e:
                error_msg = str(e)
                # if "inside" in error_msg.lower() or "outside" in error_msg.lower():
                #     raise HTTPException(
                #         status_code=400,
                #         # detail=f"Source '{source_id}' at position {source_position} is not inside the room geometry. "
                #         #        f"Please ensure sources are placed within the model bounds."
                #     )
                raise HTTPException(status_code=400, detail=f"Failed to add source '{source_id}': {error_msg}")
        
        # Add all receivers
        for receiver_id, (receiver_position, _) in unique_receivers.items():
            try:
                PyroomacousticsService.add_receiver_to_room(room, receiver_position, simulation_mode)
                print(f"  Added {simulation_mode} receiver {receiver_id} at {receiver_position}")
                
                if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA and ray_tracing:
                    print(f"  NOTE: Ray tracing disabled for FOA mode (directivity requires ISM)")
                    ray_tracing = False
            except ValueError as e:
                error_msg = str(e)
                if "inside" in error_msg.lower() or "outside" in error_msg.lower() or "room geometry" in error_msg.lower():
                    raise HTTPException(
                        status_code=400,
                        detail=f"Receiver '{receiver_id}': {error_msg}"
                    )
                raise HTTPException(status_code=400, detail=f"Failed to add receiver '{receiver_id}': {error_msg}")
        
        # Enable ray tracing if needed
        if ray_tracing:
            try:
                PyroomacousticsService.enable_ray_tracing(room, n_rays=n_rays)
                print("Ray tracing enabled for hybrid ISM/ray tracing simulation")
            except Exception as e:
                print(f"Warning: Failed to enable ray tracing: {type(e).__name__}: {str(e)}")
        
        # Compute RIR
        print(f"  Computing RIRs...")
        room.compute_rir()
        print(f"  RIR computation complete!")
        
        # Import acoustic measurement utilities
        from utils.acoustic_measurement import AcousticMeasurement
        
        # Export IRs and collect results (same logic as file-based simulation)
        ir_files = []
        results_data = []
        
        for pair_dict in pairs_data:
            pair = SourceReceiverPair(**pair_dict)
            
            source_idx = unique_sources[pair.source_id][1]
            receiver_base_idx = unique_receivers[pair.receiver_id][1]
            mic_start_idx = receiver_base_idx * num_channels
            
            # Extract RIR (same logic as file-based version)
            if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO:
                rir = room.rir[mic_start_idx][source_idx]
                if rir is None or len(rir) == 0:
                    raise HTTPException(
                        status_code=500,
                        detail=f"Empty RIR for source '{pair.source_id}' -> receiver '{pair.receiver_id}'"
                    )
                rir_data = rir
            else:
                rir_channels = []
                if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA:
                    channel_names_list = ['W', 'X', 'Y', 'Z']
                elif simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA_RAYTRACING:
                    channel_names_list = ['FLU', 'BRU', 'FRD', 'BLD']
                else:
                    channel_names_list = [f'Ch{i}' for i in range(num_channels)]
                
                for ch in range(num_channels):
                    mic_idx = mic_start_idx + ch
                    if mic_idx >= len(room.rir):
                        raise HTTPException(
                            status_code=500,
                            detail=f"Microphone index {mic_idx} out of range"
                        )
                    rir = room.rir[mic_idx][source_idx]
                    if rir is None or len(rir) == 0:
                        channel_name = channel_names_list[ch] if ch < len(channel_names_list) else f"Channel {ch}"
                        raise HTTPException(
                            status_code=500,
                            detail=f"Empty RIR for {channel_name} channel"
                        )
                    rir_channels.append(rir)
                
                max_length = max(len(rir) for rir in rir_channels)
                padded_channels = []
                for rir in rir_channels:
                    if len(rir) < max_length:
                        padded_rir = np.pad(rir, (0, max_length - len(rir)), mode='constant')
                        padded_channels.append(padded_rir)
                    else:
                        padded_channels.append(rir)
                
                if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA_RAYTRACING:
                    a_format = np.array(padded_channels)
                    b_format = PyroomacousticsService.convert_a_format_to_b_format(a_format)
                    rir_data = b_format.T
                else:
                    rir_data = np.column_stack(padded_channels)
                    rir_transformed = np.zeros_like(rir_data)
                    rir_transformed[:, 0] = rir_data[:, 0]
                    rir_transformed[:, 1] = -rir_data[:, 3]
                    rir_transformed[:, 2] = rir_data[:, 1]
                    rir_transformed[:, 3] = rir_data[:, 2]
                    rir_data = rir_transformed
            
            # Calculate acoustic parameters
            try:
                first_channel_rir = room.rir[mic_start_idx][source_idx]
                acoustic_params = AcousticMeasurement.calculate_acoustic_parameters_from_rir(
                    first_channel_rir, AUDIO_SAMPLE_RATE
                )
            except Exception as e:
                print(f"Warning: Failed to calculate acoustic parameters: {e}")
                acoustic_params = None
            
            # Export impulse response
            ir_filename = f"sim_{simulation_id}_src_{pair.source_id}_rcv_{pair.receiver_id}.wav"
            ir_path = RIR_OUTPUT_DIR / ir_filename
            
            rir_int16 = np.int16(rir_data * 32767)
            wavfile.write(str(ir_path), AUDIO_SAMPLE_RATE, rir_int16)
            
            print(f"  Exported {num_channels}-channel IR: {ir_filename}")
            ir_files.append(ir_filename)
            
            # Collect results
            result_entry = {
                "source_id": pair.source_id,
                "receiver_id": pair.receiver_id,
                "source_position": pair.source_position,
                "receiver_position": pair.receiver_position,
                "ir_file": ir_filename,
                "sample_rate": AUDIO_SAMPLE_RATE,
                "max_order": settings.max_order,
                "ray_tracing": settings.ray_tracing,
                "air_absorption": settings.air_absorption,
                "simulation_mode": simulation_mode,
                "num_channels": num_channels,
                "speckle_source": {
                    "project_id": speckle_project_id,
                    "version_id": speckle_version_id,
                    "layer_name": layer_name
                }
            }
            
            if simulation_mode in [PYROOMACOUSTICS_SIMULATION_MODE_FOA, PYROOMACOUSTICS_SIMULATION_MODE_FOA_RAYTRACING]:
                result_entry["channel_ordering"] = "FuMa"
                result_entry["normalization_convention"] = "N3D"
                if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA_RAYTRACING:
                    result_entry["encoding_method"] = "a_format_tetrahedral"
                    result_entry["original_format"] = "A-format"
                else:
                    result_entry["encoding_method"] = "directivity"
            
            if ray_tracing:
                result_entry["n_rays"] = n_rays
                result_entry["scattering"] = scattering
            
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
                "speckle_source": {
                    "project_id": speckle_project_id,
                    "version_id": speckle_version_id,
                    "layer_name": layer_name
                },
                "results": results_data
            }, f, indent=2)
        
        print(f"\n{'='*60}")
        print(f"Speckle simulation completed successfully")
        print(f"  simulation_id: {simulation_id}")
        print(f"  Number of IR files: {len(ir_files)}")
        print(f"{'='*60}\n")
        
        return SimulationResult(
            simulation_id=simulation_id,
            message="Speckle simulation completed successfully",
            ir_files=ir_files,
            results_file=results_filename
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Speckle simulation error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Speckle simulation failed: {str(e)}")


def init_pyroomacoustics_router():
    """Initialize the Pyroomacoustics router (for dependency injection pattern)"""
    return router
