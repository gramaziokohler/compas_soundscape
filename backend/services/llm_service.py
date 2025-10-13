# backend/services/llm_service.py
# LLM Service for text generation and prompts

import json
import re
import google.genai as genai


class LLMService:
    """Service for interacting with Google Gemini LLM"""

    def __init__(self, client: genai.Client):
        self.client = client

    def _parse_prompt_and_name(self, text: str) -> dict:
        """Parse structured PROMPT: ... NAME: ... format into dict

        Args:
            text: Raw text that may contain PROMPT: and NAME: markers

        Returns:
            dict: {"prompt": str, "display_name": str} or None if parsing fails
        """
        # Try to parse PROMPT: ... NAME: ... format
        prompt_match = re.search(r'PROMPT:\s*(.+?)(?=\s*NAME:|$)', text, re.DOTALL)
        name_match = re.search(r'NAME:\s*(.+?)$', text, re.DOTALL | re.MULTILINE)

        if prompt_match and name_match:
            sound_prompt = prompt_match.group(1).strip()
            display_name = name_match.group(1).strip()

            # Clean up formatting
            sound_prompt = re.sub(r'^\d+[\.\)]\s*', '', sound_prompt)
            sound_prompt = re.sub(r'^[-\*]\s*', '', sound_prompt)
            display_name = re.sub(r'^[-\*"\'\[\]]\s*', '', display_name)
            display_name = re.sub(r'\s*[-"\'\[\]]$', '', display_name)

            return {
                "prompt": sound_prompt,
                "display_name": display_name
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

Prioritize : Name, then Type, then position, then Material.

Return ONLY a JSON array of the selected indices (numbers), like: [0, 5, 12, 18, ...]
No explanation, just the JSON array."""

        try:
            response = self.client.models.generate_content(
                model="gemini-2.5-flash", contents=diversity_prompt
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

    def generate_sound_prompt_for_entity(self, entity: dict, context: str = None) -> dict:
        """Generate a sound prompt and display name for a specific entity using LLM

        Returns:
            dict: {"prompt": str, "display_name": str}
        """
        entity_description = f"{entity.get('type', 'object')}"
        if entity.get('name'):
            entity_description += f" named '{entity['name']}'"
        if entity.get('layer'):
            entity_description += f" on layer '{entity['layer']}'"
        if entity.get('material'):
            entity_description += f" with material '{entity['material']}'"

        context_intro = ""
        if context and context.strip():
            context_intro = f"In the context of {context}, imagine"
        else:
            context_intro = "Imagine"

        llm_prompt = f"""{context_intro} a single sound that would be made by or associated with a {entity_description}.

Generate a sound prompt suitable for an audio generation model, AND a short 2-3 word display name.

Follow these guidelines for the sound prompt:
- Use adjectives for description (e.g., "clear", "gentle", "heavy")
- Be context-specific (e.g., "rolling on wooden floor", "closing latch click")
- Consider the material properties if mentioned
- Use general terms (avoid brand names)
- Do not include architectural acoustics features nor perspective info
- Focus on the sound itself, not the environment

For the display name:
- Extract 2-3 most important words that identify the sound source
- Use title case (e.g., "Sliding Door", "Metal Lid", "HVAC System")

Return your response in this EXACT format, without any extra text:
PROMPT: [your sound prompt here]
NAME: [your 2-3 word display name here]"""

        try:
            response = self.client.models.generate_content(
                model="gemini-2.5-flash", contents=llm_prompt
            )
            response_text = response.text.strip()

            # Use unified parsing function
            parsed = self._parse_prompt_and_name(response_text)

            if parsed:
                return parsed
            else:
                # Fallback: treat entire response as prompt and extract name from entity
                sound_prompt = response_text
                sound_prompt = re.sub(r'^\d+[\.\)]\s*', '', sound_prompt)
                sound_prompt = re.sub(r'^[-\*]\s*', '', sound_prompt)

                # Generate fallback display name from entity info
                display_name = entity.get('name') or entity.get('type', 'Sound')
                if len(display_name) > 20:
                    display_name = display_name[:20]

                return {
                    "prompt": sound_prompt,
                    "display_name": display_name.title()
                }

        except Exception as e:
            print(f"Error generating prompt for {entity.get('type')}: {e}")
            raise

    def generate_text_based_prompts(self, context: str, num_sounds: int) -> tuple[str, list[dict]]:
        """Generate sound prompts with display names from text description only

        Returns:
            tuple: (raw_text, list of {"prompt": str, "display_name": str})
        """
        enhanced_prompt = f"""Imagine {num_sounds} possible sounds that can happen in {context}.

For each sound, provide both a detailed prompt and a short 2-3 word display name.

Format your response as a numbered list with each sound using this EXACT format, , without any extra text:
1. PROMPT: [your sound prompt here]
NAME: [your 2-3 word display name here]
2.
...and so on

For the sound prompts:
    *   Use adjectives for description (e.g., "clear", "gentle", "heavy").
    *   Be context-specific (e.g., "rolling on wooden floor", "closing latch click").
    *   Use general terms (e.g., "office chair", not a brand name).
    *   Do not include titles, categorization, conditions, architectural acoustics features (e.g., "in a large reverberant room") or perspective/perception info in the prompt itself (e.g., "distant sound").
    *   Only impact sounds should potentially include textural/architectural info (e.g., "on wooden floor").

For the display names:
    *   Extract 2-3 most important words that identify the sound source
    *   Use title case (e.g., "Office Chair", "Water Fountain", "Air Conditioner")

Now generate {num_sounds} sounds for: {context}"""

        response = self.client.models.generate_content(
            model="gemini-2.5-flash", contents=enhanced_prompt
        )

        raw_text = response.text
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
                        "display_name": display_name
                    })

        return raw_text, sound_list
