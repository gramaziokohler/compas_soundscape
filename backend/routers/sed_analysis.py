"""
Sound Event Detection (SED) Analysis Router

API endpoints for analyzing audio files to detect sound events.
"""

import os
from fastapi import APIRouter, File, UploadFile, HTTPException, Form
from typing import Optional
from services.sed_service import SEDService

router = APIRouter()

# Global SED service instance (initialized on first use)
_sed_service: Optional[SEDService] = None


def get_sed_service() -> SEDService:
    """
    Get or initialize the SED service (singleton pattern).

    Lazy initialization ensures YAMNet model is only loaded when needed.
    This avoids increasing startup time if SED features aren't used.

    Returns:
        SEDService: Initialized SED service instance
    """
    global _sed_service
    if _sed_service is None:
        _sed_service = SEDService()
    return _sed_service


@router.post("/api/analyze-sound-events")
async def analyze_sound_events(
    file: UploadFile = File(...),
    num_sounds: int = Form(10),
    analyze_amplitudes: bool = Form(True),
    analyze_durations: bool = Form(True),
    top_n_classes: int = Form(100)
):
    """
    Analyze uploaded audio file to detect sound events.

    Request:
        - file: Audio file (wav, mp3, flac, etc.)
        - num_sounds: Number of top sound events to return (default: 10)
        - analyze_amplitudes: Whether to calculate amplitude statistics (default: True)
        - top_n_classes: Maximum classes to analyze (default: 100)

    Response:
        {
            "success": bool,
            "audio_info": {
                "duration": float,
                "sample_rate": int,
                "num_samples": int,
                "channels": "Mono",
                "filename": str
            },
            "detected_sounds": [
                {
                    "name": str,
                    "confidence": float (0-1),
                    "max_amplitude_db": float | null,
                    "max_amplitude_0_1": float | null,
                    "avg_amplitude_db": float | null,
                    "avg_amplitude_0_1": float | null,
                    "max_detection_duration_sec": float | null,
                    "max_silence_duration_sec": float | null
                },
                ...
            ],
            "total_classes_analyzed": int
        }

    Technical details:
        - Uses FastAPI's Form() to parse multipart/form-data
        - File is saved temporarily then analyzed
        - Cleanup happens in finally block to ensure temp file removal
    """
    temp_dir = "temp_uploads"
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, file.filename)

    try:
        # Save uploaded file to temporary location
        print(f"Receiving audio file: {file.filename}")
        with open(temp_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)

        print(f"Analyzing sound events (top {num_sounds} sounds)...")

        # Get SED service (lazy initialization)
        sed_service = get_sed_service()

        # Analyze the audio file
        analysis_result = sed_service.analyze_audio_file(
            file_path=temp_path,
            top_n_classes=top_n_classes,
            analyze_amplitudes=analyze_amplitudes,
            analyze_durations=analyze_durations
        )

        if not analysis_result["success"]:
            raise HTTPException(status_code=500, detail=analysis_result.get("error", "Analysis failed"))

        # Extract top N detected sounds
        all_results = analysis_result["results"]
        detected_sounds = all_results[:num_sounds]

        # Format response for frontend
        # Rename fields to be more user-friendly
        formatted_sounds = []
        for sound in detected_sounds:
            formatted = {
                "name": sound["name"],
                "confidence": sound["mean_score"],
                "max_amplitude_db": sound["max_amplitude_db"],
                "max_amplitude_0_1": sound["max_amplitude_0_1"],
                "avg_amplitude_db": sound["avg_amplitude_db"],
                "avg_amplitude_0_1": sound["avg_amplitude_0_1"],
                "max_detection_duration_sec": sound["max_detection_duration_sec"],
                "max_silence_duration_sec": sound["max_silence_duration_sec"]
            }
            formatted_sounds.append(formatted)

        # Enhance audio_info with additional metadata
        audio_info = analysis_result["audio_info"]
        audio_info["channels"] = "Mono"  # Always mono after preprocessing
        audio_info["filename"] = file.filename

        print(f"✓ Analysis complete: {len(formatted_sounds)} sounds detected")

        return {
            "success": True,
            "audio_info": audio_info,
            "detected_sounds": formatted_sounds,
            "total_classes_analyzed": len(all_results)
        }

    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        print(f"Error analyzing sound events: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to analyze audio: {str(e)}")
    finally:
        # Cleanup: remove temporary file
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                print(f"Warning: Failed to remove temp file {temp_path}: {e}")


@router.get("/api/sed-model-info")
async def get_sed_model_info():
    """
    Get information about the SED model.

    Response:
        {
            "model_name": "YAMNet",
            "num_classes": 521,
            "sample_rate": 16000,
            "frame_hop_seconds": 0.48,
            "frame_window_seconds": 0.96
        }
    """
    try:
        sed_service = get_sed_service()
        return sed_service.get_model_info()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get model info: {str(e)}")
