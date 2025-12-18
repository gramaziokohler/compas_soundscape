# backend/services/llm_service.py
# LLM Service for text generation and prompts

import json
import re
import time
import google.genai as genai
from google.genai.errors import ServerError, ClientError
from config.constants import (
    LLM_MODEL_NAME,
    DEFAULT_SPL_DB,
    LLM_SUGGESTED_INTERVAL_SECONDS,
    DEFAULT_DURATION_SECONDS,
    SPL_MIN,
    SPL_MAX,
    INTERVAL_MIN,
    INTERVAL_MAX,
    DURATION_MIN,
    DURATION_MAX,
    LLM_MAX_RETRIES,
    LLM_INITIAL_RETRY_DELAY,
    LLM_MAX_RETRY_DELAY,
    LLM_BACKOFF_MULTIPLIER,
)


class LLMService:
    """Service for interacting with Google Gemini LLM"""

    def __init__(self, client: genai.Client):
        self.client = client
        self.progress_callback = None  # Optional callback for retry progress updates

    def set_progress_callback(self, callback):
        """Set a callback function to receive progress updates during retries

        Args:
            callback: Function that accepts (attempt: int, max_attempts: int, delay: float, error_msg: str)
        """
        self.progress_callback = callback

    def _call_llm_with_retry(self, prompt: str, operation_name: str = "LLM request"):
        """Call LLM with exponential backoff retry logic for 503 errors

        Args:
            prompt: The prompt to send to the LLM
            operation_name: Human-readable name for this operation (for progress messages)

        Returns:
            Response from LLM

        Raises:
            Exception: If all retries are exhausted or a non-retryable error occurs
        """
        delay = LLM_INITIAL_RETRY_DELAY
        last_error = None

        for attempt in range(1, LLM_MAX_RETRIES + 1):
            try:
                response = self.client.models.generate_content(
                    model=LLM_MODEL_NAME,
                    contents=prompt
                )
                return response

            except Exception as e:
                error_str = str(e)
                last_error = e

                # Check if it's a quota exhausted error (429)
                is_quota_error = (
                    '429' in error_str or
                    'RESOURCE_EXHAUSTED' in error_str or
                    'quota' in error_str.lower() or
                    isinstance(e, ClientError) and hasattr(e, 'status_code') and e.status_code == 429
                )

                if is_quota_error:
                    # Extract retry delay if available
                    retry_match = re.search(r'retry in (\d+(?:\.\d+)?)s', error_str)
                    retry_delay = float(retry_match.group(1)) if retry_match else None
                    
                    # Format a user-friendly error message
                    error_msg = "Google Gemini API quota exhausted. "
                    if 'free_tier' in error_str.lower():
                        error_msg += "You've reached the free tier limit (20 requests/day). "
                    if retry_delay:
                        retry_hours = retry_delay / 3600
                        if retry_hours >= 1:
                            error_msg += f"Please retry in {retry_hours:.1f} hours."
                        else:
                            retry_minutes = retry_delay / 60
                            error_msg += f"Please retry in {retry_minutes:.1f} minutes."
                    else:
                        error_msg += "Please check your plan and billing details."
                    
                    # Raise with clean message
                    raise Exception(error_msg)

                # Check if it's a retryable error (503 overload)
                is_retryable = (
                    '503' in error_str or
                    'overloaded' in error_str.lower() or
                    'UNAVAILABLE' in error_str or
                    'ServerError' in str(type(e).__name__)
                )

                if not is_retryable:
                    # Non-retryable error, raise immediately
                    raise

                # If this was the last attempt, raise the error
                if attempt >= LLM_MAX_RETRIES:
                    print(f"❌ {operation_name} failed after {LLM_MAX_RETRIES} attempts")
                    raise

                # Calculate wait time with exponential backoff
                wait_time = min(delay, LLM_MAX_RETRY_DELAY)

                # Send progress update if callback is set
                if self.progress_callback:
                    self.progress_callback(
                        attempt=attempt,
                        max_attempts=LLM_MAX_RETRIES,
                        delay=wait_time,
                        error_msg=error_str
                    )

                # Log retry attempt
                print(f"⏳ {operation_name} failed (attempt {attempt}/{LLM_MAX_RETRIES}): {error_str}")
                print(f"   Retrying in {wait_time:.1f} seconds...")

                # Wait before retry
                time.sleep(wait_time)

                # Increase delay for next attempt (exponential backoff)
                delay *= LLM_BACKOFF_MULTIPLIER

        # This should never be reached, but just in case
        raise last_error if last_error else Exception(f"{operation_name} failed")

    def _parse_prompt_and_name(self, text: str) -> dict:
        """Parse structured PROMPT: ... NAME: ... SPL: ... INTERVAL: ... DURATION: ... ENTITY: ... format into dict

        Args:
            text: Raw text that may contain PROMPT:, NAME:, SPL:, INTERVAL:, DURATION:, and ENTITY: markers

        Returns:
            dict: {"prompt": str, "display_name": str, "spl_db": float, "interval_seconds": float, "duration_seconds": float, "entity_index": int or None} or None if parsing fails
        """
        # Try to parse PROMPT: ... NAME: ... SPL: ... INTERVAL: ... DURATION: ... ENTITY: ... format
        prompt_match = re.search(r'PROMPT:\s*(.+?)(?=\s*NAME:|$)', text, re.DOTALL)
        name_match = re.search(r'NAME:\s*(.+?)(?=\s*SPL:|$)', text, re.DOTALL | re.MULTILINE)
        spl_match = re.search(r'SPL:\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
        interval_match = re.search(r'INTERVAL:\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
        duration_match = re.search(r'DURATION:\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
        entity_match = re.search(r'ENTITY:\s*(\d+|NONE|none|None)', text, re.IGNORECASE)

        if prompt_match and name_match:
            sound_prompt = prompt_match.group(1).strip()
            display_name = name_match.group(1).strip()

            # Clean up formatting
            sound_prompt = re.sub(r'^\d+[\.\)]\s*', '', sound_prompt)
            sound_prompt = re.sub(r'^[-\*]\s*', '', sound_prompt)
            display_name = re.sub(r'^[-\*"\'\[\]]\s*', '', display_name)
            display_name = re.sub(r'\s*[-"\'\[\]]$', '', display_name)

            # Extract SPL value
            spl_db = DEFAULT_SPL_DB
            if spl_match:
                try:
                    spl_db = float(spl_match.group(1))
                    # Clamp to reasonable range
                    spl_db = max(SPL_MIN, min(SPL_MAX, spl_db))
                except ValueError:
                    pass

            # Extract interval value
            interval_seconds = LLM_SUGGESTED_INTERVAL_SECONDS
            if interval_match:
                try:
                    interval_seconds = float(interval_match.group(1))
                    # Clamp to reasonable range
                    interval_seconds = max(INTERVAL_MIN, min(INTERVAL_MAX, interval_seconds))
                except ValueError:
                    pass

            # Extract duration value
            duration_seconds = DEFAULT_DURATION_SECONDS
            if duration_match:
                try:
                    duration_seconds = float(duration_match.group(1))
                    # Clamp to reasonable range
                    duration_seconds = max(DURATION_MIN, min(DURATION_MAX, duration_seconds))
                    # Round to 0.1 precision
                    duration_seconds = round(duration_seconds, 1)
                except ValueError:
                    pass

            # Extract entity index (1-based from LLM, convert to 0-based, or None)
            entity_index = None
            if entity_match:
                entity_str = entity_match.group(1).strip()
                if entity_str.lower() != 'none':
                    try:
                        # LLM returns 1-based index, convert to 0-based
                        entity_index = int(entity_str) - 1
                    except ValueError:
                        pass

            return {
                "prompt": sound_prompt,
                "display_name": display_name,
                "spl_db": spl_db,
                "interval_seconds": interval_seconds,
                "duration_seconds": duration_seconds,
                "entity_index": entity_index
            }

        return None

    def select_diverse_entities(self, entities: list, max_sounds: int, entity_type: str = "objects") -> list:
        """Select most diverse entities using LLM"""
        if len(entities) <= max_sounds:
            return entities

        print(f"Selecting {max_sounds} most diverse {entity_type} from {len(entities)} total...")

        entity_summaries = []
        for i, entity in enumerate(entities):
            summary = f"{i}. {entity.get('type', 'Unknown')}"
            if entity.get('name'):
                summary += f" ('{entity['name']}')"
            if entity.get('layer'):
                summary += f" [Layer: {entity['layer']}]"
            if entity.get('material'):
                summary += f" [Material: {entity['material']}]"
            entity_summaries.append(summary)

        entities_list = "\n".join(entity_summaries)

        diversity_prompt = f"""You are selecting the most semantically diverse {entity_type} from a 3D model to create a varied soundscape.

Here are {len(entities)} {entity_type}:
{entities_list}

Select exactly {max_sounds} {entity_type} that would produce the MOST DIFFERENT and DIVERSE sounds. Consider:
- Different object names (doors, windows, furniture, appliances, etc.)
- Different materials (wood, metal, glass, concrete, etc.)
- Different layers (which may indicate function or location)

Prioritize : Name, then position, then Material, then type.

Return ONLY a JSON array of the selected indices (numbers), like: [0, 5, 12, 18, ...]
No explanation, just the JSON array."""

        try:
            response = self._call_llm_with_retry(diversity_prompt, "Entity selection")
            response_text = response.text.strip()

            json_match = re.search(r'\[[\d,\s]+\]', response_text)
            if json_match:
                selected_indices = json.loads(json_match.group())
                valid_indices = [i for i in selected_indices if 0 <= i < len(entities)]
                if len(valid_indices) >= max_sounds:
                    return [entities[i] for i in valid_indices[:max_sounds]]

            return entities[:max_sounds]
        except Exception as e:
            print(f"Error in diversity selection: {e}")
            # Re-raise the exception to let the endpoint handle it
            # Don't silently fallback to first entities when LLM fails
            raise

    def _create_base_sound_prompt(self, context: str, num_sounds: int, entities: list[dict] = None) -> str:
        """Create unified base prompt for sound generation (entity-based or text-based)

        Args:
            context: Context description (e.g., "an office space")
            num_sounds: Number of sounds to generate
            entities: Optional list of entities from 3D model

        Returns:
            str: Complete LLM prompt
        """
        if entities and len(entities) > 0:
            # Mixed entity-based and context-based generation

            # Build entity descriptions
            entity_descriptions = []
            for i, entity in enumerate(entities):
                desc = f"{i+1}. {entity.get('type', 'object')}"
                if entity.get('name'):
                    desc += f" named '{entity['name']}'"
                if entity.get('layer'):
                    desc += f" on layer '{entity['layer']}'"
                if entity.get('material'):
                    desc += f" with material '{entity['material']}'"
                entity_descriptions.append(desc)

            entities_text = "\n".join(entity_descriptions)
            if context and context.strip():
                context_intro = f"""IMPORTANT CONTEXT: {context.upper()}

You are designing a soundscape specifically for: "{context}"

The architectural scene contains these {len(entities)} objects:
{entities_text}

Generate EXACTLY {num_sounds} sounds total for this soundscape.

Your sounds can be a MIX of:
1. ENTITY-LINKED SOUNDS: Sounds directly related to the objects listed above (e.g., door closing, chair scraping, fridge humming)
2. NON-ENTITY CONTEXT SOUNDS: Sounds that would occur in "{context}" but aren't linked to the specific objects (e.g., people talking, footsteps, background music, ambient noise, human activities)

IMPORTANT GUIDELINES:
- Generate EXACTLY {num_sounds} sounds total
- ENTITY-LINKED REQUIREMENT: You MUST generate at least {min(num_sounds, len(entities))} entity-linked sounds
  - If {num_sounds} >= {len(entities)}: ALL {len(entities)} entities MUST have a linked sound, plus {max(0, num_sounds - len(entities))} additional context sounds
  - If {num_sounds} < {len(entities)}: Choose the {num_sounds} MOST RELEVANT entities for the context "{context}" and link sounds to them
- All sounds must make sense in the context of "{context}"
- Think about what would create the most immersive, realistic soundscape for this context

Examples for "busy restaurant at lunch time" with 3 entities and 5 sounds requested:
- Entity-linked to object #1 (door): kitchen swing door pushed by waitstaff
- Entity-linked to object #2 (chair): chair scraping as guest sits down
- Entity-linked to object #3 (table): plates being set down on wooden table
- Non-entity: background conversation chatter
- Non-entity: coffee machine hissing

When generating entity-linked sounds, you MUST prioritize linking to the entities.
Each entity should have exactly 1 sound linked to it (when num_sounds >= num_entities).

Generate exactly {num_sounds} sounds total"""
            else:
                # No context provided, still allow mix
                context_intro = f"""In an architectural scene made of the following {len(entities)} objects:
{entities_text}

Generate EXACTLY {num_sounds} sounds total for this soundscape.

Your sounds can be a MIX of:
1. ENTITY-LINKED SOUNDS: Sounds directly related to the objects listed above
2. AMBIENT/CONTEXT SOUNDS: Generic ambient sounds that would occur in such a space (e.g., footsteps, HVAC, distant traffic)

ENTITY-LINKED REQUIREMENT: You MUST generate at least {min(num_sounds, len(entities))} entity-linked sounds.
- If {num_sounds} >= {len(entities)}: ALL {len(entities)} entities MUST have a linked sound
- If {num_sounds} < {len(entities)}: Choose the {num_sounds} most sonically interesting entities

Generate exactly {num_sounds} sounds total"""
        else:
            context_intro = f"In the architectural context of {context}, imagine {num_sounds}"

        return f"""{context_intro} possible sounds that could happen.

For each sound, provide a 2 to 10 words sound prompt, a short 2-3 word display name, estimate the Sound Pressure Level (SPL) in dB at the source, estimate how often this sound would typically occur (in seconds), estimate the typical duration of the sound event (in seconds with 0.1 precision), AND indicate if it's linked to an entity.

Format your response as a numbered list with each sound using this EXACT format, without any extra text:
1. PROMPT: [your sound prompt here]
NAME: [your 2-3 word display name here]
SPL: [estimated dB value, e.g., 75]
INTERVAL: [estimated interval in seconds, e.g., 120]
DURATION: [estimated duration in seconds with 0.1 precision, e.g., 3.5]
ENTITY: [entity number from the list above (e.g., 1, 2, 3) if this sound is linked to that entity, or NONE if it's a non-entity context sound]
2.
...and so on

For the sound prompts:
    *   CRITICALLY IMPORTANT: The sound MUST make sense in the context of: {context}
    *   Think about how this object would be used or what sounds would occur in this specific scenario
    *   Use adjectives for description (e.g., "clear", "gentle", "heavy").
    *   Be context-specific (e.g., for "{context}", describe how the interaction would occur in that setting)
    *   Consider the material properties if mentioned.
    *   Use general terms (e.g., "office chair", not a brand name).
    *   DO NOT INCLUDE: titles, categorization, conditions, architectural acoustics features (e.g., "in a large reverberant room"), distances or perspective/perception info in the prompt itself (e.g., "distant sound").
    *   Only impact sounds should potentially include textural/architectural info (e.g., "on wooden floor").

For the display names:
    *   Extract 2-3 most important words that identify the sound source
    *   Use title case (e.g., "Sliding Door", "Metal Lid", "HVAC System")

For the SPL estimation (in dB):
    *   Consider how loud this sound would typically be IN THE CONTEXT OF: {context}
    *   Reference examples: whisper (30 dB), normal conversation (60 dB), vacuum cleaner (70 dB), heavy traffic (85 dB), power tools (95 dB), rock concert (110 dB)
    *   Provide a single number between 30-120 dB representing the typical SPL at 1 meter from the source
    *   The intensity should match realistic usage in: {context}

For the interval estimation (in seconds):
    *   CRITICALLY IMPORTANT: How often would this sound occur SPECIFICALLY IN: {context}
    *   Think about the activity level and usage patterns in this context
    *   Examples: door closing (120 seconds), keyboard typing (10 seconds), HVAC hum (continuous, use 0 seconds), footsteps (20 seconds), phone ringing (180 seconds)
    *   Return 0 seconds for continuous sounds or background sounds
    *   Provide a single number between 0-300 seconds representing frequency in: {context}
    
For the duration estimation (in seconds with 0.1 precision):
    *   How long does this specific sound event last IN THE CONTEXT OF: {context}
    *   Consider the nature of the sound: impact sounds are brief, continuous sounds are longer
    *   Consider how the sound would be used/occur in this specific scenario
    *   Examples: door slam (0.8 seconds), keyboard click (0.1 seconds), phone ring cycle (2.5 seconds), HVAC hum (15.0 seconds), drawer closing (1.2 seconds)
    *   Provide a single number between 0.0-30.0 seconds with 0.1 precision (e.g., 2.3, 0.7, 5.0)
    *   Brief impacts: 0.1-1.0 seconds | Short events: 1.0-5.0 seconds | Medium events: 5.0-15.0 seconds | Long/continuous: 15.0-30.0 seconds    
    
    """

    def generate_prompts_for_entities(self, entities: list[dict], num_sounds: int, context: str = None) -> list[dict]:
        """Generate sound prompts mixing entity-based and context-based sounds

        Args:
            entities: List of entity dictionaries from 3D model
            num_sounds: Total number of sounds to generate (can be more or less than len(entities))
            context: Optional context description

        Returns:
            list[dict]: List of {"prompt": str, "display_name": str, "spl_db": float, "interval_seconds": float, "duration_seconds": float, "entity_index": int or None}
        """
        if num_sounds <= 0:
            return []

        llm_prompt = self._create_base_sound_prompt(context or "", num_sounds, entities)

        try:
            response = self._call_llm_with_retry(llm_prompt, "Sound prompt generation")
            response_text = response.text.strip()

            # Print raw LLM response to terminal
            print(f"\n=== LLM Raw Response (Mixed Generation: {num_sounds} sounds from {len(entities) if entities else 0} entities) ===")
            print(response_text)
            print("=" * 60 + "\n", flush=True)

            sound_list = []

            # Split by numbered entries (1., 2., etc.)
            entries = re.split(r'\n\s*\d+[\.\)]\s*', response_text)

            for i, entry in enumerate(entries):
                entry = entry.strip()
                if not entry:
                    continue

                # Use unified parsing function
                parsed = self._parse_prompt_and_name(entry)

                if parsed:
                    sound_list.append(parsed)
                else:
                    # Fallback: treat as plain prompt, extract name from entity
                    cleaned = re.sub(r'^\d+[\.\)]\s*', '', entry)
                    cleaned = re.sub(r'^[-\*]\s*', '', cleaned)

                    if cleaned:
                        # Try to get display name from corresponding entity
                        entity_idx = len(sound_list)  # Current position in results
                        if entity_idx < len(entities):
                            entity = entities[entity_idx]
                            display_name = entity.get('name') or entity.get('type', 'Sound')
                            if len(display_name) > 20:
                                display_name = display_name[:20]
                            display_name = display_name.title()
                        else:
                            # Fallback: extract from prompt
                            words = cleaned.split()
                            skip_words = {'a', 'an', 'the', 'subtle', 'gentle', 'soft', 'loud', 'quiet', 'clear', 'heavy', 'light'}
                            name_words = [w for w in words[:5] if w.lower() not in skip_words][:3]
                            display_name = ' '.join(name_words).title() if name_words else 'Sound'

                        sound_list.append({
                            "prompt": cleaned,
                            "display_name": display_name,
                            "spl_db": DEFAULT_SPL_DB,
                            "interval_seconds": LLM_SUGGESTED_INTERVAL_SECONDS,
                            "duration_seconds": DEFAULT_DURATION_SECONDS,
                            "entity_index": None  # Fallback case: no entity linkage
                        })

            return sound_list

        except Exception as e:
            print(f"Error generating prompts for entities: {e}")
            raise

    def generate_text_based_prompts(self, context: str, num_sounds: int) -> tuple[str, list[dict]]:
        """Generate sound prompts with display names from text description only

        Returns:
            tuple: (raw_text, list of {"prompt": str, "display_name": str, "spl_db": float, "interval_seconds": float, "duration_seconds": float, "entity_index": None})
        """
        # Use unified base prompt (no entities)
        enhanced_prompt = self._create_base_sound_prompt(context, num_sounds, entities=None)

        response = self._call_llm_with_retry(enhanced_prompt, "Text-based prompt generation")

        raw_text = response.text

        # Print raw LLM response to terminal
        print(f"\n=== LLM Raw Response (Text-based generation) ===")
        print(raw_text)
        print("=" * 60 + "\n")

        sound_list = []

        # Split by numbered entries (1., 2., etc.)
        entries = re.split(r'\n\s*\d+[\.\)]\s*', raw_text)

        for entry in entries:
            entry = entry.strip()
            if not entry:
                continue

            # Use unified parsing function
            parsed = self._parse_prompt_and_name(entry)

            if parsed:
                sound_list.append(parsed)
            else:
                # Fallback: treat as plain prompt, extract name from first few words
                cleaned = re.sub(r'^\d+[\.\)]\s*', '', entry)
                cleaned = re.sub(r'^[-\*]\s*', '', cleaned)

                if cleaned:
                    words = cleaned.split()
                    # Try to find nouns (skip common adjectives)
                    skip_words = {'a', 'an', 'the', 'subtle', 'gentle', 'soft', 'loud', 'quiet', 'clear', 'heavy', 'light'}
                    name_words = [w for w in words[:5] if w.lower() not in skip_words][:3]
                    display_name = ' '.join(name_words).title() if name_words else 'Sound'

                    sound_list.append({
                        "prompt": cleaned,
                        "display_name": display_name,
                        "spl_db": DEFAULT_SPL_DB,
                        "interval_seconds": LLM_SUGGESTED_INTERVAL_SECONDS,
                        "duration_seconds": DEFAULT_DURATION_SECONDS,
                        "entity_index": None  # Text-based prompts have no entity linkage
                    })

        return raw_text, sound_list
