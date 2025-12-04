"""
Pyroomacoustics acoustic simulation integration endpoints
"""
from fastapi import APIRouter, HTTPException
from pathlib import Path
import time
import os

from models.schemas import (
    PyroomacousticsSimulationRequest,
    PyroomacousticsSimulationResponse,
    PyroomacousticsMaterialsResponse,
    PyroomacousticsMaterial,
    AcousticParameters
)
from services.pyroomacoustics_service import PyroomacousticsService
from config.constants import (
    PYROOMACOUSTICS_RIR_DIR,
    PYROOMACOUSTICS_RIR_URL_PREFIX,
    PYROOMACOUSTICS_DEFAULT_WIDTH,
    PYROOMACOUSTICS_DEFAULT_LENGTH,
    PYROOMACOUSTICS_DEFAULT_HEIGHT
)

router = APIRouter()


@router.post("/pyroomacoustics/simulate", response_model=PyroomacousticsSimulationResponse)
async def simulate_room_acoustics(request: PyroomacousticsSimulationRequest):
    """
    Simulate room acoustics using pyroomacoustics library.

    Creates a shoebox room with specified dimensions and materials,
    computes the room impulse response using the image source method,
    calculates acoustic parameters (RT60, EDT, C50, C80, D50, DRR),
    and exports the RIR as a WAV file.

    Args:
        request: Simulation request with room dimensions, materials, positions, and settings

    Returns:
        Simulation response with RIR file URL and acoustic parameters
    """
    start_time = time.time()

    try:
        # Use default room dimensions if not provided
        if request.room_dimensions is None:
            room_dimensions = [
                PYROOMACOUSTICS_DEFAULT_WIDTH,
                PYROOMACOUSTICS_DEFAULT_LENGTH,
                PYROOMACOUSTICS_DEFAULT_HEIGHT
            ]
        else:
            room_dimensions = request.room_dimensions

        # Validate room dimensions
        if len(room_dimensions) != 3:
            raise HTTPException(
                status_code=400,
                detail="room_dimensions must be [width, length, height]"
            )

        # Validate materials - must have all 6 walls
        required_walls = {'north', 'south', 'east', 'west', 'floor', 'ceiling'}
        if not all(wall in request.materials for wall in required_walls):
            raise HTTPException(
                status_code=400,
                detail=f"materials must include all walls: {required_walls}"
            )

        # Validate absorption coefficients
        for wall, absorption in request.materials.items():
            if not (0 <= absorption <= 1):
                raise HTTPException(
                    status_code=400,
                    detail=f"Absorption coefficient for {wall} must be between 0 and 1, got {absorption}"
                )

        # Validate positions
        if len(request.source_position) != 3:
            raise HTTPException(
                status_code=400,
                detail="source_position must be [x, y, z] coordinates"
            )
        if len(request.receiver_position) != 3:
            raise HTTPException(
                status_code=400,
                detail="receiver_position must be [x, y, z] coordinates"
            )

        # Create room
        room = PyroomacousticsService.create_shoebox_room(
            dimensions=room_dimensions,
            materials=request.materials,
            fs=request.settings.fs,
            max_order=request.settings.max_order
        )

        # Simulate acoustics (add source/receiver, compute RIR)
        room = PyroomacousticsService.simulate_room_acoustics(
            room=room,
            source_position=request.source_position,
            receiver_position=request.receiver_position
        )

        # Calculate acoustic parameters
        acoustic_params = PyroomacousticsService.calculate_acoustic_parameters(room)

        # Generate output filename
        timestamp = int(time.time() * 1000)
        filename = f"rir_{timestamp}.wav"
        output_path = os.path.join(PYROOMACOUSTICS_RIR_DIR, filename)

        # Export RIR to WAV file
        PyroomacousticsService.export_impulse_response(room, output_path)

        # Calculate computation time
        computation_time = time.time() - start_time

        # Get actual max_order used (from room object)
        actual_max_order = room.max_order

        # Calculate theoretical RT60 for comparison
        theoretical_rt60 = PyroomacousticsService.calculate_sabine_rt60(
            room_dimensions, request.materials
        )

        # Prepare room info
        room_info = {
            "dimensions": {
                "width": room_dimensions[0],
                "length": room_dimensions[1],
                "height": room_dimensions[2]
            },
            "volume": room_dimensions[0] * room_dimensions[1] * room_dimensions[2],
            "materials": request.materials,
            "source_position": request.source_position,
            "receiver_position": request.receiver_position,
            "fs": request.settings.fs,
            "max_order": actual_max_order,
            "max_order_requested": request.settings.max_order,
            "theoretical_rt60": round(theoretical_rt60, 3),
            "rt60_error_percent": round(abs(acoustic_params['rt60'] - theoretical_rt60) / theoretical_rt60 * 100, 1)
        }

        # Return response
        return PyroomacousticsSimulationResponse(
            rir_url=f"{PYROOMACOUSTICS_RIR_URL_PREFIX}/{filename}",
            rir_path=output_path,
            acoustic_parameters=AcousticParameters(**acoustic_params),
            room_info=room_info,
            computation_time=computation_time
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Simulation failed: {str(e)}"
        )


@router.get("/pyroomacoustics/materials", response_model=PyroomacousticsMaterialsResponse)
async def get_material_database():
    """
    Get database of material absorption presets.

    Returns a dictionary of 11 predefined materials with their absorption
    coefficients, descriptions, and categories (Wall, Floor, Ceiling, Soft).

    Returns:
        Material database with absorption presets
    """
    try:
        materials_dict = PyroomacousticsService.get_material_database()

        # Convert to response model format
        materials_response = {}
        for name, props in materials_dict.items():
            materials_response[name] = PyroomacousticsMaterial(**props)

        return PyroomacousticsMaterialsResponse(materials=materials_response)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve materials: {str(e)}"
        )


def init_pyroomacoustics_router():
    """Initialize the pyroomacoustics router (for dependency injection pattern)"""
    # Create output directory for RIR files
    Path(PYROOMACOUSTICS_RIR_DIR).mkdir(parents=True, exist_ok=True)
    print(f"Pyroomacoustics RIR directory: {PYROOMACOUSTICS_RIR_DIR}")
    return router
