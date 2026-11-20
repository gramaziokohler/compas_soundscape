"""Client diagnostics — append browser crash / emergency events to a JSONL log.

Events come from every view, the public share view included (unauthenticated), so
storage is append-only, size-capped and rotated: ``CLIENT_DIAGNOSTICS_LOG`` holds one
JSON object per line and is moved to ``.1`` once it passes
``CLIENT_DIAGNOSTICS_MAX_LOG_BYTES``. Read it with ``scripts/list_client_diagnostics.py``.
"""

import json
import logging
import threading
from datetime import datetime, timezone
from typing import Any, Optional

from config.constants import (
    CLIENT_DIAGNOSTICS_LOG,
    CLIENT_DIAGNOSTICS_MAX_DETAILS_BYTES,
    CLIENT_DIAGNOSTICS_MAX_LOG_BYTES,
    CLIENT_DIAGNOSTICS_MAX_TEXT_CHARS,
)
from models.schemas import ClientDiagnosticEvent

logger = logging.getLogger(__name__)


class ClientDiagnosticsService:
    """Thread-safe JSONL appender with single-file rotation."""

    def __init__(self) -> None:
        self._lock = threading.Lock()

    def record(
        self,
        event: ClientDiagnosticEvent,
        *,
        user_agent: Optional[str],
        user_hash: Optional[str],
    ) -> None:
        """Append one event. Oversized ``details`` are replaced by a marker, never rejected."""
        details: Any = event.details
        encoded_details = json.dumps(details, default=str)
        if len(encoded_details.encode("utf-8")) > CLIENT_DIAGNOSTICS_MAX_DETAILS_BYTES:
            details = {"truncated": True, "bytes": len(encoded_details)}

        line = json.dumps(
            {
                "received_at": datetime.now(timezone.utc).isoformat(),
                "kind": event.kind,
                "occurred_at": event.occurred_at,
                "page": event.page,
                "share_id": event.share_id,
                "client_session_id": event.client_session_id,
                "user_hash": user_hash,
                "user_agent": (user_agent or "")[:CLIENT_DIAGNOSTICS_MAX_TEXT_CHARS],
                "details": details,
            },
            default=str,
        )

        with self._lock:
            CLIENT_DIAGNOSTICS_LOG.parent.mkdir(parents=True, exist_ok=True)
            if CLIENT_DIAGNOSTICS_LOG.exists() and CLIENT_DIAGNOSTICS_LOG.stat().st_size > CLIENT_DIAGNOSTICS_MAX_LOG_BYTES:
                CLIENT_DIAGNOSTICS_LOG.replace(CLIENT_DIAGNOSTICS_LOG.with_suffix(".jsonl.1"))
            with CLIENT_DIAGNOSTICS_LOG.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        logger.warning("Client diagnostic: %s on %s", event.kind, event.page)


client_diagnostics_service = ClientDiagnosticsService()
