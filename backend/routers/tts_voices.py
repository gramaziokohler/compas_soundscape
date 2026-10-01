"""
TTS language / dialect endpoints (Gemini 3.8).

GET    /api/tts/dialects              Voice-library accents + the caller's custom voices
POST   /api/tts/resolve-language      Free text ("Swiss German") → LanguageMatch
GET    /api/tts/custom-voices         The caller's custom dialect voices
POST   /api/tts/custom-voices         Create a female + male prompted voice for a
                                      dialect — IO job, returns {job_id, position, total}
DELETE /api/tts/custom-voices/{id}    Delete one custom voice (locally and at Google)

Custom voices are keyed by ``request.state.user_hash`` (they follow the user,
like preferences), stored in SQLite (services/metadata_store.py).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from config.constants import (
    JOB_TYPE_TTS_VOICE,
    TTS_CUSTOM_VOICE_DESCRIPTION_MAX,
    TTS_CUSTOM_VOICE_GENDERS,
    TTS_LANGUAGE_MATCH_TAG,
    TTS_LANGUAGE_MATCH_UNKNOWN,
)
from models.schemas import (
    JobEnqueueResponse,
    TTSCustomVoice,
    TTSCustomVoiceCreateRequest,
    TTSDialectsResponse,
    TTSLanguageMatch,
    TTSLanguageResolveRequest,
)
from services.io_jobs import run_blocking, start_io_job
from services.job_store import job_store
from services.metadata_store import metadata_store
from services.tts_voice_catalog import voice_catalog
from services.tts_voice_service import (
    create_prompted_voice,
    default_voice_description,
    delete_remote_voice,
)
from utils.language_resolver import babel_tag_for, infer_base_language, resolve_language

router = APIRouter(prefix="/api/tts", tags=["tts-voices"])


def _require_user(request: Request) -> str:
    user_hash = getattr(request.state, "user_hash", None)
    if not user_hash:
        raise HTTPException(status_code=400, detail="No identity for this session")
    return user_hash


@router.get("/dialects", response_model=TTSDialectsResponse)
async def list_dialects(request: Request) -> TTSDialectsResponse:
    user_hash = getattr(request.state, "user_hash", None)
    dialects = await run_blocking(voice_catalog.dialects)
    customs = metadata_store.list_custom_voices(user_hash) if user_hash else []
    return TTSDialectsResponse(dialects=dialects, custom_voices=customs)


@router.post("/resolve-language", response_model=TTSLanguageMatch)
async def resolve_tts_language(payload: TTSLanguageResolveRequest, request: Request) -> TTSLanguageMatch:
    user_hash = getattr(request.state, "user_hash", None)
    dialects = await run_blocking(voice_catalog.dialects)
    customs = metadata_store.list_custom_voices(user_hash) if user_hash else []
    match = resolve_language(payload.text, dialects, customs)
    result = TTSLanguageMatch(**match.to_dict(), uses_classic_voices=match.uses_classic_voices)
    if match.kind in (TTS_LANGUAGE_MATCH_TAG, TTS_LANGUAGE_MATCH_UNKNOWN) and match.query:
        result.suggested_language_code = match.language_code or infer_base_language(match.query)
        result.default_description = default_voice_description(match.query)
    return result


@router.get("/custom-voices", response_model=list[TTSCustomVoice])
async def list_custom_voices(request: Request) -> list[dict]:
    return metadata_store.list_custom_voices(_require_user(request))


@router.post("/custom-voices", response_model=JobEnqueueResponse)
async def create_custom_voices(payload: TTSCustomVoiceCreateRequest, request: Request) -> JobEnqueueResponse:
    user_hash = _require_user(request)
    dialect = payload.dialect_name.strip()
    if not dialect:
        raise HTTPException(status_code=400, detail="Dialect name is required")

    if payload.language_code:
        language_code = babel_tag_for(payload.language_code)
        if not language_code:
            raise HTTPException(status_code=400, detail=f"Invalid language code: {payload.language_code}")
    else:
        language_code = infer_base_language(dialect)
    if not language_code:
        raise HTTPException(
            status_code=400,
            detail=f"Could not infer the base language of '{dialect}'. "
                   "Name the language too, e.g. 'Moroccan Arabic' or 'Arabic (Morocco)'.",
        )
    description = (payload.description or default_voice_description(dialect)).strip()
    description = description[:TTS_CUSTOM_VOICE_DESCRIPTION_MAX]
    session_id = getattr(request.state, "session_id", None)

    async def _run(job_id: str) -> None:
        created: list[dict] = []
        n = len(TTS_CUSTOM_VOICE_GENDERS)
        for i, gender in enumerate(TTS_CUSTOM_VOICE_GENDERS):
            await job_store.set_progress(
                job_id, int(i / n * 100), f"Creating {gender} {dialect} voice ({i + 1}/{n})…",
                partial=created,
            )
            remote = await run_blocking(create_prompted_voice, dialect, language_code, gender, description)
            row = metadata_store.add_custom_voice(
                user_hash, dialect, language_code, gender,
                remote["gemini_voice_id"], description, remote["expire_time"],
            )
            for old_id in row.pop("replaced", []):
                await run_blocking(delete_remote_voice, old_id)
            created.append(row)
        await job_store.complete(job_id, created)

    job_id = await start_io_job(JOB_TYPE_TTS_VOICE, session_id, _run)
    return JobEnqueueResponse(job_id=job_id, position=1, total=1)


@router.delete("/custom-voices/{voice_id}")
async def delete_custom_voice(voice_id: str, request: Request) -> dict:
    row = metadata_store.delete_custom_voice(_require_user(request), voice_id)
    if not row:
        raise HTTPException(status_code=404, detail="Custom voice not found")
    await run_blocking(delete_remote_voice, row["gemini_voice_id"])
    return {"deleted": voice_id}
