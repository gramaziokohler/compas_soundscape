"""Server-side study events for background jobs (risk gate R6).

``job_store.enqueue`` / ``enqueue_io`` call :func:`log_job_enqueued`, and
``io_jobs.start_io_job`` calls :func:`log_io_job_outcome` once an LLM/TTS job
has finished. Both are total: gated by ``STUDY_FEATURE_SERVER_JOB_EVENTS``,
wrapped in try/except, and the DB write is fire-and-forget — a broken or locked
study DB can never fail or slow down a job. Identity comes from the request
ContextVar (``utils/request_context.py``), falling back to the job's session id
for the workspace.
"""

import inspect
import logging
from typing import Any, Callable, Optional

from config.constants import JOB_STATUS_CANCELLED, JOB_STATUS_ERROR
from services.study_config import study_feature
from services.study_log_store import study_log_store
from utils.request_context import get_request_identity

logger = logging.getLogger(__name__)

FEATURE = "server_job_events"


def _identity(session_id: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    ident = get_request_identity()
    return ident.get("user_hash"), ident.get("workspace_id") or session_id or None


def _request_bodies(coro_factory: Callable) -> dict[str, Any]:
    """Pydantic request models captured by an IO job's ``_run`` closure.

    Every IO-job route defines ``async def _run(job_id)`` inside the endpoint,
    closing over its request model, so the request body can be logged without
    touching each router. Read-only introspection; empty dict when none.
    """
    try:
        nonlocals = inspect.getclosurevars(coro_factory).nonlocals
    except (TypeError, ValueError):
        return {}
    return {
        name: value for name, value in nonlocals.items()
        if callable(getattr(value, "model_dump", None)) and not inspect.isclass(value)
    }


def log_job_enqueued(
    job_id: str, job_type: str, session_id: Optional[str], payload: Optional[dict] = None
) -> None:
    """Record ``job.enqueued`` (payload is sanitized by the store). Never raises."""
    try:
        if not study_feature(FEATURE):
            return
        user_hash, workspace_id = _identity(session_id)
        study_log_store.log_server_event_nowait(
            "job.enqueued",
            {"job_id": job_id, "job_type": job_type, "payload": payload},
            user_hash,
            workspace_id,
        )
    except Exception as exc:  # noqa: BLE001 - logging must never fail an enqueue
        logger.warning("Study job.enqueued not logged for %s: %s", job_id, exc)


async def log_io_job_outcome(
    job_id: str,
    job_type: str,
    session_id: Optional[str],
    coro_factory: Callable,
    error: Optional[str],
) -> None:
    """Record ``job.completed`` / ``job.failed`` / ``job.cancelled`` with request and result. Never raises."""
    try:
        if not study_feature(FEATURE):
            return
        # Imported lazily: job_store imports this module.
        from services.job_store import job_store

        result: Any = None
        status: Optional[str] = None
        try:
            view = await job_store.get(job_id)
            result, status = view.result, view.status
            error = error or view.error or None
        except Exception as exc:  # noqa: BLE001 - result is best effort
            logger.debug("Study: could not read IO job %s result: %s", job_id, exc)
        if status == JOB_STATUS_CANCELLED:
            event_type = "job.cancelled"
        elif error is not None or status == JOB_STATUS_ERROR:
            event_type = "job.failed"
        else:
            event_type = "job.completed"
        user_hash, workspace_id = _identity(session_id)
        study_log_store.log_server_event_nowait(
            event_type,
            {
                "job_id": job_id,
                "job_type": job_type,
                "status": status,
                "request": _request_bodies(coro_factory),
                "result": result,
                "error": error,
            },
            user_hash,
            workspace_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Study job outcome not logged for %s: %s", job_id, exc)
