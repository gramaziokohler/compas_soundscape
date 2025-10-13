from fastapi import APIRouter, HTTPException
from services.llm_service import LLMService
from models.schemas import PromptRequest, UnifiedPromptGenerationRequest

router = APIRouter()

# This will be injected by main.py
llm_service = None


def init_generation_router(service: LLMService):
    """Initialize router with LLM service"""
    global llm_service
    llm_service = service


@router.post("/api/generate-prompts")
async def generate_prompts(request: UnifiedPromptGenerationRequest):
    """
    Unified endpoint for generating sound prompts.
    - If entities are provided: generates contextual prompts based on model objects
    - If only context is provided: generates prompts from text description
    - If both: combines context as introduction with object-based prompts
    """
    try:
        # Case 1: Model entities provided (with or without context)
        if request.entities and len(request.entities) > 0:
            # Select most diverse entities if we have too many
            selected_entities = llm_service.select_diverse_entities(
                request.entities,
                request.num_sounds
            )

            # Generate contextual prompts for each entity
            entity_prompts = []
            for entity in selected_entities:
                try:
                    result = llm_service.generate_sound_prompt_for_entity(
                        entity,
                        request.context
                    )
                    entity_prompts.append({
                        "entity": entity,
                        "prompt": result["prompt"],
                        "display_name": result["display_name"]
                    })
                except Exception as e:
                    print(f"Error generating prompt for {entity.get('type')}: {e}")
                    continue

            return {"prompts": entity_prompts}

        # Case 2: Only context provided (traditional text generation)
        elif request.context and request.context.strip():
            raw_text, sound_list = llm_service.generate_text_based_prompts(
                request.context,
                request.num_sounds
            )

            # sound_list now contains dicts with {"prompt": str, "display_name": str}
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
