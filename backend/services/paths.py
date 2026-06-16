from pathlib import Path

from config.constants import BACKEND_DIR

SOUNDSCAPE_DATA_DIR = str(BACKEND_DIR / "data" / "soundscapes")
GENERATED_SOUNDS_PARENT = str(BACKEND_DIR / "temp" / "static" / "sounds" / "generated")


def user_data_dir(session_id: str) -> Path:
    return Path(SOUNDSCAPE_DATA_DIR) / session_id


def user_audio_dir(session_id: str) -> Path:
    return user_data_dir(session_id) / "audio"


def user_model_dir(session_id: str, model_id: str) -> Path:
    return user_data_dir(session_id) / model_id


def user_sounds_dir(session_id: str) -> Path:
    return Path(GENERATED_SOUNDS_PARENT) / session_id
