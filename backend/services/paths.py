from pathlib import Path

from config.constants import BACKEND_DIR

SOUNDSCAPE_DATA_DIR = str(BACKEND_DIR / "data" / "soundscapes")
GENERATED_SOUNDS_PARENT = str(BACKEND_DIR / "temp" / "static" / "sounds" / "generated")


def user_data_dir(session_id: str) -> Path:
    return Path(SOUNDSCAPE_DATA_DIR) / session_id


def user_audio_dir(session_id: str, model_id: str) -> Path:
    """Model-scoped persisted audio dir: data/soundscapes/<ws>/<model>/audio.

    Audio is persisted per model (not per workspace) so two models in the same
    workspace can never share/reuse a deterministic filename, and deleting one
    model's history removes exactly its own audio.
    """
    return user_model_dir(session_id, model_id) / "audio"


def user_model_dir(session_id: str, model_id: str) -> Path:
    return user_data_dir(session_id) / model_id


def user_sounds_dir(session_id: str) -> Path:
    return Path(GENERATED_SOUNDS_PARENT) / session_id


def find_session_audio(session_id: str, filename: str) -> Path | None:
    """Find a persisted audio file across every model dir in a workspace.

    Used by flows that only have a ``session_id`` (loop analysis, SED segment
    deletion) and must locate audio that was persisted under a model-scoped
    ``audio/`` dir. Never crosses the workspace boundary.
    """
    root = user_data_dir(session_id)
    if not root.exists():
        return None
    for child in root.iterdir():
        if not child.is_dir():
            continue
        candidate = child / "audio" / filename
        if candidate.is_file():
            return candidate
    return None
