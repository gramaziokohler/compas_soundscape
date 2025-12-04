"""
Choras acoustic simulation integration endpoints
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import httpx
import os
from pathlib import Path
import json
from typing import Optional

router = APIRouter()

CHORAS_API_BASE = "http://localhost:5001"
TEMP_DIR = Path(__file__).parent.parent / "temp"

class SaveResultsRequest(BaseModel):
    simulationId: int

class SaveResultsResponse(BaseModel):
    wav_path: str
    json_path: str
    message: str

@router.post("/choras/save-results", response_model=SaveResultsResponse)
async def save_simulation_results(request: SaveResultsRequest):
    """
    Download simulation results from Choras backend and save to backend/temp directory.
    Downloads both the impulse response WAV file and results JSON.
    """
    simulation_id = request.simulationId

    # Ensure temp directory exists
    TEMP_DIR.mkdir(exist_ok=True)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Download impulse response WAV file
            wav_url = f"{CHORAS_API_BASE}/auralizations/{simulation_id}/impulse/wav"
            wav_response = await client.get(wav_url)

            if wav_response.status_code != 200:
                raise HTTPException(
                    status_code=wav_response.status_code,
                    detail=f"Failed to download WAV file from Choras: {wav_response.text}"
                )

            # Save WAV file
            wav_filename = f"simulation_{simulation_id}_impulse_response.wav"
            wav_path = TEMP_DIR / wav_filename
            wav_path.write_bytes(wav_response.content)

            # Download results JSON
            json_url = f"{CHORAS_API_BASE}/simulations/{simulation_id}/result"
            json_response = await client.get(json_url)

            if json_response.status_code != 200:
                raise HTTPException(
                    status_code=json_response.status_code,
                    detail=f"Failed to download results from Choras: {json_response.text}"
                )

            # Save JSON file
            json_filename = f"simulation_{simulation_id}_results.json"
            json_path = TEMP_DIR / json_filename

            # Pretty print JSON
            result_data = json_response.json()
            json_path.write_text(json.dumps(result_data, indent=2))

            return SaveResultsResponse(
                wav_path=str(wav_path),
                json_path=str(json_path),
                message=f"Results saved successfully to {TEMP_DIR}"
            )

    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot connect to Choras backend at {CHORAS_API_BASE}: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error saving results: {str(e)}"
        )

@router.get("/choras/get-result-file/{simulation_id}/{file_type}")
async def get_result_file(simulation_id: int, file_type: str):
    """
    Retrieve a simulation result file (wav or json) from backend/temp directory.

    Args:
        simulation_id: The simulation ID
        file_type: Either 'wav' or 'json'

    Returns:
        The file as a response
    """
    # Validate file_type
    if file_type not in ['wav', 'json']:
        raise HTTPException(status_code=400, detail="file_type must be 'wav' or 'json'")

    # Construct filename
    if file_type == 'wav':
        filename = f"simulation_{simulation_id}_impulse_response.wav"
        media_type = "audio/wav"
    else:  # json
        filename = f"simulation_{simulation_id}_results.json"
        media_type = "application/json"

    # Full path to file
    file_path = TEMP_DIR / filename

    # Check if file exists
    if not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"File not found: {filename}"
        )

    # Return file
    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=filename
    )

def init_choras_router():
    """Initialize the Choras router (for dependency injection pattern)"""
    return router
