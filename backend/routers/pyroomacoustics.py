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
from services.speckle_service import SpeckleService
from utils.audio_processing import trim_ir
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
    PYROOMACOUSTICS_SAMPLE_RATE,
    TEMP_SIMULATIONS_DIR,
    PYROOMACOUSTICS_DEFAULT_ABSORPTION,
    PYROOMACOUSTICS_GRID_DEFAULT_ENABLED,
    PYROOMACOUSTICS_IR_TRIM_THRESHOLD
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
    grid_plot_file: Optional[str] = None  # JPG heatmap filename (when enable_grid=True)


@router.get("/pyroomacoustics/materials")
async def get_materials():
    """
    Get available material presets for pyroomacoustics simulation.
    Returns materials from the service's material database.
    """
    try:
        materials_db = PyroomacousticsService.get_material_database()

        materials = [
            {
                "id": material_id,
                "name": material_id.replace("_", " ").title(),
                "description": props.get("description", ""),
                "absorption": (
                    sum(props["coeffs"]) / len(props["coeffs"]) 
                    if props.get("coeffs") else PYROOMACOUSTICS_DEFAULT_ABSORPTION
                )
            }
            # 1. Outer loop: Extract the dictionary of materials for each category
            for category_materials in materials_db.values()
            # 2. Inner loop: Extract the ID and Props for each material
            for material_id, props in category_materials.items()
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
    if file_type not in ['wav', 'json', 'jpg']:
        raise HTTPException(status_code=400, detail="file_type must be 'wav', 'json', or 'jpg'")

    if file_type == 'json':
        # Return results JSON from temp directory
        filename = f"simulation_{simulation_id}_results.json"
        file_path = TEMP_DIR / filename
        media_type = "application/json"
    elif file_type == 'jpg':
        # Return grid plot JPG from RIR directory
        filename = f"sim_{simulation_id}_grid_db.jpg"
        file_path = RIR_OUTPUT_DIR / filename
        media_type = "image/jpeg"
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
    geometry_object_ids: Optional[str] = Form(None),  # JSON: ["id1", "id2", ...] from frontend
    max_order: int = Form(PYROOMACOUSTICS_DEFAULT_MAX_ORDER),
    ray_tracing: bool = Form(PYROOMACOUSTICS_DEFAULT_RAY_TRACING),
    air_absorption: bool = Form(PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION),
    n_rays: int = Form(PYROOMACOUSTICS_RAY_TRACING_N_RAYS),
    object_scattering: str = Form('{}'),  # JSON: {"object_id": scattering_value} per-object scattering
    simulation_mode: str = Form(PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE),
    enable_grid: bool = Form(PYROOMACOUSTICS_GRID_DEFAULT_ENABLED),
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
        object_ids_filter = json.loads(geometry_object_ids) if geometry_object_ids else None
        object_scattering_dict: dict[str, float] = json.loads(object_scattering) if object_scattering else {}
        
        # Log simulation parameters
        print(f"\n{'='*60}")
        print(f"Pyroomacoustics Speckle Simulation Request")
        print(f"{'='*60}")
        print(f"Simulation ID: {simulation_id}")
        print(f"Speckle Project ID: {speckle_project_id}")
        print(f"Speckle Version ID: {speckle_version_id}")
        print(f"Layer Name: {layer_name}")
        if object_ids_filter:
            print(f"Geometry Object IDs filter: {len(object_ids_filter)} IDs from frontend")
        print(f"Simulation Name: {simulation_name}")
        print(f"Settings:")
        print(f"  - Simulation Mode: {simulation_mode}")
        print(f"  - Max Order: {max_order}")
        print(f"  - Ray Tracing: {ray_tracing}")
        print(f"  - Air Absorption: {air_absorption}")
        if ray_tracing:
            print(f"  - Number of Rays: {n_rays}")
            print(f"  - Per-object scattering assignments: {len(object_scattering_dict)} objects")
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
            layer_name=layer_name,
            object_ids_filter=object_ids_filter
        )
        
        if not geometry_data:
            raise HTTPException(status_code=500, detail="Failed to retrieve geometry from Speckle")
        
        # Extract mesh data
        vertices = geometry_data.get("vertices", [])
        faces = geometry_data.get("faces", [])
        object_ids = geometry_data.get("object_ids", [])
        object_face_ranges = geometry_data.get("object_face_ranges", {})
        
        print(f"Geometry data returned: vertices={len(vertices)}, faces={len(faces)}, objects={len(object_ids)}")
        # print(f"Geometry data keys: {list(geometry_data.keys())}")
        
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
            
            if object_ids_filter:
                raise HTTPException(
                    status_code=400,
                    detail=f"No geometry found for the {len(object_ids_filter)} object IDs sent from the frontend. "
                           f"Ensure the objects have mesh display values in Speckle."
                )
            raise HTTPException(
                status_code=400,
                detail=f"No valid geometry found in Speckle layer '{layer_name}'. "
                       f"Ensure the layer contains mesh objects with display values."
            )
        
        print(f"Extracted geometry: {len(vertices)} vertices, {len(faces)} faces from {len(object_ids)} objects")
        
        # Map object materials to face materials
        face_material_map = {}
        
        for obj_id, material_id in object_materials_dict.items():
            if obj_id not in object_face_ranges:
                print(f"  Warning: Object ID '{obj_id}' not found in geometry")
                continue

            start_face, end_face = object_face_ranges[obj_id]
      
            # Assign material to all faces in this object
            for face_idx in range(start_face, end_face + 1):
                face_material_map[face_idx] = material_id
            
        print(f"Mapped materials to {len(face_material_map)} faces")
        
        # Build per-face scattering map from per-object scattering assignments
        # (only meaningful when ray_tracing=True, but built always so it persists through the call)
        face_scattering_map = None
        if ray_tracing:
            face_scattering_map = {}
            for obj_id, scatter_val in object_scattering_dict.items():
                if obj_id not in object_face_ranges:
                    print(f"  Warning: Object ID '{obj_id}' not found in geometry for scattering")
                    continue
                start_face, end_face = object_face_ranges[obj_id]
                for face_idx in range(start_face, end_face + 1):
                    face_scattering_map[face_idx] = float(scatter_val)
            print(f"  Built per-face scattering map: {len(face_scattering_map)} faces assigned, "
                  f"unassigned faces will use default ({PYROOMACOUSTICS_DEFAULT_SCATTERING})")
        
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
        elif simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA:
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
            fs=PYROOMACOUSTICS_SAMPLE_RATE,
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
                raise HTTPException(status_code=400, detail=f"Failed to add source '{source_id}' at position {source_position} : {error_msg}")
        
        # Add all receivers
        for receiver_id, (receiver_position, _) in unique_receivers.items():
            try:
                PyroomacousticsService.add_receiver_to_room(room, receiver_position, simulation_mode)
                print(f"  Added {simulation_mode} receiver {receiver_id} at {receiver_position}")
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
            PyroomacousticsService.enable_ray_tracing(room, n_rays=n_rays)

        # Compute RIR
        room.compute_rir()
        
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
            
            # Extract RIR
            if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO:
                rir = room.rir[mic_start_idx][source_idx]
                if rir is None or len(rir) == 0:
                    raise HTTPException(
                        status_code=500,
                        detail=f"Empty RIR for source '{pair.source_id}' -> receiver '{pair.receiver_id}'"
                    )
                rir_data = rir
            else:
                # FOA: extract 4 directivity channels (W, Y, Z, X in ACN order)
                channel_names_list = ['W', 'Y', 'Z', 'X']
                rir_channels = []

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
                padded_channels = [
                    np.pad(rir, (0, max_length - len(rir)), mode='constant') if len(rir) < max_length else rir
                    for rir in rir_channels
                ]

                # Directivity mics are oriented to capture AmbiX ACN channels directly:
                #   Ch0=W (omni), Ch1=Y (-X mesh=Left), Ch2=Z (+Z mesh=Up), Ch3=X (-Y mesh=Front)
                # No channel transform needed — already in correct AmbiX ACN order with SN3D normalization
                rir_data = np.column_stack(padded_channels)
            
            # Calculate acoustic parameters
            try:
                first_channel_rir = room.rir[mic_start_idx][source_idx]
                acoustic_params = AcousticMeasurement.calculate_acoustic_parameters_from_rir(
                    first_channel_rir, PYROOMACOUSTICS_SAMPLE_RATE
                )
            except Exception as e:
                print(f"Warning: Failed to calculate acoustic parameters: {e}")
                acoustic_params = None
            
            # Trim trailing silence from the IR
            rir_data = trim_ir(rir_data, threshold_fraction=PYROOMACOUSTICS_IR_TRIM_THRESHOLD)

            # Export impulse response
            ir_filename = f"sim_{simulation_id}_src_{pair.source_id}_rcv_{pair.receiver_id}.wav"
            ir_path = RIR_OUTPUT_DIR / ir_filename

            rir_int16 = np.int16(rir_data * 32767)
            wavfile.write(str(ir_path), PYROOMACOUSTICS_SAMPLE_RATE, rir_int16)
            
            print(f"  Exported {num_channels}-channel IR: {ir_filename}")
            ir_files.append(ir_filename)
            
            # Collect results
            result_entry = {
                "source_id": pair.source_id,
                "receiver_id": pair.receiver_id,
                "source_position": pair.source_position,
                "receiver_position": pair.receiver_position,
                "ir_file": ir_filename,
                "sample_rate": PYROOMACOUSTICS_SAMPLE_RATE,
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
            
            if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA:
                result_entry["channel_ordering"] = "ACN"
                result_entry["normalization_convention"] = "SN3D"
                result_entry["format"] = "AmbiX"
                result_entry["encoding_method"] = "directivity"
            
            if ray_tracing:
                result_entry["n_rays"] = n_rays
                result_entry["scattering_per_object"] = object_scattering_dict
            
            if acoustic_params:
                result_entry["acoustic_parameters"] = acoustic_params
            
            results_data.append(result_entry)

        # ── Grid Receiver Simulation (optional) ───────────────────────────
        grid_plot_filename = None

        if enable_grid:
            print(f"\n{'='*60}")
            print(f"Running grid receiver simulation...")
            print(f"{'='*60}")

            try:
                # Load grid receiver points from file
                grid_points = PyroomacousticsService.load_receiver_grid()

                # Collect source positions
                all_source_positions = [pos for pos, _ in unique_sources.values()]

                # Build room factory args (same geometry + materials as main sim)
                room_factory_args = dict(
                    vertices=vertices,
                    faces=faces,
                    face_materials=face_material_map if face_material_map else None,
                    face_scattering=face_scattering_map,
                    fs=PYROOMACOUSTICS_SAMPLE_RATE,
                    max_order=settings.max_order,
                    ray_tracing=False,       # Grid uses ISM only for speed
                    air_absorption=settings.air_absorption
                )

                # Run grid simulation
                grid_result = PyroomacousticsService.simulate_grid(
                    room_factory_args=room_factory_args,
                    source_positions=all_source_positions,
                    grid_points=grid_points,
                    fs=PYROOMACOUSTICS_SAMPLE_RATE
                )

                # Generate heatmap plot for first source (dB levels)
                grid_plot_filename = f"sim_{simulation_id}_grid_db.jpg"
                grid_plot_path = str(RIR_OUTPUT_DIR / grid_plot_filename)

                PyroomacousticsService.plot_grid_results(
                    source_pos=all_source_positions[0],
                    receivers_pos=grid_result['grid_points'],
                    values=grid_result['db_levels'][0],
                    title="dB Level",
                    output_path=grid_plot_path
                )

                print(f"Grid plot saved: {grid_plot_filename}")

            except Exception as e:
                import traceback
                print(f"Grid simulation warning: {traceback.format_exc()}")
                print(f"Grid simulation failed (non-fatal): {str(e)}")
                grid_plot_filename = None

        # Save results JSON
        results_filename = f"simulation_{simulation_id}_results.json"
        results_path = TEMP_DIR / results_filename

        results_json = {
            "simulation_id": simulation_id,
            "simulation_name": simulation_name,
            "settings": settings.dict(),
            "speckle_source": {
                "project_id": speckle_project_id,
                "version_id": speckle_version_id,
                "layer_name": layer_name
            },
            "results": results_data
        }

        if grid_plot_filename:
            results_json["grid_plot_file"] = grid_plot_filename

        with open(results_path, "w") as f:
            json.dump(results_json, f, indent=2)

        print(f"\n{'='*60}")
        print(f"Speckle simulation completed successfully")
        print(f"  simulation_id: {simulation_id}")
        print(f"  Number of IR files: {len(ir_files)}")
        if grid_plot_filename:
            print(f"  Grid plot: {grid_plot_filename}")
        print(f"{'='*60}\n")

        return SimulationResult(
            simulation_id=simulation_id,
            message="Speckle simulation completed successfully",
            ir_files=ir_files,
            results_file=results_filename,
            grid_plot_file=grid_plot_filename
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
