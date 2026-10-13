"""In-app bug reports — the bottom-bar bug button posts here.

Reports are stored durably (SQLite + ``data/bug_reports/``) with the caller's
verified identity, unless the reporter opted to send anonymously. There is intentionally no listing endpoint: reports are
read on the server with ``python scripts/list_bug_reports.py``.
"""

import asyncio

from fastapi import APIRouter, HTTPException, Request

from models.schemas import BugReportCreate, BugReportCreated
from services.bug_report_service import bug_report_service

router = APIRouter(prefix="/api", tags=["bug-reports"])


@router.post("/bug-reports", response_model=BugReportCreated)
async def create_bug_report(payload: BugReportCreate, request: Request) -> BugReportCreated:
    """Persist a bug report and return its reference id."""
    if not payload.description.strip():
        raise HTTPException(status_code=400, detail="Please describe the problem")
    # Anonymous reports drop every identity field before they reach storage.
    identity = {"user_hash": None, "user_email": None, "workspace_id": None}
    if not payload.anonymous:
        identity = {
            "user_hash": getattr(request.state, "user_hash", None),
            "user_email": getattr(request.state, "user_email", None),
            "workspace_id": getattr(request.state, "workspace_id", None) or None,
        }
    try:
        row = await asyncio.to_thread(bug_report_service.save, payload, **identity)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return BugReportCreated(id=row["id"], created_at=row["created_at"])
