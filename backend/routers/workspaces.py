"""Workspace collaboration endpoints: create / switch / invite / join / members.

Identity comes from the middleware (Cloudflare Access email or anonymous
session). All routes operate on the caller's session, which is bound to one
"active" workspace; `switch`/`join` rebind it.

Roles: owner > editor > viewer. Joining can only *upgrade* a membership — an
owner opening an invite link to their own workspace always stays owner.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.metadata_store import (
    metadata_store,
    ROLE_OWNER,
    ROLE_EDITOR,
    ROLE_VIEWER,
)
from services.presence import active_count, heartbeat
from services.job_store import job_store
from config.constants import (
    INVITE_DEFAULT_TTL_S,
    INVITE_MAX_USES_DEFAULT,
    INVITE_MAX_USES_HARD_CAP,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


class WorkspaceCreate(BaseModel):
    name: Optional[str] = None


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = None
    sharing_mode: Optional[str] = None


class InviteCreate(BaseModel):
    role: str = ROLE_EDITOR
    # None = use default (7 days / unlimited); 0 = never expires / unlimited.
    expires_in_s: Optional[int] = None
    max_uses: Optional[int] = None


class JoinRequest(BaseModel):
    token: str


class MemberRoleUpdate(BaseModel):
    role: str


class TransferRequest(BaseModel):
    user_hash: str


def _identity(request: Request) -> tuple[str, str]:
    user_hash = getattr(request.state, "user_hash", None)
    token = getattr(request.state, "session_token", None)
    if not user_hash or not token:
        raise HTTPException(status_code=400, detail="No identity for this session")
    return user_hash, token


def _workspace_or_404(workspace_id: str) -> dict:
    ws = metadata_store.get_workspace(workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws


def _require_role(workspace_id: str, user_hash: str, allowed: tuple[str, ...]) -> str:
    role = metadata_store.get_member_role(workspace_id, user_hash)
    if role not in allowed:
        raise HTTPException(status_code=403, detail="Insufficient permission for this workspace")
    return role


def _workspace_view(workspace_id: str, user_hash: str) -> dict:
    ws = _workspace_or_404(workspace_id)
    members = metadata_store.list_members(workspace_id)
    return {
        **ws,
        "role": metadata_store.get_member_role(workspace_id, user_hash),
        "members": members,
    }


def _rebind_user_sessions_to_default(user_hash: str) -> None:
    """After losing access to a workspace, move the user's sessions back to a
    workspace they own so they are not left pointing at a workspace they cannot
    access."""
    user = metadata_store.get_user(user_hash) or {}
    name = f"{user.get('display_name') or 'My'}'s workspace"
    default_ws = metadata_store.get_or_create_default_workspace(user_hash, name)
    for sess in metadata_store.sessions_for_user(user_hash):
        metadata_store.set_workspace_for_token_hash(sess["token_hash"], default_ws["id"])


@router.get("")
async def list_workspaces(request: Request) -> dict:
    user_hash, token = _identity(request)
    return {
        "workspaces": metadata_store.list_workspaces_for_user(user_hash),
        "active_workspace_id": getattr(request.state, "workspace_id", None),
    }


@router.post("")
async def create_workspace(payload: WorkspaceCreate, request: Request) -> dict:
    user_hash, token = _identity(request)
    user = metadata_store.get_user(user_hash) or {}
    name = (payload.name or "").strip() or f"{user.get('display_name') or 'New'}'s workspace"
    ws = metadata_store.create_workspace(user_hash, name)
    metadata_store.set_session_workspace(token, ws["id"])
    return _workspace_view(ws["id"], user_hash)


@router.post("/join")
async def join_workspace(payload: JoinRequest, request: Request) -> dict:
    user_hash, token = _identity(request)
    invite = metadata_store.resolve_invite(payload.token)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found, expired, or revoked")
    workspace_id = invite["workspace_id"]
    _workspace_or_404(workspace_id)
    role = invite["role"] if invite["role"] in (ROLE_EDITOR, ROLE_VIEWER) else ROLE_EDITOR

    # Never downgrade: an owner (or existing editor) opening their own or a
    # lower-privilege invite link keeps their current role.
    existing = metadata_store.get_member_role(workspace_id, user_hash)
    metadata_store.ensure_member(workspace_id, user_hash, role)
    metadata_store.set_session_workspace(token, workspace_id)
    # Consume one redemption only when this actually added a new member. A
    # membership change is not a content edit, so the content revision is NOT
    # bumped (bumping would fire false 409s / pause autosave for active editors).
    if existing is None:
        metadata_store.record_invite_use(payload.token)
    return _workspace_view(workspace_id, user_hash)


@router.get("/{workspace_id}")
async def get_workspace(workspace_id: str, request: Request) -> dict:
    user_hash, token = _identity(request)
    ws = _workspace_or_404(workspace_id)
    role = metadata_store.get_member_role(workspace_id, user_hash)
    if role is None and ws.get("sharing_mode") != "link":
        raise HTTPException(status_code=403, detail="You are not a member of this workspace")
    view = _workspace_view(workspace_id, user_hash)
    if role is None:
        # Link-shared non-members may load the workspace shell, but must not be
        # able to enumerate members' emails/names.
        view.pop("members", None)
    present = await active_count(job_store.redis, workspace_id, user_hash)
    return {**view, "presence": present}


@router.post("/{workspace_id}/switch")
async def switch_workspace(workspace_id: str, request: Request) -> dict:
    user_hash, token = _identity(request)
    if metadata_store.get_member_role(workspace_id, user_hash) is None:
        raise HTTPException(status_code=403, detail="You are not a member of this workspace")
    metadata_store.set_session_workspace(token, workspace_id)
    request.state.workspace_id = workspace_id
    request.state.session_id = workspace_id
    return _workspace_view(workspace_id, user_hash)


@router.patch("/{workspace_id}")
async def update_workspace(workspace_id: str, payload: WorkspaceUpdate, request: Request) -> dict:
    user_hash, _token = _identity(request)
    _workspace_or_404(workspace_id)
    _require_role(workspace_id, user_hash, (ROLE_OWNER,))
    if payload.sharing_mode is not None:
        metadata_store.set_sharing_mode(workspace_id, payload.sharing_mode)
    if payload.name is not None and payload.name.strip():
        metadata_store.rename_workspace(workspace_id, payload.name.strip()[:80])
    return _workspace_view(workspace_id, user_hash)


# ── invites ──────────────────────────────────────────────────────────────────


@router.post("/{workspace_id}/invites")
async def create_invite(workspace_id: str, payload: InviteCreate, request: Request) -> dict:
    user_hash, _token = _identity(request)
    _workspace_or_404(workspace_id)
    _require_role(workspace_id, user_hash, (ROLE_OWNER, ROLE_EDITOR))
    role = payload.role if payload.role in (ROLE_EDITOR, ROLE_VIEWER) else ROLE_EDITOR

    ttl = INVITE_DEFAULT_TTL_S if payload.expires_in_s is None else int(payload.expires_in_s)
    expires_at = (
        None
        if ttl <= 0
        else (datetime.now(timezone.utc) + timedelta(seconds=ttl)).isoformat()
    )
    max_uses = INVITE_MAX_USES_DEFAULT if payload.max_uses is None else int(payload.max_uses)
    max_uses = max(0, min(max_uses, INVITE_MAX_USES_HARD_CAP))

    token = metadata_store.create_invite(
        workspace_id, role, user_hash, expires_at=expires_at, max_uses=max_uses
    )
    return {
        "token": token,
        "role": role,
        "workspace_id": workspace_id,
        "url": f"/?invite={token}",
        "expires_at": expires_at,
        "max_uses": max_uses,
    }


@router.get("/{workspace_id}/invites")
async def list_invites(workspace_id: str, request: Request) -> dict:
    user_hash, _token = _identity(request)
    _workspace_or_404(workspace_id)
    _require_role(workspace_id, user_hash, (ROLE_OWNER, ROLE_EDITOR))
    return {"invites": metadata_store.list_invites(workspace_id)}


@router.delete("/{workspace_id}/invites/{invite_id}")
async def revoke_invite(workspace_id: str, invite_id: str, request: Request) -> dict:
    user_hash, _token = _identity(request)
    _workspace_or_404(workspace_id)
    _require_role(workspace_id, user_hash, (ROLE_OWNER, ROLE_EDITOR))
    revoked = metadata_store.revoke_invite_by_id(workspace_id, invite_id)
    if not revoked:
        raise HTTPException(status_code=404, detail="Invite not found")
    return {"success": True, "revoked": True}


# ── members ──────────────────────────────────────────────────────────────────


@router.post("/{workspace_id}/leave")
async def leave_workspace(workspace_id: str, request: Request) -> dict:
    user_hash, _token = _identity(request)
    _workspace_or_404(workspace_id)
    role = metadata_store.get_member_role(workspace_id, user_hash)
    if role is None:
        raise HTTPException(status_code=403, detail="You are not a member of this workspace")
    if role == ROLE_OWNER:
        raise HTTPException(
            status_code=409,
            detail="Owners cannot leave. Transfer ownership or delete the workspace instead.",
        )
    metadata_store.remove_member(workspace_id, user_hash)
    _rebind_user_sessions_to_default(user_hash)
    return {"success": True, "left": True}


@router.patch("/{workspace_id}/members/{user_hash}")
async def update_member_role(
    workspace_id: str, user_hash: str, payload: MemberRoleUpdate, request: Request
) -> dict:
    actor, _token = _identity(request)
    _workspace_or_404(workspace_id)
    _require_role(workspace_id, actor, (ROLE_OWNER,))
    if payload.role not in (ROLE_EDITOR, ROLE_VIEWER):
        raise HTTPException(status_code=400, detail="Role must be 'editor' or 'viewer'")
    if metadata_store.get_member_role(workspace_id, user_hash) is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if not metadata_store.set_member_role(workspace_id, user_hash, payload.role):
        raise HTTPException(status_code=409, detail="Cannot change the owner's role")
    return _workspace_view(workspace_id, actor)


@router.delete("/{workspace_id}/members/{user_hash}")
async def remove_member(workspace_id: str, user_hash: str, request: Request) -> dict:
    actor, _token = _identity(request)
    _workspace_or_404(workspace_id)
    _require_role(workspace_id, actor, (ROLE_OWNER,))
    target_role = metadata_store.get_member_role(workspace_id, user_hash)
    if target_role is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if target_role == ROLE_OWNER:
        raise HTTPException(status_code=409, detail="Cannot remove the workspace owner")
    metadata_store.remove_member(workspace_id, user_hash)
    _rebind_user_sessions_to_default(user_hash)
    return _workspace_view(workspace_id, actor)


@router.post("/{workspace_id}/transfer")
async def transfer_ownership(workspace_id: str, payload: TransferRequest, request: Request) -> dict:
    actor, _token = _identity(request)
    _workspace_or_404(workspace_id)
    _require_role(workspace_id, actor, (ROLE_OWNER,))
    if payload.user_hash == actor:
        raise HTTPException(status_code=400, detail="You already own this workspace")
    if metadata_store.get_member_role(workspace_id, payload.user_hash) is None:
        raise HTTPException(status_code=404, detail="Target is not a member of this workspace")
    if not metadata_store.transfer_ownership(workspace_id, actor, payload.user_hash):
        raise HTTPException(status_code=409, detail="Ownership transfer failed")
    return _workspace_view(workspace_id, actor)


# ── presence ─────────────────────────────────────────────────────────────────


@router.post("/{workspace_id}/presence")
async def presence_heartbeat(workspace_id: str, request: Request) -> dict:
    user_hash, _token = _identity(request)
    _workspace_or_404(workspace_id)
    if metadata_store.get_member_role(workspace_id, user_hash) is None:
        raise HTTPException(status_code=403, detail="You are not a member of this workspace")
    count = await heartbeat(job_store.redis, workspace_id, user_hash)
    ws = metadata_store.get_workspace(workspace_id) or {}
    return {"presence": count, "revision": ws.get("revision", 0)}
