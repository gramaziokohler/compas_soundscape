"""Per-request identity carried through ``contextvars``.

``SessionMiddleware`` sets it next to ``request.state`` so code that never sees
the ``Request`` (``job_store.enqueue``, IO job tasks started with
``asyncio.create_task``, which copy the current context) can still attribute a
study server event to a participant. Only set while study job events are on.
"""

from contextvars import ContextVar
from typing import Optional, TypedDict


class RequestIdentity(TypedDict):
    user_hash: Optional[str]
    workspace_id: Optional[str]


_EMPTY: RequestIdentity = {"user_hash": None, "workspace_id": None}

_identity: ContextVar[RequestIdentity] = ContextVar("compas_request_identity", default=_EMPTY)


def set_request_identity(user_hash: Optional[str], workspace_id: Optional[str]) -> None:
    _identity.set({"user_hash": user_hash, "workspace_id": workspace_id})


def get_request_identity() -> RequestIdentity:
    return _identity.get()
