"""
SED Audio Segment Extraction Router

Extracts, calibrates, and optionally denoises audio segments identified
by YAMNet sound event detection. Returns pre-processed WAV files that
can be directly used as upload-type sound cards.
"""

import os
import json
import uuid
import numpy as np
import soundfile as sf
from fastapi import APIRouter, File, UploadFile, HTTPException, Form
from typing import Optional

router = APIRouter()

# Global audio_service reference (set by init)
_audio_service = None


def init_sed_extract_router(audio_service):
    global _audio_service
    _audio_service = audio_service


@router.post("/api/extract-sed-segments")
async def extract_sed_segments(
    file: UploadFile = File(...),
    segments_json: str = Form(...),
    apply_noise_reduction: bool = Form(False),
    target_spl_db: float = Form(70.0),
):
    """
    Extract audio segments identified by SED analysis, calibrate them, and return URLs.

    For each detected sound event, this endpoint:
      1. Slices the original audio at each detection segment's timestamps
      2. Calibrates the slice to target_spl_db via calibrate_audio_file
      3. Optionally applies noise reduction
      4. Saves the processed slice to GENERATED_SOUNDS_DIR
      5. Returns a URL for each variant

    Request:
        - file: Original audio file (wav, mp3, etc.)
        - segments_json: JSON list of {name, detection_segments: [{start_sec, end_sec}]}
        - apply_noise_reduction: Whether to apply denoising (default False)
        - target_spl_db: Target SPL in dB (default 70)

    Response:
        {
          "sounds": [
            {
              "name": "Bouncing",
              "variants": [
                {"url": "/static/sounds/generated/sed_Bouncing_0_xxx.wav", "duration": 1.5},
                {"url": "/static/sounds/generated/sed_Bouncing_1_xxx.wav", "duration": 0.9}
              ]
            },
            ...
          ]
        }
    """
    from config.constants import TEMP_UPLOADS_DIR, GENERATED_SOUNDS_DIR, GENERATED_SOUND_URL_PREFIX

    if _audio_service is None:
        raise HTTPException(status_code=503, detail="Audio service not initialized")

    os.makedirs(TEMP_UPLOADS_DIR, exist_ok=True)
    os.makedirs(GENERATED_SOUNDS_DIR, exist_ok=True)

    # Parse segments JSON
    try:
        segments_list = json.loads(segments_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid segments_json: {e}")

    # Save uploaded file
    session_id = uuid.uuid4().hex[:8]
    source_path = os.path.join(TEMP_UPLOADS_DIR, f"sed_source_{session_id}_{file.filename}")
    try:
        content = await file.read()
        with open(source_path, "wb") as f_out:
            f_out.write(content)

        # Read audio once for slicing
        audio_np, sample_rate = sf.read(source_path)
        total_samples = audio_np.shape[0] if audio_np.ndim == 1 else audio_np.shape[0]

        output_sounds = []

        for sound_entry in segments_list:
            name = sound_entry.get("name", "sound")
            detection_segments = sound_entry.get("detection_segments", [])

            variants = []
            for seg_idx, seg in enumerate(detection_segments):
                start_sec = float(seg.get("start_sec", 0))
                end_sec = float(seg.get("end_sec", 0))
                if end_sec <= start_sec:
                    continue

                # Clamp to audio bounds
                start_sample = max(0, int(start_sec * sample_rate))
                end_sample = min(total_samples, int(end_sec * sample_rate))
                if end_sample <= start_sample:
                    continue

                # Slice audio
                if audio_np.ndim == 1:
                    segment_audio = audio_np[start_sample:end_sample]
                else:
                    segment_audio = audio_np[start_sample:end_sample, :]

                # Write raw segment to temp file
                safe_name = "".join(c for c in name if c.isalnum() or c in "_- ")[:30].strip().replace(" ", "_")
                temp_seg_path = os.path.join(
                    TEMP_UPLOADS_DIR,
                    f"sed_seg_{session_id}_{safe_name}_{seg_idx}.wav"
                )
                sf.write(temp_seg_path, segment_audio, sample_rate)

                # Calibrate (normalize RMS + optional denoise + SPL calibration)
                out_filename = f"sed_{safe_name}_{seg_idx}_{session_id}.wav"
                out_path = os.path.join(GENERATED_SOUNDS_DIR, out_filename)
                try:
                    _audio_service.calibrate_audio_file(
                        input_path=temp_seg_path,
                        output_path=out_path,
                        target_spl_db=target_spl_db,
                        apply_denoising=apply_noise_reduction,
                    )
                    duration = float(end_sec - start_sec)
                    variants.append({
                        "url": f"{GENERATED_SOUND_URL_PREFIX}/{out_filename}",
                        "duration": round(duration, 3),
                    })
                except Exception as e:
                    print(f"[SED Extract] Failed to calibrate segment {seg_idx} for '{name}': {e}")
                finally:
                    # Clean up raw temp segment
                    if os.path.exists(temp_seg_path):
                        try:
                            os.remove(temp_seg_path)
                        except Exception:
                            pass

            if variants:
                output_sounds.append({"name": name, "variants": variants})

        return {"sounds": output_sounds}

    except HTTPException:
        raise
    except Exception as e:
        print(f"[SED Extract] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")
    finally:
        if os.path.exists(source_path):
            try:
                os.remove(source_path)
            except Exception:
                pass
