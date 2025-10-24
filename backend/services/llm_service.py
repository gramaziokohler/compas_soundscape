# backend/services/llm_service.py
# LLM Service for text generation and prompts

import json
import re
import google.genai as genai
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
)


class LLMService:
    """Service for interacting with Google Gemini LLM"""

    def __init__(self, client: genai.Client):
        self.client = client

    def _parse_prompt_and_name(self, text: str) -> dict:
        """Parse structured PROMPT: ... NAME: ... SPL: ... INTERVAL: ... DURATION: ... format into dict

        Args:
            text: Raw text that may contain PROMPT:, NAME:, SPL:, INTERVAL:, and DURATION: markers

        Returns:
            dict: {"prompt": str, "display_name": str, "spl_db": float, "interval_seconds": float, "duration_seconds": float} or None if parsing fails
        """
        # Try to parse PROMPT: ... NAME: ... SPL: ... INTERVAL: ... DURATION: ... format
        prompt_match = re.search(r'PROMPT:\s*(.+?)(?=\s*NAME:|$)', text, re.DOTALL)
        name_match = re.search(r'NAME:\s*(.+?)(?=\s*SPL:|$)', text, re.DOTALL | re.MULTILINE)
        spl_match = re.search(r'SPL:\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
        interval_match = re.search(r'INTERVAL:\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
        duration_match = re.search(r'DURATION:\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)

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

            return {
                "prompt": sound_prompt,
                "display_name": display_name,
                "spl_db": spl_db,
                "interval_seconds": interval_seconds,
                "duration_seconds": duration_seconds
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
- Different object types
- Different materials (wood, metal, glass, concrete, etc.)
- Different layers (which may indicate function or location)

Prioritize : Name, then position, then Material, then type.

Return ONLY a JSON array of the selected indices (numbers), like: [0, 5, 12, 18, ...]
No explanation, just the JSON array."""

        try:
            response = self.client.models.generate_content(
                model=LLM_MODEL_NAME, contents=diversity_prompt
            )
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
            return entities[:max_sounds]

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
            # Entity-based generation

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
                context_intro = f"In the context of {context}, with an architectural scene made of the following {len(entities)} objects: {entities_text}, imagine {len(entities)}"
            else:
                context_intro = f"In an architectural scene made of the following {len(entities)} objects: {entities_text}, imagine {len(entities)}"
        else:
            context_intro = f"In the architectural context of {context}, imagine {num_sounds}"

        return f"""{context_intro} possible sounds that could happen. 

For each object, provide a 5 to 10 words sound prompt, a short 2-3 word display name, estimate the Sound Pressure Level (SPL) in dB at the source, estimate how often this sound would typically occur (in seconds), AND estimate the typical duration of the sound event (in seconds with 0.1 precision).

Format your response as a numbered list with each sound using this EXACT format, without any extra text:
1. PROMPT: [your sound prompt here]
NAME: [your 2-3 word display name here]
SPL: [estimated dB value, e.g., 75]
INTERVAL: [estimated interval in seconds, e.g., 120]
DURATION: [estimated duration in seconds with 0.1 precision, e.g., 3.5]
2.
...and so on

For the sound prompts:
    *   Use in priority words from AudioSet audio event classes.
    *   Use adjectives for description (e.g., "clear", "gentle", "heavy").
    *   Be context-specific if mentionned (e.g., "rolling on wooden floor", "closing latch click").
    *   Consider the material properties if mentioned.
    *   Use general terms (e.g., "office chair", not a brand name).
    *   DO NOT INCLUDE: titles, categorization, conditions, architectural acoustics features (e.g., "in a large reverberant room"), distances or perspective/perception info in the prompt itself (e.g., "distant sound").
    *   Only impact sounds should potentially include textural/architectural info (e.g., "on wooden floor").

For the display names:
    *   Extract 2-3 most important words that identify the sound source
    *   Use title case (e.g., "Sliding Door", "Metal Lid", "HVAC System")

For the SPL estimation (in dB):
    *   Consider typical source levels for this type of sound
    *   Reference examples: whisper (30 dB), normal conversation (60 dB), vacuum cleaner (70 dB), heavy traffic (85 dB), power tools (95 dB), rock concert (110 dB)
    *   Provide a single number between 30-120 dB representing the typical SPL at 1 meter from the source

For the interval estimation (in seconds):
    *   How often would this sound typically occur in the given context?
    *   Examples: door closing (120 seconds), keyboard typing (10 seconds), HVAC hum (continuous, use 5 seconds), footsteps (20 seconds), phone ringing (180 seconds)
    *   Provide a single number between 5-300 seconds representing how often the sound would play

For the duration estimation (in seconds with 0.1 precision):
    *   How long does this specific sound event last?
    *   Consider the nature of the sound: impact sounds are brief, continuous sounds are longer
    *   Examples: door slam (0.8 seconds), keyboard click (0.1 seconds), phone ring cycle (2.5 seconds), HVAC hum (use 10.0 for continuous), footstep (0.3 seconds), drawer closing (1.2 seconds)
    *   Provide a single number between 0.5-30.0 seconds with 0.1 precision (e.g., 2.3, 0.7, 5.0)
    *   Brief impacts: 0.1-1.0 seconds | Short events: 1.0-5.0 seconds | Medium events: 5.0-15.0 seconds | Long/continuous: 15.0-30.0 seconds"""

    def generate_prompts_for_entities(self, entities: list[dict], context: str = None) -> list[dict]:
        """Generate sound prompts for multiple entities in a single LLM call (batch processing)

        Args:
            entities: List of entity dictionaries
            context: Optional context description

        Returns:
            list[dict]: List of {"prompt": str, "display_name": str, "spl_db": float, "interval_seconds": float}
        """
        if not entities or len(entities) == 0:
            return []

        llm_prompt = self._create_base_sound_prompt(context or "", len(entities), entities)

        try:
            response = self.client.models.generate_content(
                model=LLM_MODEL_NAME, contents=llm_prompt
            )
            response_text = response.text.strip()

            # Print raw LLM response to terminal
            print(f"\n=== LLM Raw Response (Batch Entity Generation: {len(entities)} entities) ===")
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
                            "duration_seconds": DEFAULT_DURATION_SECONDS
                        })

            return sound_list

        except Exception as e:
            print(f"Error generating prompts for entities: {e}")
            raise

    def generate_text_based_prompts(self, context: str, num_sounds: int) -> tuple[str, list[dict]]:
        """Generate sound prompts with display names from text description only

        Returns:
            tuple: (raw_text, list of {"prompt": str, "display_name": str, "spl_db": float, "interval_seconds": float})
        """
        # Use unified base prompt (no entities)
        enhanced_prompt = self._create_base_sound_prompt(context, num_sounds, entities=None)

        response = self.client.models.generate_content(
            model=LLM_MODEL_NAME, contents=enhanced_prompt
        )

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
                        "duration_seconds": DEFAULT_DURATION_SECONDS
                    })

        return raw_text, sound_list
