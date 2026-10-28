"""Public read-only share links (`/share/<share_id>`).

Two routers:
  * ``router`` — **unauthenticated** (``/api/public/share``). The session
    middleware skips identity and cookies for ``PUBLIC_API_PREFIX`` and
    Cloudflare Access bypasses it, so embeds work without a login.
  * ``owner_router`` — create / regenerate / revoke a model's share link. Owner
    only, behind the normal identity.
"""

import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from config.constants import PUBLIC_SHARE_PREFIX
from models.schemas import PublicShareResponse, ShareLinkResponse, SoundscapeData
from services.metadata_store import ROLE_OWNER, metadata_store
from services.share_service import ShareNotFound, ShareTokenMissing, share_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix=PUBLIC_SHARE_PREFIX, tags=["share"])
owner_router = APIRouter(prefix="/api/speckle/soundscape", tags=["share"])


def _public_share(share_id: str):
    try:
        return share_service.get_public_share(share_id)
    except ShareNotFound:
        raise HTTPException(status_code=404, detail="This share link does not exist or was revoked.")
    except ShareTokenMissing:
        raise HTTPException(status_code=503, detail="Sharing is not configured on this server.")


@router.get("/{share_id}", response_model=PublicShareResponse)
async def get_public_share(share_id: str):
    share = _public_share(share_id)
    audio_base_url, ir_base_url = share_service.media_base_urls(share_id)
    return PublicShareResponse(
        soundscape_data=SoundscapeData(**share.payload),
        audio_base_url=audio_base_url,
        ir_base_url=ir_base_url,
        share_config=share.payload.get("share_config") or {},
    )


async def _serve_media(share_id: str, kind: str, filename: str) -> FileResponse:
    _public_share(share_id)
    path = share_service.media_path(share_id, kind, filename)
    if not path:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(path))


@router.get("/{share_id}/audio/{filename}")
async def get_share_audio(share_id: str, filename: str):
    return await _serve_media(share_id, "audio", filename)


@router.get("/{share_id}/ir/{filename}")
async def get_share_ir(share_id: str, filename: str):
    return await _serve_media(share_id, "ir", filename)


# ── Owner management ─────────────────────────────────────────────────────
def _owner_workspace(request: Request) -> tuple[str, str]:
    """``(workspace_id, created_by)`` for an owner; 403 otherwise.

    Anonymous/legacy sessions have no user_hash and are the implicit owner of
    their cookie workspace (same rule as ``soundscape._require_role``).
    """
    state = getattr(request, "state", None)
    workspace_id = getattr(state, "session_id", None)
    if not workspace_id:
        raise HTTPException(status_code=400, detail="No session cookie")
    user_hash = getattr(state, "user_hash", None)
    if user_hash and metadata_store.get_member_role(workspace_id, user_hash) != ROLE_OWNER:
        raise HTTPException(status_code=403, detail="Only the workspace owner can share this model.")
    return workspace_id, user_hash or workspace_id


def _link_response(share: dict | None) -> ShareLinkResponse:
    if not share:
        return ShareLinkResponse()
    return ShareLinkResponse(share_id=share["share_id"], created_at=share["created_at"])


@owner_router.get("/{model_id}/share", response_model=ShareLinkResponse)
async def get_share_link(model_id: str, request: Request):
    workspace_id, _ = _owner_workspace(request)
    return _link_response(metadata_store.get_share(workspace_id, model_id))


@owner_router.post("/{model_id}/share", response_model=ShareLinkResponse)
async def create_share_link(model_id: str, request: Request):
    workspace_id, created_by = _owner_workspace(request)
    return _link_response(metadata_store.get_or_create_share(workspace_id, model_id, created_by))


@owner_router.post("/{model_id}/share/regenerate", response_model=ShareLinkResponse)
async def regenerate_share_link(model_id: str, request: Request):
    workspace_id, created_by = _owner_workspace(request)
    return _link_response(metadata_store.regenerate_share(workspace_id, model_id, created_by))


@owner_router.delete("/{model_id}/share", response_model=ShareLinkResponse)
async def revoke_share_link(model_id: str, request: Request):
    workspace_id, _ = _owner_workspace(request)
    metadata_store.revoke_share(workspace_id, model_id)
    return ShareLinkResponse()
