"""Workspace collaboration endpoints: create / switch / invite / join / presence.

Identity comes from the middleware (Cloudflare Access email or anonymous
session). All routes operate on the caller's session, which is bound to one
"active" workspace; `switch`/`join` rebind it.
"""

import logging
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

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


class WorkspaceCreate(BaseModel):
    name: Optional[str] = None


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = None
    sharing_mode: Optional[str] = None


class InviteCreate(BaseModel):
    role: str = ROLE_EDITOR


class JoinRequest(BaseModel):
    token: str


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
    metadata_store.add_member(workspace_id, user_hash, role)
    metadata_store.set_session_workspace(token, workspace_id)
    metadata_store.bump_revision(workspace_id)
    return _workspace_view(workspace_id, user_hash)


@router.get("/{workspace_id}")
async def get_workspace(workspace_id: str, request: Request) -> dict:
    user_hash, token = _identity(request)
    ws = _workspace_or_404(workspace_id)
    role = metadata_store.get_member_role(workspace_id, user_hash)
    if role is None and ws.get("sharing_mode") != "link":
        raise HTTPException(status_code=403, detail="You are not a member of this workspace")
    present = await active_count(job_store.redis, workspace_id)
    return {**_workspace_view(workspace_id, user_hash), "presence": present}


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


@router.post("/{workspace_id}/invites")
async def create_invite(workspace_id: str, payload: InviteCreate, request: Request) -> dict:
    user_hash, _token = _identity(request)
    _workspace_or_404(workspace_id)
    _require_role(workspace_id, user_hash, (ROLE_OWNER, ROLE_EDITOR))
    role = payload.role if payload.role in (ROLE_EDITOR, ROLE_VIEWER) else ROLE_EDITOR
    token = metadata_store.create_invite(workspace_id, role, user_hash)
    return {"token": token, "role": role, "workspace_id": workspace_id, "url": f"/?invite={token}"}


@router.post("/{workspace_id}/presence")
async def presence_heartbeat(workspace_id: str, request: Request) -> dict:
    user_hash, token = _identity(request)
    _workspace_or_404(workspace_id)
    if metadata_store.get_member_role(workspace_id, user_hash) is None:
        raise HTTPException(status_code=403, detail="You are not a member of this workspace")
    count = await heartbeat(job_store.redis, workspace_id, token)
    ws = metadata_store.get_workspace(workspace_id) or {}
    return {"presence": count, "revision": ws.get("revision", 0)}
