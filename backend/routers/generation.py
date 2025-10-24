from fastapi import APIRouter, HTTPException
from services.llm_service import LLMService
from models.schemas import PromptRequest, UnifiedPromptGenerationRequest
from pydantic import BaseModel
from config.constants import (
    DEFAULT_SPL_DB,
    LLM_SUGGESTED_INTERVAL_SECONDS,
    DEFAULT_DURATION_SECONDS
)

router = APIRouter()

# This will be injected by main.py
llm_service = None


def init_generation_router(service: LLMService):
    """Initialize router with LLM service"""
    global llm_service
    llm_service = service


class EntitySelectionRequest(BaseModel):
    entities: list[dict]
    max_sounds: int


@router.post("/api/select-entities")
async def select_entities(request: EntitySelectionRequest):
    """
    Separate endpoint to select diverse entities from a 3D model.
    This allows the frontend to show progress and highlight selected entities
    before generating sound prompts.
    """
    try:
        if not request.entities or len(request.entities) == 0:
            raise HTTPException(status_code=400, detail="No entities provided")

        # Select most diverse entities
        selected_entities = llm_service.select_diverse_entities(
            request.entities,
            request.max_sounds
        )

        return {
            "selected_entities": selected_entities,
            "count": len(selected_entities)
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error selecting entities: {str(e)}")


@router.post("/api/generate-prompts")
async def generate_prompts(request: UnifiedPromptGenerationRequest):
    """
    Unified endpoint for generating sound prompts.
    - If entities are provided: generates contextual prompts based on model objects (batch processing)
      Note: Entities should already be pre-selected using /api/select-entities
    - If only context is provided: generates prompts from text description
    - If both: combines context as introduction with object-based prompts
    """
    try:
        # Case 1: Model entities provided (with or without context)
        if request.entities and len(request.entities) > 0:
            # Entities should already be pre-selected, but select diverse if needed
            entities_to_use = request.entities
            if len(request.entities) > request.num_sounds:
                entities_to_use = llm_service.select_diverse_entities(
                    request.entities,
                    request.num_sounds
                )

            # Generate contextual prompts for all entities in a single LLM call (batch processing)
            sound_list = llm_service.generate_prompts_for_entities(
                entities_to_use,
                request.context
            )

            # Combine results with entity info
            entity_prompts = []
            for i, sound_data in enumerate(sound_list):
                # Match each sound with its corresponding entity
                if i < len(entities_to_use):
                    entity_prompts.append({
                        "entity": entities_to_use[i],
                        "prompt": sound_data["prompt"],
                        "display_name": sound_data["display_name"],
                        "spl_db": sound_data.get("spl_db", DEFAULT_SPL_DB),
                        "interval_seconds": sound_data.get("interval_seconds", LLM_SUGGESTED_INTERVAL_SECONDS),
                        "duration_seconds": sound_data.get("duration_seconds", DEFAULT_DURATION_SECONDS)
                    })

            return {
                "prompts": entity_prompts,
                "selected_entities": entities_to_use  # Return entities used
            }

        # Case 2: Only context provided (traditional text generation)
        elif request.context and request.context.strip():
            raw_text, sound_list = llm_service.generate_text_based_prompts(
                request.context,
                request.num_sounds
            )

            # sound_list now contains dicts with {"prompt": str, "display_name": str, "spl_db": float, "interval_seconds": float}
            return {"prompts": sound_list, "text": raw_text}

        else:
            raise HTTPException(status_code=400, detail="Either context or entities must be provided")

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error generating prompts: {str(e)}")


@router.post("/api/generate-text")
async def generate_text(request: PromptRequest):
    """
    Legacy endpoint - redirects to unified generate-prompts endpoint
    """
    unified_request = UnifiedPromptGenerationRequest(
        context=request.prompt,
        num_sounds=request.num_sounds,
        entities=request.entities
    )
    result = await generate_prompts(unified_request)

    # Convert back to legacy format while preserving prompts for entity info
    sound_list = [p["prompt"] for p in result["prompts"]]
    response = {
        "text": result.get("text", "\n".join(sound_list)),
        "sounds": sound_list,
        "prompts": result["prompts"]  # Include prompts with entity info for frontend
    }
    return response
