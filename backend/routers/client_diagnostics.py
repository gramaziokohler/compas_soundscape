"""Client diagnostics — browser crash / emergency events (``/api/public``, unauthenticated).

Public because the share view (Cloudflare Access bypassed) must be able to report the
crashes its visitors hit. Write-only: there is no listing endpoint; the log is read on
the server with ``python scripts/list_client_diagnostics.py``.
"""

import asyncio

from fastapi import APIRouter, Request, Response

from models.schemas import ClientDiagnosticEvent
from services.client_diagnostics_service import client_diagnostics_service

router = APIRouter(prefix="/api/public", tags=["client-diagnostics"])


@router.post("/client-diagnostics", status_code=204)
async def record_client_diagnostic(event: ClientDiagnosticEvent, request: Request) -> Response:
    """Append one crash / emergency event to the client-diagnostics log."""
    await asyncio.to_thread(
        client_diagnostics_service.record,
        event,
        user_agent=request.headers.get("user-agent"),
        user_hash=getattr(request.state, "user_hash", None),
    )
    return Response(status_code=204)
