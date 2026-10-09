"""In-app bug reports — durable storage of user-submitted reports.

Metadata goes to the SQLite ``bug_reports`` table (``services/metadata_store.py``);
the optional screenshot is written under ``data/bug_reports/<id>/`` so both
survive restarts, deploys, and the temp janitor.
"""

import base64
import binascii
import json
import logging
import subprocess
import uuid
from functools import lru_cache
from typing import Any, Optional

from config.constants import (
    BACKEND_DIR,
    BUG_REPORT_MAX_CONTEXT_BYTES,
    BUG_REPORT_MAX_SCREENSHOT_BYTES,
    BUG_REPORT_SCREENSHOT_BASENAME,
    BUG_REPORTS_DIR,
)
from models.schemas import BugReportCreate
from services.metadata_store import metadata_store

logger = logging.getLogger(__name__)

# Magic-byte prefix → file extension of the accepted screenshot formats.
_IMAGE_SIGNATURES: dict[bytes, str] = {
    b"\x89PNG\r\n\x1a\n": "png",
    b"\xff\xd8\xff": "jpg",
}

# Context keys lifted into their own columns (easier to filter / read in SQL).
_CONTEXT_COLUMNS = ("page_url", "model_id", "user_agent", "app_version")


@lru_cache(maxsize=1)
def _backend_version() -> Optional[str]:
    """Short git commit of the running backend checkout (None when unavailable)."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=BACKEND_DIR.parent,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if out.returncode != 0:
            return None
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def _decode_screenshot(data_url: str) -> tuple[bytes, str]:
    """Decode a ``data:image/...;base64,`` URL; return ``(bytes, ext)``.

    Raises ``ValueError`` for malformed data, unsupported formats, or oversize images.
    """
    _, _, encoded = data_url.partition(",")
    if not encoded:
        raise ValueError("Screenshot must be a base64 data URL")
    # Base64 inflates by 4/3 — reject obviously oversize payloads before decoding.
    if len(encoded) * 3 // 4 > BUG_REPORT_MAX_SCREENSHOT_BYTES:
        raise ValueError("Screenshot is too large")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Screenshot is not valid base64") from exc
    for signature, ext in _IMAGE_SIGNATURES.items():
        if raw.startswith(signature):
            return raw, ext
    raise ValueError("Screenshot must be a PNG or JPEG image")


class BugReportService:
    """Validates and persists bug reports (SQLite row + optional screenshot file)."""

    def save(
        self,
        payload: BugReportCreate,
        *,
        user_hash: Optional[str],
        user_email: Optional[str],
        workspace_id: Optional[str],
    ) -> dict:
        """Store one report and return its row. Raises ``ValueError`` on bad input."""
        context: dict[str, Any] = dict(payload.context)
        if len(json.dumps(context)) > BUG_REPORT_MAX_CONTEXT_BYTES:
            raise ValueError("Diagnostics context is too large")
        context["backend_version"] = _backend_version()

        screenshot = _decode_screenshot(payload.screenshot) if payload.screenshot else None

        report_id = uuid.uuid4().hex
        screenshot_path: Optional[str] = None
        if screenshot:
            raw, ext = screenshot
            report_dir = BUG_REPORTS_DIR / report_id
            report_dir.mkdir(parents=True, exist_ok=True)
            target = report_dir / f"{BUG_REPORT_SCREENSHOT_BASENAME}.{ext}"
            target.write_bytes(raw)
            # Relative to BUG_REPORTS_DIR so the row stays valid if data/ moves.
            screenshot_path = f"{report_id}/{target.name}"

        columns = {
            key: str(context[key])[:2000] if context.get(key) is not None else None
            for key in _CONTEXT_COLUMNS
        }
        row = metadata_store.add_bug_report(
            report_id,
            payload.category,
            payload.description.strip(),
            context,
            user_hash=user_hash,
            user_email=user_email,
            workspace_id=workspace_id,
            screenshot_path=screenshot_path,
            **columns,
        )
        logger.info(
            "Bug report %s saved (category=%s, user=%s, screenshot=%s)",
            report_id, payload.category, user_email or user_hash or "anonymous", bool(screenshot_path),
        )
        return row


bug_report_service = BugReportService()
