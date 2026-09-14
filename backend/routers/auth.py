"""Identity endpoints — current user, profile, and workspace listing."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.metadata_store import metadata_store

router = APIRouter(prefix="/api", tags=["identity"])


class CurrentUser(BaseModel):
    email: Optional[str] = None
    user_id: Optional[str] = None
    display_name: Optional[str] = None
    workspace_id: Optional[str] = None


class DisplayNameUpdate(BaseModel):
    display_name: str


@router.get("/me", response_model=CurrentUser)
async def get_me(request: Request) -> CurrentUser:
    """Return the verified identity for the current session.

    `email` is populated from the Cloudflare Access JWT (or the dev bypass);
    anonymous fallback sessions report a synthetic `anon+…@local` address.
    """
    user_hash = getattr(request.state, "user_hash", None)
    user: Optional[dict] = metadata_store.get_user(user_hash) if user_hash else None
    return CurrentUser(
        email=getattr(request.state, "user_email", None),
        user_id=user_hash,
        display_name=(user or {}).get("display_name"),
        workspace_id=getattr(request.state, "workspace_id", None),
    )


@router.post("/me/display-name", response_model=CurrentUser)
async def set_display_name(payload: DisplayNameUpdate, request: Request) -> CurrentUser:
    user_hash = getattr(request.state, "user_hash", None)
    if not user_hash:
        raise HTTPException(status_code=400, detail="No identity for this session")
    name = payload.display_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="display_name must not be empty")
    metadata_store.set_display_name(user_hash, name[:64])
    return await get_me(request)


@router.get("/workspaces")
async def list_workspaces(request: Request) -> dict:
    user_hash = getattr(request.state, "user_hash", None)
    if not user_hash:
        return {"workspaces": []}
    return {"workspaces": metadata_store.list_workspaces_for_user(user_hash)}
