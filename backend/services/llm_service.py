# backend/services/llm_service.py
# LLM Service for text generation and prompts

import json
import re
import google.genai as genai


class LLMService:
    """Service for interacting with Google Gemini LLM"""

    def __init__(self, client: genai.Client):
        self.client = client

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
- Different acoustic properties (hard vs soft, heavy vs light, moving vs static)

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

    def generate_sound_prompt_for_entity(self, entity: dict, context: str = None) -> str:
        """Generate a sound prompt for a specific entity using LLM"""
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

Generate only ONE short, descriptive sound prompt suitable for an audio generation model. Follow these guidelines:
- Use adjectives for description (e.g., "clear", "gentle", "heavy")
- Be context-specific (e.g., "rolling on wooden floor", "closing latch click")
- Consider the material properties if mentioned
- Use general terms (avoid brand names)
- Do not include architectural acoustics features or perspective info
- Focus on the sound itself, not the environment

Return ONLY the sound prompt, nothing else."""

        try:
            response = self.client.models.generate_content(
                model="gemini-2.5-flash", contents=llm_prompt
            )
            sound_prompt = response.text.strip()

            # Clean up formatting
            sound_prompt = re.sub(r'^\d+[\.\)]\s*', '', sound_prompt)
            sound_prompt = re.sub(r'^[-\*]\s*', '', sound_prompt)

            return sound_prompt
        except Exception as e:
            print(f"Error generating prompt for {entity.get('type')}: {e}")
            raise

    def generate_text_based_prompts(self, context: str, num_sounds: int) -> tuple[str, list[str]]:
        """Generate sound prompts from text description only"""
        enhanced_prompt = f"""Imagine {num_sounds} possible sounds that can happen in {context}.

Format your response as a simple numbered list (without introduction phrase), with each sound on its own line.
For each identified sound event, write a clear, descriptive text prompt suitable for an audio generation model like audioldm2. Follow these prompt guidelines:
    *   Use adjectives for description (e.g., "clear", "gentle", "heavy").
    *   Be context-specific (e.g., "rolling on wooden floor", "closing latch click").
    *   Use general terms (e.g., "office chair", not a brand name).
    *   Do not include titles, categorization, conditions, architectural acoustics features (e.g., "in a large reverberant room") or perspective/perception info in the prompt itself (e.g., "distant sound").
    *   Only impact sounds should potentially include textural/architectural info (e.g., "on wooden floor").

Now generate {num_sounds} sounds for: {context}"""

        response = self.client.models.generate_content(
            model="gemini-2.5-flash", contents=enhanced_prompt
        )

        raw_text = response.text
        sound_list = []

        for line in raw_text.strip().split('\n'):
            line = line.strip()
            if not line:
                continue
            cleaned = re.sub(r'^\d+[\.\)]\s*', '', line)
            cleaned = re.sub(r'^[-\*]\s*', '', cleaned)
            if cleaned:
                sound_list.append(cleaned)

        return raw_text, sound_list
