# backend/utils/__init__.py
# Utilities package.
#
# KEEP THIS MODULE IMPORT-LIGHT. Python executes a package's ``__init__`` before
# any of its submodules, so an eager import here runs before ``load_dotenv()`` in
# the entry points and drags in ``audio_processing`` (torch/librosa) and,
# transitively, ``config.constants``. That used to freeze env-derived constants
# (CF_ACCESS_*, REDIS_URL, ...) to their defaults, because ``config.constants``
# was imported *before* the .env files were loaded — e.g. importing
# ``utils.console`` pulled in ``config.constants`` and broke Cloudflare Access.
#
# Re-exports are lazy (PEP 562) so ``from utils import calculate_rms`` still
# works without importing ``audio_processing`` at package-import time.

_LAZY_AUDIO = frozenset(
    {
        "calculate_rms",
        "normalize_audio_rms",
        "apply_dbfs_calibration",
        "apply_denoising",
    }
)


def __getattr__(name: str):
    if name in _LAZY_AUDIO:
        from . import audio_processing

        return getattr(audio_processing, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = sorted(_LAZY_AUDIO)
