"""UTF-8 stdio configuration.

On hosts whose default text encoding is a legacy code page (Windows ``cp1252``
/ ``charmap``, some minimal Linux images), writing non-ASCII text to
stdout/stderr raises::

    'charmap' codec can't encode characters in position ...: character maps to <undefined>

The LLM services stream model output (em dashes, curly quotes, accented names)
to stdout via ``print()`` while generating scenarist / foley / speech /
orchestrate results. That ``UnicodeEncodeError`` propagates out of the streaming
call and fails the job — e.g. the speech agent errors, so no TTS cards are
produced — while the same code works on any UTF-8 console.

Call ``configure_utf8_stdio()`` once at process startup, before the first write.
"""
from __future__ import annotations

import sys


def configure_utf8_stdio() -> None:
    """Force stdout/stderr to UTF-8 with a non-fatal error handler.

    ``errors="replace"`` guarantees a stray unencodable code point degrades to a
    replacement character instead of raising and aborting the job. No-op for
    streams that do not support ``reconfigure`` (e.g. some test harnesses).
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass
