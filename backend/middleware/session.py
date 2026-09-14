"""Identity + session middleware.

Resolves a durable identity for every request and binds it to a **workspace**:

  1. If Cloudflare Access is configured, verify the Access JWT and use its
     verified ``email`` as the identity (no custom login).
  2. Else if ``AUTH_DEV_BYPASS`` is set, use ``DEV_USER_EMAIL`` (local dev).
  3. Else fall back to the legacy anonymous ``compas_session`` cookie: the
     cookie value doubles as the workspace id, so existing
     ``data/soundscapes/<uuid>/`` directories are already that user's workspace.

The middleware always sets ``request.state.session_id`` to the **workspace id**
(keeping every existing file-scoping call site correct), plus
``request.state.workspace_id`` / ``user_email`` / ``user_hash``.

Sessions are non-expiring: the cookie is re-issued on each visit and the
server-side row never expires (bounded only by the browser's ~400-day cookie cap
and, at the edge, Cloudflare's session duration).
"""

import logging
import os
import secrets
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from config.constants import (
    AUTH_DEV_BYPASS,
    DEV_USER_EMAIL,
    SESSION_COOKIE,
    SESSION_COOKIE_MAX_AGE,
    SESSION_TOKEN_BYTES,
)
from services.access_service import cf_configured, extract_email
from services.metadata_store import metadata_store

logger = logging.getLogger(__name__)

_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() in ("true", "1", "yes")

# Static/media routes never need identity and are hit many times per page — skip
# all DB work and cookie writes for them.
_SKIP_PREFIXES = ("/static", "/soundscapes")


def _new_token() -> str:
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def _set_cookie(response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        max_age=SESSION_COOKIE_MAX_AGE,
    )


class SessionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        cookie_token = request.cookies.get(SESSION_COOKIE)

        if request.url.path.startswith(_SKIP_PREFIXES):
            # Media/static: no identity, no DB, no cookie mutation.
            request.state.session_id = cookie_token or ""
            request.state.workspace_id = cookie_token or ""
            request.state.user_email = None
            request.state.user_hash = None
            request.state.session_token = cookie_token or ""
            return await call_next(request)

        # ── Identity ─────────────────────────────────────────────────────
        email = None
        if cf_configured():
            email = extract_email(request)
            if not email:
                # Cloudflare Access is enforced but this request carries no valid
                # token. In normal operation Access redirects before reaching the
                # origin; reject defensively if the origin is ever hit directly.
                return JSONResponse(
                    {"detail": "Not authenticated (Cloudflare Access)"},
                    status_code=401,
                )
        elif AUTH_DEV_BYPASS:
            email = DEV_USER_EMAIL

        token = cookie_token
        user_email = email
        user_hash = None
        workspace_id = None

        try:
            if email:
                user = metadata_store.get_or_create_user(email)
                user_hash = user["user_hash"]
                sess = metadata_store.get_session(cookie_token) if cookie_token else None
                if sess and sess["user_hash"] == user_hash:
                    token = cookie_token
                    workspace_id = sess["workspace_id"]
                    metadata_store.touch_session(token)
                else:
                    token = _new_token()
                    ws = metadata_store.get_or_create_default_workspace(
                        user_hash, f"{user.get('display_name') or email}'s workspace"
                    )
                    workspace_id = ws["id"]
                    metadata_store.create_session(token, user_hash, workspace_id)
            else:
                # Anonymous fallback — cookie value == workspace id (legacy dirs).
                token = cookie_token or str(uuid.uuid4())
                anon_email = f"anon+{token}@local"
                user = metadata_store.get_or_create_user(anon_email, "Anonymous")
                user_hash = user["user_hash"]
                user_email = anon_email
                sess = metadata_store.get_session(token)
                if sess:
                    workspace_id = sess["workspace_id"]
                    metadata_store.touch_session(token)
                else:
                    ws = metadata_store.create_workspace(user_hash, "My workspace", workspace_id=token)
                    workspace_id = ws["id"]
                    metadata_store.create_session(token, user_hash, workspace_id)
        except Exception as exc:  # noqa: BLE001 - never let identity break the request
            logger.exception("Identity resolution failed: %s", exc)
            token = cookie_token or str(uuid.uuid4())
            user_email = None
            user_hash = None
            workspace_id = token

        request.state.session_id = workspace_id or token
        request.state.workspace_id = workspace_id or token
        request.state.user_email = user_email
        request.state.user_hash = user_hash
        request.state.session_token = token

        response = await call_next(request)
        if cookie_token != token:
            _set_cookie(response, token)
        return response
