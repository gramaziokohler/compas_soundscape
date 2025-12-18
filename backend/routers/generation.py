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

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()

        # Check if it's an LLM overload error
        error_str = str(e)
        if '503' in error_str or 'overloaded' in error_str.lower() or 'UNAVAILABLE' in error_str:
            raise HTTPException(
                status_code=503,
                detail="LLM service is currently overloaded. Please try again in a moment."
            )

        raise HTTPException(status_code=500, detail=f"Error selecting entities: {error_str}")


@router.post("/api/generate-prompts")
async def generate_prompts(request: UnifiedPromptGenerationRequest):
    """
    Unified endpoint for generating sound prompts.
    - If entities are provided: generates MIXED prompts combining:
      * Entity-linked sounds (based on model objects)
      * Non-entity context sounds (ambient, human activity, etc.)
      Note: Entities should already be pre-selected using /api/select-entities
      The LLM decides the best mix to create an immersive soundscape
    - If only context is provided: generates prompts from text description
    - Total sounds generated = num_sounds (can be different from number of entities)
    """
    try:
        # Case 1: Model entities provided (with or without context)
        if request.entities and len(request.entities) > 0:
            # If entities are already provided, assume they were pre-selected by /api/select-entities
            # Only perform diversity selection if we received MORE entities than needed
            # (indicating the frontend sent all entities, not pre-selected ones)
            entities_to_use = request.entities

            # Check if entities seem pre-selected: if count matches num_sounds or is close
            # If entities >> num_sounds, they likely weren't pre-selected
            if len(request.entities) > request.num_sounds * 1.5:  # 50% threshold
                entities_to_use = llm_service.select_diverse_entities(
                    request.entities,
                    request.num_sounds
                )

            # Generate mixed entity-linked and context-based prompts in a single LLM call
            sound_list = llm_service.generate_prompts_for_entities(
                entities_to_use,
                request.num_sounds,
                request.context
            )

            # Format results - sounds can be a mix of entity-linked and context-based
            # Use the entity_index from LLM to link sounds to their corresponding entities
            entity_prompts = []
            for sound_data in sound_list:
                # Get entity_index from parsed data (0-based index, or None for context sounds)
                entity_idx = sound_data.get("entity_index")
                entity_data = None

                # If entity_idx is valid, link to that entity
                if entity_idx is not None and 0 <= entity_idx < len(entities_to_use):
                    entity_data = entities_to_use[entity_idx]

                entity_prompts.append({
                    "entity": entity_data,  # Linked to specific entity or None for context sounds
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

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()

        # Check the error type
        error_str = str(e)
        
        # Check if it's a quota exhausted error
        if '429' in error_str or 'quota' in error_str.lower() or 'RESOURCE_EXHAUSTED' in error_str:
            raise HTTPException(
                status_code=429,
                detail=error_str if 'quota' in error_str.lower() else "API quota exhausted. Please try again later."
            )
        
        # Check if it's an LLM overload error
        if '503' in error_str or 'overloaded' in error_str.lower() or 'UNAVAILABLE' in error_str:
            raise HTTPException(
                status_code=503,
                detail="LLM service is currently overloaded. Please try again in a moment."
            )

        raise HTTPException(status_code=500, detail=f"Error generating prompts: {error_str}")


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
        "prompts": result["prompts"],  # Include prompts with entity info for frontend
        "selected_entities": result.get("selected_entities", None)  # Include selected entities for verification
    }
    return response
