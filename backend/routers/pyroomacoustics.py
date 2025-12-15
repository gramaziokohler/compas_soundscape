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
from config.constants import (
    PYROOMACOUSTICS_RIR_DIR,
    PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
    PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
    PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
    PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
    PYROOMACOUSTICS_DEFAULT_SCATTERING,
    PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
    PYROOMACOUSTICS_SIMULATION_MODE_MONO,
    PYROOMACOUSTICS_SIMULATION_MODE_BINAURAL,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
    PYROOMACOUSTICS_BINAURAL_EAR_SPACING,
    PYROOMACOUSTICS_FOA_MIC_RADIUS,
    AUDIO_SAMPLE_RATE,
    TEMP_SIMULATIONS_DIR
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
    simulation_mode: str = Form(PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE),  # "mono", "binaural", or "foa"
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
        print(f"  - Simulation Mode: {simulation_mode}")
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

        # Extract unique sources and receivers from pairs
        unique_sources = {}  # source_id -> (position, index)
        unique_receivers = {}  # receiver_id -> (position, index)

        for pair_dict in pairs_data:
            pair = SourceReceiverPair(**pair_dict)

            # Track unique sources
            if pair.source_id not in unique_sources:
                unique_sources[pair.source_id] = (pair.source_position, len(unique_sources))

            # Track unique receivers
            if pair.receiver_id not in unique_receivers:
                unique_receivers[pair.receiver_id] = (pair.receiver_position, len(unique_receivers))

        print(f"  Unique sources: {len(unique_sources)}, Unique receivers: {len(unique_receivers)}")
        print(f"  Simulation mode: {simulation_mode}")

        # Determine number of channels based on simulation mode
        if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO:
            num_channels = 1
        elif simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_BINAURAL:
            num_channels = 2
        elif simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA:
            num_channels = 4
        else:
            raise HTTPException(status_code=400, detail=f"Invalid simulation mode: {simulation_mode}")

        print(f"  Number of channels per receiver: {num_channels}")

        # Create ONE room for all sources and receivers
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

        # Add all sources to the room
        for source_id, (source_position, _) in unique_sources.items():
            try:
                room.add_source(source_position)
                print(f"  Added source {source_id} at {source_position}")
            except (ValueError, AssertionError) as e:
                error_msg = str(e)
                if "inside" in error_msg.lower() or "outside" in error_msg.lower():
                    raise HTTPException(
                        status_code=400,
                        detail=f"Source '{source_id}' at position {source_position} is not inside the room geometry. "
                               f"Please ensure sources are placed within the model bounds."
                    )
                raise HTTPException(status_code=400, detail=f"Failed to add source '{source_id}': {error_msg}")

        # Add all receivers to the room (with appropriate microphone configuration)
        for receiver_id, (receiver_position, _) in unique_receivers.items():
            try:
                if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO:
                    # Single omnidirectional microphone
                    room.add_microphone(receiver_position)
                    print(f"  Added mono receiver {receiver_id} at {receiver_position}")

                elif simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_BINAURAL:
                    # Two microphones for binaural (left and right ears)
                    half_spacing = PYROOMACOUSTICS_BINAURAL_EAR_SPACING / 2.0
                    left_ear_pos = [receiver_position[0], receiver_position[1] - half_spacing, receiver_position[2]]
                    right_ear_pos = [receiver_position[0], receiver_position[1] + half_spacing, receiver_position[2]]
                    room.add_microphone(left_ear_pos)  # Left channel
                    room.add_microphone(right_ear_pos)  # Right channel
                    print(f"  Added binaural receiver {receiver_id}: L={left_ear_pos}, R={right_ear_pos}")

                elif simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA:
                    # Four microphones for FOA (W, X, Y, Z)
                    r = PYROOMACOUSTICS_FOA_MIC_RADIUS
                    w_pos = receiver_position
                    x_pos = [receiver_position[0] + r, receiver_position[1], receiver_position[2]]
                    y_pos = [receiver_position[0], receiver_position[1] + r, receiver_position[2]]
                    z_pos = [receiver_position[0], receiver_position[1], receiver_position[2] + r]
                    room.add_microphone(w_pos)  # W channel
                    room.add_microphone(x_pos)  # X channel
                    room.add_microphone(y_pos)  # Y channel
                    room.add_microphone(z_pos)  # Z channel
                    print(f"  Added FOA receiver {receiver_id}: W={w_pos}, X={x_pos}, Y={y_pos}, Z={z_pos}")

            except (ValueError, AssertionError) as e:
                error_msg = str(e)
                if "inside" in error_msg.lower() or "outside" in error_msg.lower():
                    raise HTTPException(
                        status_code=400,
                        detail=f"Receiver '{receiver_id}' at position {receiver_position} is not inside the room geometry. "
                               f"Please ensure receivers are placed within the model bounds."
                    )
                raise HTTPException(status_code=400, detail=f"Failed to add receiver '{receiver_id}': {error_msg}")

        # Enable ray tracing if needed
        if ray_tracing:
            try:
                PyroomacousticsService.enable_ray_tracing(room, n_rays=n_rays)
                print("Ray tracing enabled for hybrid ISM/ray tracing simulation")
            except Exception as e:
                print(f"Warning: Failed to enable ray tracing: {type(e).__name__}: {str(e)}")

        # Compute RIR for all source-receiver pairs at once
        print(f"  Computing RIRs...")
        room.compute_rir()
        print(f"  RIR computation complete!")

        # Debug: Check RIR structure
        print(f"  Total microphones in room.rir: {len(room.rir)}")
        print(f"  Total sources in room.rir[0]: {len(room.rir[0]) if len(room.rir) > 0 else 0}")
        for mic_idx in range(min(len(room.rir), 4)):  # Show first 4 mics
            for src_idx in range(min(len(room.rir[mic_idx]), 2)):  # Show first 2 sources
                rir_len = len(room.rir[mic_idx][src_idx]) if room.rir[mic_idx][src_idx] is not None else 0
                print(f"    RIR[mic={mic_idx}][src={src_idx}]: length={rir_len}")

        # Import acoustic measurement utilities
        from utils.acoustic_measurement import AcousticMeasurement

        # Export IRs and collect results for each requested pair
        ir_files = []
        results_data = []

        for pair_dict in pairs_data:
            pair = SourceReceiverPair(**pair_dict)

            # Get indices for this pair
            source_idx = unique_sources[pair.source_id][1]
            receiver_base_idx = unique_receivers[pair.receiver_id][1]

            # Calculate the actual microphone index based on simulation mode
            # Microphones are added in order for each receiver
            mic_start_idx = receiver_base_idx * num_channels

            # Extract RIR(s) from room.rir[mic_idx][source_idx]
            if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO:
                # Single channel
                rir = room.rir[mic_start_idx][source_idx]

                # Validate RIR is not empty
                if rir is None or len(rir) == 0:
                    raise HTTPException(
                        status_code=500,
                        detail=f"Empty RIR for source '{pair.source_id}' -> receiver '{pair.receiver_id}'. "
                               f"This may indicate microphone positions are invalid or outside the room geometry."
                    )

                rir_data = rir  # 1D array
            else:
                # Multi-channel (binaural or FOA)
                rir_channels = []
                for ch in range(num_channels):
                    mic_idx = mic_start_idx + ch

                    # Validate microphone index
                    if mic_idx >= len(room.rir):
                        raise HTTPException(
                            status_code=500,
                            detail=f"Microphone index {mic_idx} out of range (total mics: {len(room.rir)}). "
                                   f"Expected {num_channels} channels for {simulation_mode} mode."
                        )

                    rir = room.rir[mic_idx][source_idx]

                    # Validate RIR is not empty
                    if rir is None or len(rir) == 0:
                        channel_names = {
                            PYROOMACOUSTICS_SIMULATION_MODE_BINAURAL: ['Left', 'Right'],
                            PYROOMACOUSTICS_SIMULATION_MODE_FOA: ['W', 'X', 'Y', 'Z']
                        }
                        channel_name = channel_names[simulation_mode][ch] if ch < len(channel_names[simulation_mode]) else f"Channel {ch}"

                        raise HTTPException(
                            status_code=500,
                            detail=f"Empty RIR for {channel_name} channel (mic {mic_idx}) "
                                   f"in {simulation_mode} mode for source '{pair.source_id}' -> receiver '{pair.receiver_id}'. "
                                   f"This may indicate microphone positions are invalid or outside the room geometry."
                        )

                    rir_channels.append(rir)
                    print(f"    Channel {ch} ({mic_idx}): RIR length = {len(rir)}")

                # Validate we collected the expected number of channels
                if len(rir_channels) != num_channels:
                    raise HTTPException(
                        status_code=500,
                        detail=f"Expected {num_channels} channels for {simulation_mode} mode, but got {len(rir_channels)}"
                    )

                # Find maximum length among all channels (RIRs can have different lengths)
                max_length = max(len(rir) for rir in rir_channels)
                print(f"    Max RIR length across channels: {max_length}")

                # Pad all channels to the same length with zeros
                padded_channels = []
                for rir in rir_channels:
                    if len(rir) < max_length:
                        # Pad with zeros at the end
                        padded_rir = np.pad(rir, (0, max_length - len(rir)), mode='constant')
                        padded_channels.append(padded_rir)
                    else:
                        padded_channels.append(rir)

                # Stack channels into multi-channel array [n_samples, n_channels]
                rir_data = np.column_stack(padded_channels)

            # Calculate acoustic parameters from the first channel (W/mono/left)
            try:
                first_channel_rir = room.rir[mic_start_idx][source_idx]
                acoustic_params = AcousticMeasurement.calculate_acoustic_parameters_from_rir(
                    first_channel_rir, AUDIO_SAMPLE_RATE
                )
            except Exception as e:
                print(f"Warning: Failed to calculate acoustic parameters for {pair.source_id}->{pair.receiver_id}: {e}")
                acoustic_params = None

            # Export impulse response
            ir_filename = f"sim_{simulation_id}_src_{pair.source_id}_rcv_{pair.receiver_id}.wav"
            ir_path = RIR_OUTPUT_DIR / ir_filename

            # Export RIR to WAV (mono or multi-channel)
            rir_int16 = np.int16(rir_data * 32767)
            wavfile.write(str(ir_path), AUDIO_SAMPLE_RATE, rir_int16)

            print(f"  Exported {num_channels}-channel IR: {ir_filename}")

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
                "air_absorption": settings.air_absorption,
                "simulation_mode": simulation_mode,
                "num_channels": num_channels
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

        print(f"\n{'='*60}")
        print(f"Returning simulation result:")
        print(f"  simulation_id: {simulation_id}")
        print(f"  Number of IR files: {len(ir_files)}")
        print(f"  IR files list: {ir_files}")
        print(f"{'='*60}\n")

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


def init_pyroomacoustics_router():
    """Initialize the Pyroomacoustics router (for dependency injection pattern)"""
    return router
