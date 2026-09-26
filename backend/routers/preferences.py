"""Per-user preferences — durable Advanced Settings for the caller's identity.

Settings are keyed by the verified ``user_hash`` (Cloudflare Access email, dev
bypass, or the anonymous-cookie identity) so they follow the username across
browsers and workspaces. API tokens are intentionally NOT handled here — they
remain deployment-global (see ``routers/tokens.py``).
"""

from fastapi import APIRouter, HTTPException, Request

from models.schemas import UserPreferences
from services.metadata_store import metadata_store

router = APIRouter(prefix="/api", tags=["preferences"])


@router.get("/me/preferences")
async def get_preferences(request: Request) -> dict:
    """Return the caller's stored preferences (empty object when unset)."""
    user_hash = getattr(request.state, "user_hash", None)
    if not user_hash:
        return {}
    return metadata_store.get_preferences(user_hash)


@router.put("/me/preferences")
async def update_preferences(payload: UserPreferences, request: Request) -> dict:
    """Shallow-merge the provided fields into the caller's stored preferences."""
    user_hash = getattr(request.state, "user_hash", None)
    if not user_hash:
        raise HTTPException(status_code=400, detail="No identity for this session")
    patch = payload.model_dump(exclude_unset=True)
    merged = {**metadata_store.get_preferences(user_hash), **patch}
    return metadata_store.set_preferences(user_hash, merged)
