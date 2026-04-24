# backend/routers/tokens.py
# Runtime API token management

import os
import logging
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/tokens", tags=["tokens"])
logger = logging.getLogger(__name__)


class TokenUpdateRequest(BaseModel):
    speckle_token: Optional[str] = None
    speckle_project_name: Optional[str] = None
    google_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None


class TokenStatusResponse(BaseModel):
    speckle_token_set: bool
    speckle_project_name: str
    google_api_key_set: bool
    openai_api_key_set: bool
    anthropic_api_key_set: bool


@router.get("", response_model=TokenStatusResponse)
async def get_token_status():
    """Return which tokens are currently configured (values are never exposed)."""
    from config.constants import SPECKLE_PROJECT_NAME
    return {
        "speckle_token_set": bool(os.environ.get("SPECKLE_TOKEN")),
        "speckle_project_name": os.environ.get("SPECKLE_PROJECT_NAME", SPECKLE_PROJECT_NAME),
        "google_api_key_set": bool(os.environ.get("GOOGLE_API_KEY")),
        "openai_api_key_set": bool(os.environ.get("OPENAI_API_KEY")),
        "anthropic_api_key_set": bool(os.environ.get("ANTHROPIC_API_KEY")),
    }


@router.post("", response_model=TokenStatusResponse)
async def update_tokens(request: TokenUpdateRequest):
    """Update API tokens at runtime (overwrites environment variables in-process)."""
    if request.speckle_token is not None:
        if request.speckle_token:
            os.environ["SPECKLE_TOKEN"] = request.speckle_token
        else:
            os.environ.pop("SPECKLE_TOKEN", None)
        _reset_speckle_client()

    if request.speckle_project_name is not None:
        if request.speckle_project_name:
            os.environ["SPECKLE_PROJECT_NAME"] = request.speckle_project_name
        else:
            os.environ.pop("SPECKLE_PROJECT_NAME", None)
        _reset_speckle_project()

    if request.google_api_key is not None:
        if request.google_api_key:
            os.environ["GOOGLE_API_KEY"] = request.google_api_key
        else:
            os.environ.pop("GOOGLE_API_KEY", None)
        _reset_google_client()

    if request.openai_api_key is not None:
        if request.openai_api_key:
            os.environ["OPENAI_API_KEY"] = request.openai_api_key
        else:
            os.environ.pop("OPENAI_API_KEY", None)
        _reset_openai_client()

    if request.anthropic_api_key is not None:
        if request.anthropic_api_key:
            os.environ["ANTHROPIC_API_KEY"] = request.anthropic_api_key
        else:
            os.environ.pop("ANTHROPIC_API_KEY", None)
        _reset_anthropic_client()

    logger.info("Runtime tokens updated")
    return await get_token_status()


def _reset_speckle_client():
    try:
        from routers.speckle import speckle_service
        speckle_service.client = None
        speckle_service.project_id = None
        speckle_service.workspace_id = None
        speckle_service.auth_token = None
        logger.info("Speckle client reset — will re-authenticate on next request")
    except Exception as e:
        logger.warning(f"Could not reset Speckle client: {e}")


def _reset_speckle_project():
    try:
        from routers.speckle import speckle_service
        speckle_service.project_id = None
        logger.info("Speckle project ID cleared — will resolve on next request")
    except Exception as e:
        logger.warning(f"Could not reset Speckle project: {e}")


def _reset_google_client():
    try:
        from services.llm_service import GOOGLE_GENAI_AVAILABLE
        from routers.generation import llm_service
        if llm_service and GOOGLE_GENAI_AVAILABLE:
            import google.genai as genai
            llm_service.gemini_client = genai.Client()
            logger.info("Google AI client reset")
        elif not GOOGLE_GENAI_AVAILABLE:
            logger.warning("Cannot reset Google AI client: google-genai package not installed")
    except Exception as e:
        logger.warning(f"Could not reset Google AI client: {e}")


def _reset_openai_client():
    try:
        from routers.generation import llm_service
        if llm_service:
            llm_service.openai_client = None
            logger.info("OpenAI client cleared — will re-init lazily")
    except Exception as e:
        logger.warning(f"Could not reset OpenAI client: {e}")


def _reset_anthropic_client():
    try:
        from routers.generation import llm_service
        if llm_service:
            llm_service.anthropic_client = None
            logger.info("Anthropic client cleared — will re-init lazily")
    except Exception as e:
        logger.warning(f"Could not reset Anthropic client: {e}")
