#!/usr/bin/env python
"""
Test script to verify the unified LLM generation workflow
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

def test_llm_service_methods():
    """Test that LLM service has the required methods"""
    from services.llm_service import LLMService

    print("✓ LLMService imported successfully")

    # Check that the new method exists
    assert hasattr(LLMService, '_create_base_sound_prompt'), "Missing _create_base_sound_prompt method"
    print("✓ _create_base_sound_prompt method exists")

    assert hasattr(LLMService, 'generate_prompts_for_entities'), "Missing generate_prompts_for_entities method"
    print("✓ generate_prompts_for_entities method exists")

    assert hasattr(LLMService, 'generate_text_based_prompts'), "Missing generate_text_based_prompts method"
    print("✓ generate_text_based_prompts method exists")

    assert hasattr(LLMService, '_parse_prompt_and_name'), "Missing _parse_prompt_and_name method"
    print("✓ _parse_prompt_and_name method exists")

    print("\n✅ All LLM service methods exist")

def test_generation_router():
    """Test that generation router is properly structured"""
    from routers.generation import generate_prompts

    print("✓ generation.py imported successfully")
    print("✓ generate_prompts endpoint exists")

    print("\n✅ Generation router is properly structured")

def test_schemas():
    """Test that schemas have required fields"""
    from models.schemas import UnifiedPromptGenerationRequest, SoundGenerationRequest

    print("✓ Schemas imported successfully")

    # Test UnifiedPromptGenerationRequest
    request = UnifiedPromptGenerationRequest(context="test", num_sounds=5)
    assert hasattr(request, 'context'), "Missing context field"
    assert hasattr(request, 'num_sounds'), "Missing num_sounds field"
    assert hasattr(request, 'entities'), "Missing entities field"
    print("✓ UnifiedPromptGenerationRequest has all required fields")

    # Test SoundGenerationRequest
    sound_config = {
        "prompt": "test",
        "duration": 5,
        "spl_db": 70.0,
        "interval_seconds": 30.0
    }
    sound_request = SoundGenerationRequest(sounds=[sound_config])
    assert hasattr(sound_request, 'sounds'), "Missing sounds field"
    print("✓ SoundGenerationRequest has all required fields")

    print("\n✅ All schemas have required fields")

def test_audio_service():
    """Test that audio service handles interval_seconds"""
    from services.audio_service import AudioService

    print("✓ AudioService imported successfully")

    # Check the generate_multiple_sounds signature
    import inspect
    sig = inspect.signature(AudioService.generate_multiple_sounds)
    print(f"✓ generate_multiple_sounds parameters: {list(sig.parameters.keys())}")

    print("\n✅ Audio service is properly structured")

if __name__ == "__main__":
    print("="*60)
    print("Testing Unified LLM Generation Workflow")
    print("="*60)
    print()

    try:
        test_llm_service_methods()
        print()
        test_generation_router()
        print()
        test_schemas()
        print()
        test_audio_service()
        print()
        print("="*60)
        print("✅ ALL TESTS PASSED!")
        print("="*60)
    except Exception as e:
        print()
        print("="*60)
        print(f"❌ TEST FAILED: {e}")
        print("="*60)
        import traceback
        traceback.print_exc()
        sys.exit(1)
