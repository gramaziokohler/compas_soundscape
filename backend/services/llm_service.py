# backend/services/llm_service.py
# LLM Service for text generation and prompts

import asyncio
import base64
import json
import logging
import re
import time

logger = logging.getLogger(__name__)
try:
    import google.genai as genai
    from google.genai.errors import ServerError, ClientError
    GOOGLE_GENAI_AVAILABLE = True
except ImportError:
    genai = None
    ServerError = None
    ClientError = None
    GOOGLE_GENAI_AVAILABLE = False

try:
    import openai as _openai_module
    OPENAI_AVAILABLE = True
except ImportError:
    _openai_module = None
    OPENAI_AVAILABLE = False

try:
    import anthropic as _anthropic_module
    ANTHROPIC_AVAILABLE = True
except ImportError:
    _anthropic_module = None
    ANTHROPIC_AVAILABLE = False

from config.constants import (
    LLM_MODEL_OPENAI,
    LLM_MODEL_ANTHROPIC,
    DEFAULT_LLM_MODEL,
    LLM_MODEL_VERSIONS,
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
    LLM_PROVIDER_GOOGLE,
    LLM_PROVIDER_OPENAI,
    LLM_PROVIDER_ANTHROPIC,
)


class Error(Exception):
    pass


class LLMService:
    """Service for interacting with Google Gemini, OpenAI ChatGPT, and Anthropic Claude LLMs"""

    @staticmethod
    def get_service_version_info(llm_model: str = DEFAULT_LLM_MODEL) -> dict:
        import importlib.metadata

        def _pkg_version(pkg_name: str) -> str:
            try:
                return importlib.metadata.version(pkg_name)
            except importlib.metadata.PackageNotFoundError:
                return "unknown"

        return {
            LLM_PROVIDER_GOOGLE: {
                "name": "google-genai",
                "version": _pkg_version("google-genai") if GOOGLE_GENAI_AVAILABLE else None,
                "installed": GOOGLE_GENAI_AVAILABLE,
            },
            LLM_PROVIDER_OPENAI: {
                "name": "openai",
                "version": _pkg_version("openai") if OPENAI_AVAILABLE else None,
                "installed": OPENAI_AVAILABLE,
            },
            LLM_PROVIDER_ANTHROPIC: {
                "name": "anthropic",
                "version": _pkg_version("anthropic") if ANTHROPIC_AVAILABLE else None,
                "installed": ANTHROPIC_AVAILABLE,
            },
        }

    def __init__(self, client=None):
        self.gemini_client = client
        self.openai_client = None
        self.anthropic_client = None
        self.progress_callback = None  # Optional callback for retry progress updates

    def set_progress_callback(self, callback):
        """Set a callback function to receive progress updates during retries

        Args:
            callback: Function that accepts (attempt: int, max_attempts: int, delay: float, error_msg: str)
        """
        self.progress_callback = callback

    @staticmethod
    def _to_json_schema(response_schema) -> dict:
        """Convert a Pydantic model class to a plain JSON schema dict.

        Adds ``additionalProperties: false`` recursively at all object levels
        (required for OpenAI strict mode).
        """
        schema = response_schema.model_json_schema()

        def _add_no_additional(s: dict) -> None:
            if isinstance(s, dict):
                if s.get("type") == "object":
                    s["additionalProperties"] = False
                    for prop in s.get("properties", {}).values():
                        _add_no_additional(prop)
                elif s.get("type") == "array":
                    items = s.get("items")
                    if isinstance(items, dict):
                        _add_no_additional(items)
                for defn in s.get("$defs", {}).values():
                    _add_no_additional(defn)

        _add_no_additional(schema)
        return schema

    async def _call_llm(
        self,
        user_prompt: str,
        system_prompt: str = "",
        *,
        response_schema=None,
        screenshots: list[str] | None = None,
        streaming: bool = True,
        operation_name: str = "LLM request",
        llm_model: str = DEFAULT_LLM_MODEL,
    ) -> str | dict:
        """Unified async LLM caller with retry, schema enforcement, and optional streaming.

        Args:
            user_prompt:     The user-facing prompt text.
            system_prompt:   Optional system/role instructions.
            response_schema: Pydantic model class for structured JSON output, or None for plain text.
            screenshots:     Optional list of base64 PNG data URIs (max 3).
            streaming:       When True, print chunks live to stdout (same return type).
            operation_name:  Human-readable label for retry/progress messages.
            llm_model:       Provider key (gemini / openai / anthropic).

        Returns:
            str if response_schema is None, else dict parsed from JSON output.
        """
        import os as _os

        # Normalize screenshots
        clean_b64: list[str] = []
        raw_data_uris: list[str] = []
        if screenshots:
            for s in screenshots[:3]:
                if isinstance(s, str) and s.strip():
                    raw_data_uris.append(s)
                    clean_b64.append(s.split(",", 1)[1] if "," in s else s)

        # Compute schema dict once before retry loop
        schema_dict: dict | None = None
        if response_schema is not None:
            schema_dict = self._to_json_schema(response_schema)

        delay = LLM_INITIAL_RETRY_DELAY

        for attempt in range(1, LLM_MAX_RETRIES + 1):
            try:
                # ── OpenAI ────────────────────────────────────────────────────
                if llm_model == LLM_MODEL_OPENAI:
                    if not OPENAI_AVAILABLE:
                        raise ImportError("openai package not installed. Run: pip install openai")
                    async_client = _openai_module.AsyncOpenAI(api_key=_os.environ.get("OPENAI_API_KEY"))
                    user_content: list = [{"type": "text", "text": user_prompt}]
                    for data_uri in raw_data_uris:
                        user_content.append({"type": "image_url", "image_url": {"url": data_uri}})
                    messages: list = []
                    if system_prompt:
                        messages.append({"role": "system", "content": system_prompt})
                    messages.append({"role": "user", "content": user_content})

                    if schema_dict is not None:
                        rf = {
                            "type": "json_schema",
                            "json_schema": {"name": "output", "strict": True, "schema": schema_dict},
                        }
                        if streaming:
                            accumulated = ""
                            async with async_client.chat.completions.stream(
                                model=LLM_MODEL_VERSIONS[LLM_MODEL_OPENAI],
                                messages=messages,
                                response_format=rf,
                            ) as stream:
                                async for event in stream:
                                    if event.type == "content.delta":
                                        print(event.delta, end="", flush=True)
                                        accumulated += event.delta
                            print(flush=True)
                            return json.loads(accumulated)
                        else:
                            resp = await async_client.chat.completions.create(
                                model=LLM_MODEL_VERSIONS[LLM_MODEL_OPENAI],
                                messages=messages,
                                response_format=rf,
                            )
                            return json.loads(resp.choices[0].message.content)
                    else:
                        if streaming:
                            accumulated = ""
                            stream = await async_client.chat.completions.create(
                                model=LLM_MODEL_VERSIONS[LLM_MODEL_OPENAI],
                                messages=messages,
                                stream=True,
                            )
                            async for chunk in stream:
                                delta = chunk.choices[0].delta.content
                                if delta:
                                    print(delta, end="", flush=True)
                                    accumulated += delta
                            print(flush=True)
                            return accumulated
                        else:
                            resp = await async_client.chat.completions.create(
                                model=LLM_MODEL_VERSIONS[LLM_MODEL_OPENAI],
                                messages=messages,
                            )
                            return resp.choices[0].message.content

                # ── Anthropic ─────────────────────────────────────────────────
                elif llm_model == LLM_MODEL_ANTHROPIC:
                    if not ANTHROPIC_AVAILABLE:
                        raise ImportError("anthropic package not installed. Run: pip install anthropic")
                    async_client = _anthropic_module.AsyncAnthropic(api_key=_os.environ.get("ANTHROPIC_API_KEY"))
                    content_blocks: list = []
                    for b64_data in clean_b64:
                        content_blocks.append({
                            "type": "image",
                            "source": {"type": "base64", "media_type": "image/png", "data": b64_data},
                        })
                    content_blocks.append({"type": "text", "text": user_prompt})

                    if schema_dict is not None:
                        tool = {
                            "name": "output",
                            "description": "Output the structured result.",
                            "input_schema": schema_dict,
                        }
                        if streaming:
                            async with async_client.messages.stream(
                                model=LLM_MODEL_VERSIONS[LLM_MODEL_ANTHROPIC],
                                max_tokens=4096,
                                system=system_prompt,
                                tools=[tool],
                                tool_choice={"type": "tool", "name": "output"},
                                messages=[{"role": "user", "content": content_blocks}],
                            ) as stream:
                                async for event in stream:
                                    if (
                                        event.type == "content_block_delta"
                                        and hasattr(event.delta, "partial_json")
                                    ):
                                        print(event.delta.partial_json, end="", flush=True)
                                final_msg = await stream.get_final_message()
                            print(flush=True)
                            for block in final_msg.content:
                                if block.type == "tool_use" and block.name == "output":
                                    return block.input
                            raise ValueError("Anthropic response did not contain expected tool_use block")
                        else:
                            resp = await async_client.messages.create(
                                model=LLM_MODEL_VERSIONS[LLM_MODEL_ANTHROPIC],
                                max_tokens=4096,
                                system=system_prompt,
                                tools=[tool],
                                tool_choice={"type": "tool", "name": "output"},
                                messages=[{"role": "user", "content": content_blocks}],
                            )
                            for block in resp.content:
                                if block.type == "tool_use" and block.name == "output":
                                    return block.input
                            raise ValueError("Anthropic response did not contain expected tool_use block")
                    else:
                        if streaming:
                            accumulated = ""
                            async with async_client.messages.stream(
                                model=LLM_MODEL_VERSIONS[LLM_MODEL_ANTHROPIC],
                                max_tokens=4096,
                                system=system_prompt,
                                messages=[{"role": "user", "content": content_blocks}],
                            ) as stream:
                                async for text in stream.text_stream:
                                    print(text, end="", flush=True)
                                    accumulated += text
                            print(flush=True)
                            return accumulated
                        else:
                            resp = await async_client.messages.create(
                                model=LLM_MODEL_VERSIONS[LLM_MODEL_ANTHROPIC],
                                max_tokens=4096,
                                system=system_prompt,
                                messages=[{"role": "user", "content": content_blocks}],
                            )
                            return "".join(
                                block.text for block in resp.content if hasattr(block, "text")
                            )

                # ── Google Gemini (default) ────────────────────────────────────
                else:
                    if not GOOGLE_GENAI_AVAILABLE:
                        raise ImportError("google-genai package not installed. Run: pip install google-genai")
                    if not self.gemini_client:
                        self.gemini_client = genai.Client()
                    from google.genai import types as _gtypes
                    model_to_use = LLM_MODEL_VERSIONS.get(llm_model, "gemini-2.5-flash")
                    parts = [_gtypes.Part.from_text(text=user_prompt)]
                    for b64_data in clean_b64:
                        image_bytes = base64.b64decode(b64_data)
                        parts.append(_gtypes.Part.from_bytes(data=image_bytes, mime_type="image/png"))

                    if schema_dict is not None:
                        config = _gtypes.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_json_schema=schema_dict,
                            system_instruction=system_prompt,
                        )
                        if streaming:
                            accumulated = ""
                            response_stream = await self.gemini_client.aio.models.generate_content_stream(
                                model=model_to_use,
                                contents=[_gtypes.Content(role="user", parts=parts)],
                                config=config,
                            )
                            async for chunk in response_stream:
                                if chunk.text:
                                    print(chunk.text, end="", flush=True)
                                    accumulated += chunk.text
                            print(flush=True)
                            return json.loads(accumulated)
                        else:
                            response = await self.gemini_client.aio.models.generate_content(
                                model=model_to_use,
                                contents=[_gtypes.Content(role="user", parts=parts)],
                                config=config,
                            )
                            return json.loads(response.text or "{}")
                    else:
                        config = _gtypes.GenerateContentConfig(
                            system_instruction=system_prompt,
                        ) if system_prompt else None
                        contents: list = (  # type: ignore[assignment]
                            [_gtypes.Content(role="user", parts=parts)]
                            if clean_b64
                            else user_prompt  # type: ignore[list-item]
                        )
                        if streaming:
                            accumulated = ""
                            response_stream = await self.gemini_client.aio.models.generate_content_stream(
                                model=model_to_use,
                                contents=contents,
                                **({"config": config} if config else {}),
                            )
                            async for chunk in response_stream:
                                if chunk.text:
                                    print(chunk.text, end="", flush=True)
                                    accumulated += chunk.text
                            print(flush=True)
                            return accumulated
                        else:
                            response = await self.gemini_client.aio.models.generate_content(
                                model=model_to_use,
                                contents=contents,
                                **({"config": config} if config else {}),
                            )
                            return response.text or ""

            except Exception as e:
                error_str = str(e)
                is_quota = (
                    "429" in error_str
                    or "RESOURCE_EXHAUSTED" in error_str
                    or "quota" in error_str.lower()
                    or (
                        ClientError is not None
                        and isinstance(e, ClientError)
                        and getattr(e, "status_code", None) == 429
                    )
                )
                if is_quota:
                    raise

                is_retryable = (
                    "503" in error_str
                    or "overloaded" in error_str.lower()
                    or "UNAVAILABLE" in error_str
                    or "ServerError" in type(e).__name__
                    # Mid-stream network drops (aiohttp / OS level)
                    or "ClientPayloadError" in type(e).__name__
                    or "TransferEncodingError" in type(e).__name__
                    or "ConnectionResetError" in type(e).__name__
                    or "Response payload is not completed" in error_str
                    or "Not enough data to satisfy" in error_str
                )
                if not is_retryable:
                    raise

                if attempt >= LLM_MAX_RETRIES:
                    print(f"❌ {operation_name} failed after {LLM_MAX_RETRIES} attempts")
                    raise

                wait_time = min(delay, LLM_MAX_RETRY_DELAY)
                if self.progress_callback:
                    self.progress_callback(
                        attempt=attempt,
                        max_attempts=LLM_MAX_RETRIES,
                        delay=wait_time,
                        error_msg=error_str,
                    )
                print(f"\n⏳ {operation_name} failed (attempt {attempt}/{LLM_MAX_RETRIES}): {type(e).__name__}: {error_str}")
                print(f"   Retrying in {wait_time:.1f} seconds...")
                await asyncio.sleep(wait_time)
                delay *= LLM_BACKOFF_MULTIPLIER

        raise RuntimeError(f"{operation_name} failed after {LLM_MAX_RETRIES} attempts")

    async def _stream_llm_chunks(
        self,
        user_prompt: str,
        system_prompt: str = "",
        *,
        screenshots: list[str] | None = None,
        operation_name: str = "LLM stream",
        llm_model: str = DEFAULT_LLM_MODEL,
    ):
        """Async generator yielding raw text chunks from the LLM as they arrive.

        Supports optional screenshots (base64 PNG data URIs) for vision-capable models.
        Used by streaming generation methods for SSE endpoints.
        """
        import os as _os

        # Normalize screenshots
        clean_b64: list[str] = []
        raw_data_uris: list[str] = []
        if screenshots:
            for s in screenshots[:3]:
                if isinstance(s, str) and s.strip():
                    raw_data_uris.append(s)
                    clean_b64.append(s.split(",", 1)[1] if "," in s else s)

        if llm_model == LLM_MODEL_OPENAI:
            if not OPENAI_AVAILABLE:
                raise ImportError("openai package not installed. Run: pip install openai")
            async_client = _openai_module.AsyncOpenAI(api_key=_os.environ.get("OPENAI_API_KEY"))
            user_content: list = [{"type": "text", "text": user_prompt}]
            for data_uri in raw_data_uris:
                user_content.append({"type": "image_url", "image_url": {"url": data_uri}})
            messages: list = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": user_content if raw_data_uris else user_prompt})
            stream = await async_client.chat.completions.create(
                model=LLM_MODEL_VERSIONS[LLM_MODEL_OPENAI],
                messages=messages,
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta

        elif llm_model == LLM_MODEL_ANTHROPIC:
            if not ANTHROPIC_AVAILABLE:
                raise ImportError("anthropic package not installed. Run: pip install anthropic")
            async_client = _anthropic_module.AsyncAnthropic(api_key=_os.environ.get("ANTHROPIC_API_KEY"))
            anthropic_content: list = []
            for b64_data in clean_b64:
                anthropic_content.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/png", "data": b64_data},
                })
            anthropic_content.append({"type": "text", "text": user_prompt})
            async with async_client.messages.stream(
                model=LLM_MODEL_VERSIONS[LLM_MODEL_ANTHROPIC],
                max_tokens=4096,
                system=system_prompt,
                messages=[{"role": "user", "content": anthropic_content}],
            ) as stream:
                async for text in stream.text_stream:
                    yield text

        else:  # Google Gemini (default)
            if not GOOGLE_GENAI_AVAILABLE:
                raise ImportError("google-genai package not installed. Run: pip install google-genai")
            if not self.gemini_client:
                self.gemini_client = genai.Client()
            from google.genai import types as _gtypes
            model_to_use = LLM_MODEL_VERSIONS.get(llm_model, "gemini-2.5-flash")
            config = _gtypes.GenerateContentConfig(system_instruction=system_prompt) if system_prompt else None
            if clean_b64:
                gemini_parts = [_gtypes.Part.from_text(text=user_prompt)]
                for b64_data in clean_b64:
                    image_bytes = base64.b64decode(b64_data)
                    gemini_parts.append(_gtypes.Part.from_bytes(data=image_bytes, mime_type="image/png"))
                gemini_contents = [_gtypes.Content(role="user", parts=gemini_parts)]
            else:
                gemini_contents = user_prompt
            response_stream = await self.gemini_client.aio.models.generate_content_stream(
                model=model_to_use,
                contents=gemini_contents,
                **({"config": config} if config else {}),
            )
            async for chunk in response_stream:
                if chunk.text:
                    yield chunk.text

    def _parse_prompt_and_name(self, text: str) -> dict:
        """Parse structured PROMPT: ... NAME: ... SPL: ... INTERVAL: ... DURATION: ... ENTITY: ... format into dict

        Args:
            text: Raw text that may contain PROMPT:, NAME:, SPL:, INTERVAL:, DURATION:, and ENTITY: markers

        Returns:
            dict: {"prompt": str, "display_name": str, "spl_db": float, "interval_seconds": float, "duration_seconds": float, "entity_indices": list[int]} or None if parsing fails
        """
        # Try to parse PROMPT: ... NAME: ... SPL: ... INTERVAL: ... DURATION: ... ENTITY: ... format
        _SOUND_FIELD = r'(?:PROMPT|NAME|SPL|INTERVAL|DURATION|ENTITY)'
        prompt_match = re.search(rf'PROMPT:\s*(.*?)(?=\s*{_SOUND_FIELD}:|$)', text, re.DOTALL)
        name_match = re.search(rf'NAME:\s*(.*?)(?=\s*{_SOUND_FIELD}:|$)', text, re.DOTALL | re.MULTILINE)
        spl_match = re.search(r'SPL:\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
        interval_match = re.search(r'INTERVAL:\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
        duration_match = re.search(r'DURATION:\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
        entity_match = re.search(r'ENTITY:\s*([\d,\s]+|NONE|none|None)', text, re.IGNORECASE)

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

            # Extract entity indices (1-based from LLM, convert to 0-based)
            entity_indices = []
            if entity_match:
                entity_str = entity_match.group(1).strip()
                if entity_str.lower() != 'none':
                    for part in re.split(r'[,\s]+', entity_str):
                        part = part.strip()
                        if part:
                            try:
                                # LLM returns 1-based index, convert to 0-based
                                entity_indices.append(int(part) - 1)
                            except ValueError:
                                pass

            return {
                "prompt": sound_prompt,
                "display_name": display_name,
                "spl_db": spl_db,
                "interval_seconds": interval_seconds,
                "duration_seconds": duration_seconds,
                "entity_indices": entity_indices
            }

        return None

    async def select_diverse_entities(self, entities: list, max_sounds: int, entity_type: str = "objects", llm_model: str = DEFAULT_LLM_MODEL) -> list:
        """Select most diverse entities using LLM
        
        Supports both traditional entities and Speckle objects.
        Speckle objects use 'speckle_type' instead of 'type'.
        """
        if len(entities) <= max_sounds:
            return entities

        print(f"Selecting {max_sounds} most diverse {entity_type} from {len(entities)} total...")

        entity_summaries = []
        for i, entity in enumerate(entities):
            # Support both traditional 'type' and Speckle 'speckle_type'
            entity_type_name = entity.get('speckle_type') or entity.get('type', 'Unknown')
            summary = f"{i}. {entity_type_name}"
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
            response_text = str(await self._call_llm(diversity_prompt, operation_name="Entity selection", llm_model=llm_model)).strip()

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
            # Support both traditional 'type' and Speckle 'speckle_type'
            entity_descriptions = []
            for i, entity in enumerate(entities):
                entity_type_name = entity.get('speckle_type') or entity.get('type', 'object')
                desc = f"{i+1}. {entity_type_name}"
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
ENTITY: [comma-separated entity numbers (e.g., 1 or 1,3) if this sound is linked to those entities, or NONE if it's a non-entity context sound]
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

    async def generate_prompts_for_entities(self, entities: list[dict], num_sounds: int, context: str = None, llm_model: str = DEFAULT_LLM_MODEL) -> list[dict]:
        """Generate sound prompts mixing entity-based and context-based sounds

        Args:
            entities: List of entity dictionaries from 3D model
            num_sounds: Total number of sounds to generate (can be more or less than len(entities))
            context: Optional context description

        Returns:
            list[dict]: List of {"prompt": str, "display_name": str, "spl_db": float, "interval_seconds": float, "duration_seconds": float, "entity_indices": list[int]}
        """
        if num_sounds <= 0:
            return []

        llm_prompt = self._create_base_sound_prompt(context or "", num_sounds, entities)

        try:
            response_text = str(await self._call_llm(llm_prompt, operation_name="Sound prompt generation", llm_model=llm_model)).strip()

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
                            "entity_indices": []  # Fallback case: no entity linkage
                        })

            return sound_list

        except Exception as e:
            print(f"Error generating prompts for entities: {e}")
            raise

    async def generate_text_based_prompts(self, context: str, num_sounds: int, llm_model: str = DEFAULT_LLM_MODEL) -> tuple[str, list[dict]]:
        """Generate sound prompts with display names from text description only

        Returns:
            tuple: (raw_text, list of {"prompt": str, "display_name": str, "spl_db": float, "interval_seconds": float, "duration_seconds": float, "entity_indices": []})
        """
        # Use unified base prompt (no entities)
        enhanced_prompt = self._create_base_sound_prompt(context, num_sounds, entities=None)

        raw_text: str = str(await self._call_llm(enhanced_prompt, operation_name="Text-based prompt generation", llm_model=llm_model))

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
                        "entity_indices": []  # Text-based prompts have no entity linkage
                    })

        return raw_text, sound_list

    async def stream_generate_text_based_prompts(
        self, context: str, num_sounds: int, llm_model: str = DEFAULT_LLM_MODEL
    ):
        """Async generator yielding sound dicts one by one as they are parsed from the live LLM stream.

        Yields:
            dict: same shape as generate_text_based_prompts result items
        """
        enhanced_prompt = self._create_base_sound_prompt(context, num_sounds, entities=None)
        _ENTRY_START = re.compile(r'\n\s*\d+[\.\)]\s+')
        buffer = ""
        async for chunk in self._stream_llm_chunks(
            enhanced_prompt, operation_name="Text-based prompt streaming", llm_model=llm_model
        ):
            buffer += chunk
            while True:
                match = _ENTRY_START.search(buffer, 1)
                if not match:
                    break
                completed = buffer[: match.start()]
                buffer = buffer[match.start():]
                entry_clean = re.sub(r'^\s*\d+[\.\)]\s*', '', completed.strip())
                if entry_clean:
                    parsed = self._parse_prompt_and_name(entry_clean)
                    if parsed:
                        yield parsed
        # Yield trailing entry
        if buffer.strip():
            entry_clean = re.sub(r'^\s*\d+[\.\)]\s*', '', buffer.strip())
            if entry_clean:
                parsed = self._parse_prompt_and_name(entry_clean)
                if parsed:
                    yield parsed

    async def stream_generate_prompts_for_entities(
        self, entities: list[dict], num_sounds: int, context: str | None = None, llm_model: str = DEFAULT_LLM_MODEL
    ):
        """Async generator yielding sound dicts one by one as they are parsed from the live LLM stream.

        Yields:
            dict: same shape as generate_prompts_for_entities result items
        """
        llm_prompt = self._create_base_sound_prompt(context or "", num_sounds, entities)
        _ENTRY_START = re.compile(r'\n\s*\d+[\.\)]\s+')
        buffer = ""
        async for chunk in self._stream_llm_chunks(
            llm_prompt, operation_name="Entity prompt streaming", llm_model=llm_model
        ):
            buffer += chunk
            while True:
                match = _ENTRY_START.search(buffer, 1)
                if not match:
                    break
                completed = buffer[: match.start()]
                buffer = buffer[match.start():]
                entry_clean = re.sub(r'^\s*\d+[\.\)]\s*', '', completed.strip())
                if entry_clean:
                    parsed = self._parse_prompt_and_name(entry_clean)
                    if parsed:
                        yield parsed
        # Yield trailing entry
        if buffer.strip():
            entry_clean = re.sub(r'^\s*\d+[\.\)]\s*', '', buffer.strip())
            if entry_clean:
                parsed = self._parse_prompt_and_name(entry_clean)
                if parsed:
                    yield parsed

    def _parse_architecture_object(self, text: str) -> dict | None:
        """Parse a NAME:/DESCRIPTION:/MATERIAL:/CONFIDENCE:/QUANTITY:/IDS: block.

        Returns:
            dict with keys name, description, material, confidence, quantity, object_ids
            or None if NAME: is missing.
        """
        _FIELD = r'(?:NAME|DESCRIPTION|MATERIAL|CONFIDENCE|QUANTITY|IDS)'
        name_match = re.search(rf'NAME:\s*(.*?)(?=\s*{_FIELD}:|$)', text, re.DOTALL | re.IGNORECASE)
        if not name_match:
            return None

        desc_match = re.search(rf'DESCRIPTION:\s*(.*?)(?=\s*{_FIELD}:|$)', text, re.DOTALL | re.IGNORECASE)
        mat_match = re.search(rf'MATERIAL:\s*(.*?)(?=\s*{_FIELD}:|$)', text, re.DOTALL | re.IGNORECASE)
        conf_match = re.search(r'CONFIDENCE:\s*(\d+(?:\.\d+)?)', text, re.IGNORECASE)
        qty_match = re.search(r'QUANTITY:\s*(\d+)', text, re.IGNORECASE)
        ids_match = re.search(r'IDS:\s*(.+?)$', text, re.DOTALL | re.IGNORECASE)

        name = name_match.group(1).strip()
        description = desc_match.group(1).strip() if desc_match else ''
        material = mat_match.group(1).strip() if mat_match else ''
        if re.search(rf'{_FIELD}:', material, re.IGNORECASE):
            material = ''

        confidence = 0.0
        if conf_match:
            try:
                confidence = max(0.0, min(1.0, float(conf_match.group(1))))
            except ValueError:
                pass

        quantity = 1
        if qty_match:
            try:
                quantity = int(qty_match.group(1))
            except ValueError:
                pass

        object_ids: list[str] = []
        if ids_match:
            raw = ids_match.group(1).strip()
            # Strip outer backtick/bracket code-span wrapping from the whole value
            raw = re.sub(r'^[`\[]+|[`\]]+$', '', raw).strip()
            tokens: list[str] = []
            for tok in re.split(r'[,\n]+', raw):
                # Strip all formatting chars from each token boundary
                tok = re.sub(r'^[`\'"*\[\]\s]+|[`\'"*\[\]\s]+$', '', tok)
                if not tok:
                    continue
                # Keep only tokens that look like a Speckle ID (hex ≥20 chars)
                # or a plain/bracket integer (handled later by _resolve_object_ids)
                if re.fullmatch(r'[0-9a-fA-F]{20,}', tok) or re.fullmatch(r'\d+', tok):
                    tokens.append(tok)
            object_ids = tokens

        return {
            'name': name,
            'description': description,
            'material': material,
            'confidence': confidence,
            'quantity': quantity,
            'object_ids': object_ids,
        }

    def _resolve_object_ids(self, object_ids: list[str], entities: list[dict]) -> list[str]:
        """Replace simple numeric IDs with actual Speckle IDs from the entities list.

        The LLM sometimes outputs bracket indices (e.g. '1', '[3]') instead of
        the actual Speckle ID string. This fallback maps those back using the
        1-based index that _prepare_entities embeds in the prompt ("[i+1] SPECKLE_ID=...").
        """
        if not entities:
            return object_ids

        # Build 1-indexed lookup: 1-based position → actual speckle id
        index_to_id: dict[int, str] = {}
        for i, entity in enumerate(entities):
            entity_id = entity.get("id") or entity.get("nodeId") or f"obj-{i}"
            index_to_id[i + 1] = str(entity_id)

        resolved: list[str] = []
        for oid in object_ids:
            # Strip surrounding brackets if present: [42] → 42
            stripped = oid.strip().lstrip('[').rstrip(']').strip()
            if stripped.isdigit():
                idx = int(stripped)
                resolved.append(index_to_id.get(idx, oid))
            else:
                resolved.append(oid)
        return resolved

    @staticmethod
    def _build_entity_bbox_map(entities: list[dict]) -> dict[str, dict]:
        """Build speckle_id → {"min_bounds": [x,y,z], "max_bounds": [x,y,z]} from entity bbox data."""
        result: dict[str, dict] = {}
        for e in entities:
            eid = str(e.get("id") or e.get("nodeId") or "")
            if not eid:
                continue
            bbox = e.get("bbox") or {}
            mn = bbox.get("min") or {}
            mx = bbox.get("max") or {}
            if not mn or not mx:
                continue
            result[eid] = {
                "min_bounds": [
                    round(float(mn.get("x") or mn.get("X") or 0), 3),
                    round(float(mn.get("y") or mn.get("Y") or 0), 3),
                    round(float(mn.get("z") or mn.get("Z") or 0), 3),
                ],
                "max_bounds": [
                    round(float(mx.get("x") or mx.get("X") or 0), 3),
                    round(float(mx.get("y") or mx.get("Y") or 0), 3),
                    round(float(mx.get("z") or mx.get("Z") or 0), 3),
                ],
            }
        return result

    def _resolve_and_build_object_ids(
        self,
        raw_ids: list[str],
        entities: list[dict],
        bbox_map: dict[str, dict],
    ) -> dict[str, dict]:
        """Resolve raw LLM IDs (possibly bracket indices) → dict with per-ID bounds.

        Returns:
            object_ids_dict = {hex_id: {"min_bounds": [x,y,z], "max_bounds": [x,y,z]}}
        """
        resolved = self._resolve_object_ids(raw_ids, entities)

        object_ids_dict: dict[str, dict] = {}
        for oid in resolved:
            bounds = bbox_map.get(oid)
            object_ids_dict[oid] = bounds if bounds else {}

        return object_ids_dict

    @staticmethod
    def _normalize_object_refs(text: str) -> str:
        """Normalize object ID references in parentheses to the (id:hexid) format.

        Handles:
        - ``(e03387f2...)``                         → ``(id:e03387f2...)``
        - ``(id:aaa... to bbb...)``                 → ``(id:aaa...) to (id:bbb...)``
        - ``(aaa... to bbb...)``                    → ``(id:aaa...) to (id:bbb...)``
        - ``(aaa..., bbb..., ccc...)``              → ``(id:aaa..., id:bbb..., id:ccc...)``
        """
        HEX = r'[0-9a-f]{24,64}'
        # Expand range with id: prefix on the first ID: (id:HEX to HEX)
        text = re.sub(
            rf'\(id:({HEX})\s+to\s+({HEX})\)',
            r'(id:\1) to (id:\2)',
            text,
        )
        # Expand bare hex range: (HEX to HEX)
        text = re.sub(
            rf'\(({HEX})\s+to\s+({HEX})\)',
            r'(id:\1) to (id:\2)',
            text,
        )
        # Normalise all bare hex IDs inside parentheses to id:hexid format.
        # Handles singles, comma-separated lists, and mixed (id:HEX, HEX, HEX).
        def _prefix_bare_ids(m: re.Match) -> str:
            inner = m.group(1)
            inner = re.sub(r'(?<!\bid:)(' + HEX + ')', r'id:\1', inner)
            return '(' + inner + ')'
        text = re.sub(r'\(([^)]+)\)', _prefix_bare_ids, text)
        return text

    # ── Private prompt/entity helpers (source of truth) ──────────────────────

    def _prepare_entities(self, entities: list[dict]) -> tuple[list[dict], str]:
        """Filter internal collections and build the entity metadata text block.

        This is the single source of truth for entity filtering and formatting.
        Both analyze_3dmodel and stream_analyze_3dmodel delegate here.

        Returns:
            (filtered_entities, entities_text)
        """
        _EXCLUDED = frozenset({"soundscape", "acoustics"})

        def _segments(text: str) -> set[str]:
            """Split a hierarchical path into lowercase non-empty segments."""
            return {p.strip() for p in re.split(r'[::/\\|]+', text) if p.strip()}

        def _is_excluded(e: dict) -> bool:
            name = (e.get("name") or "").lower().strip()
            # Exact name match (e.g. a layer node that was itself captured as an entity)
            if name in _EXCLUDED:
                return True
            # Layer path check — covers the entity's own layer and all ancestors
            # e.g. "Acoustics", "Acoustics::SubGroup", "Soundscape::SoundSources"
            raw_layer = (e.get("raw") or {}).get("layer") or ""
            layer = ((e.get("layer") or "") or raw_layer).lower()
            if _segments(layer) & _EXCLUDED:
                return True
            return False

        # Build applicationId -> material name from RenderMaterialProxy objects.
        # Speckle v3 schema stores the RenderMaterial under raw.value; older schemas
        # used raw.material or raw.renderMaterial. The objects list (application IDs)
        # may appear as "objects" or "@objects" (detached-array notation).
        material_map: dict[str, str] = {}
        for e in entities:
            type_str = e.get("speckle_type") or e.get("type") or ""
            if "RenderMaterialProxy" not in type_str:
                continue
            raw_proxy = e.get("raw") or {}
            nested_mat = (
                raw_proxy.get("value")
                or raw_proxy.get("material")
                or raw_proxy.get("renderMaterial")
                or {}
            )
            if isinstance(nested_mat, str):
                nested_mat_name = nested_mat
            else:
                nested_mat_name = (nested_mat or {}).get("name") or ""
            mat_name = raw_proxy.get("name") or nested_mat_name or ""
            if mat_name.lower() in ("rendermaterialproxy", "object", ""):
                mat_name = nested_mat_name
            objects_list = raw_proxy.get("objects") or raw_proxy.get("@objects") or []
            for app_id in objects_list:
                if app_id and mat_name:
                    material_map[str(app_id)] = mat_name

        # The proxy objects list contains Layer Collection applicationIds, not
        # individual mesh IDs. Build a secondary layer_name -> material map by
        # finding the Collection entities that own those applicationIds.
        layer_material_map: dict[str, str] = {}
        for e in entities:
            raw_e = e.get("raw") or {}
            aid = str(raw_e.get("applicationId") or "")
            if aid in material_map:
                layer_name = (e.get("name") or raw_e.get("name") or "").strip()
                if layer_name:
                    layer_material_map[layer_name] = material_map[aid]

        # Keep only Mesh geometry; all other types (Collections, Proxies, etc.) are
        # structural/relational and not meaningful for the LLM analysis.
        def _is_mesh(e: dict) -> bool:
            type_str = e.get("speckle_type") or e.get("type") or ""
            return "Mesh" in type_str

        filtered = [e for e in entities if not _is_excluded(e) and _is_mesh(e)]

        def _fmt_pt(pt: dict) -> str:
            x = round(float(pt.get("x") or pt.get("X") or 0), 2)
            y = round(float(pt.get("y") or pt.get("Y") or 0), 2)
            z = round(float(pt.get("z") or pt.get("Z") or 0), 2)
            return f"[{x}, {y}, {z}]"

        def _bbox_str(entity: dict) -> str:
            # Prefer the entity-level bbox passed from the viewer's renderView.aabb
            # (raw.bbox is always null — Speckle stores it as an unresolved reference)
            bbox = entity.get("bbox") or {}
            if not isinstance(bbox, dict):
                return ""
            mn = bbox.get("min") or {}
            mx = bbox.get("max") or {}
            if not isinstance(mn, dict) or not isinstance(mx, dict) or not mn or not mx:
                return ""
            return f"{_fmt_pt(mn)} to {_fmt_pt(mx)}"

        lines: list[str] = []
        for i, entity in enumerate(filtered):
            entity_id = entity.get("id") or entity.get("nodeId") or f"obj-{i}"
            name = entity.get("name", "")
            raw = entity.get("raw") or {}
            layer = entity.get("layer") or raw.get("layer") or ""

            # Material: try direct applicationId match first, then layer name
            app_id = str(raw.get("applicationId") or "")
            material = (
                material_map.get(app_id)
                or layer_material_map.get(layer)
                or entity.get("material")
                or ""
            )

            position = _bbox_str(entity)

            line = f"[{i + 1}] SPECKLE_ID={entity_id}"
            if layer:
                line += f" | Layer={layer}"
            if name:
                line += f" | Name={name}"
            if material:
                line += f" | Material={material}"
            if position:
                line += f" | Position={position}"

            lines.append(line)
        return filtered, "\n".join(lines)

    def _build_analyze_3dmodel_prompts(
        self,
        entities: list[dict],
        entities_text: str,
        screenshots: list[str] | None,
        user_context: str | None,
    ) -> tuple[str, str]:
        """Canonical system + user prompts for 3D model analysis.

        Single source of truth used by both analyze_3dmodel and stream_analyze_3dmodel.
        """
        context_note = f'\nContext: "{user_context}"' if user_context else ""
        screenshot_note = (
            "A preview image of the model is also provided — use it alongside the metadata. The preview image contains "
            "a position grid in meters. Correlate it with the objects'bouding boxes to improve the identification when needed.\n"
            if screenshots
            else "No visual screenshots available; rely on metadata only.\n"
        )
        system_prompt = (
            "You are an expert 3D model analyzer specializing in architecture and interior design. "
            "Identify and group objects/furniture from entity metadata and optional screenshots. "
            "When scoring confidence, weight it by: name clarity (primary), material presence and specificity (secondary), "
            "layer context (tertiary). A clearly named object with a known material scores higher than one with neither. "
            "Never include 3D modelling primitives (e.g.: Brep, Mesh, Line, Curve, ...); focus on real-world object description."
        )
        user_prompt = (
            f"Analyze this 3D architectural model and group objects by type/function.\n"
            f"{screenshot_note}{context_note}\n"
            f"Do NOT include 3D modelling related objects (e.g.: Brep, Mesh, Line, Curve, ...), "
            f"focus on real-world object identification and description.\n"
            f"For EACH identified group, output ONE numbered entry using EXACTLY this format:\n\n"
            f"1. NAME: [standardized object name]\n"
            f"DESCRIPTION: [brief functional description]\n"
            f"MATERIAL: [finishing material, e.g. polished wood, plaster, rough concrete — focus on material, not color]\n"
            f"CONFIDENCE: [score 0.0-1.0]\n"
            f"QUANTITY: [integer count]\n"
            f"IDS: [raw hex IDs only, comma-separated — e.g. b30f783e4ae80e8331c0c5377c2a9dab, 9f1c2e…]\n\n"
            f"Rules:\n"
            f"- Group similar objects together depending on their function (e.g. desk chair and conference chair → Chairs).\n"
            f"- Separate high-confidence objects (>0.7) from uncertain ones (<0.7).\n"
            f"- IDS must contain ONLY the raw hex SPECKLE_ID strings — no backticks, no code formatting, no quotes, no brackets, no extra text.\n"
            f"- Do NOT put any section headers, labels, or comments inside an IDS field.\n"
            f"- Output ONLY the numbered list.\n\n"
            f"Each entity line includes 'Position=[min] to [max]' — the 3D bounding box in metres. "
            f"Use this to understand the spatial layout of the room (which objects are near each other, "
            f"their height, footprint, etc.).\n\n"
            f"Model contains {len(entities)} objects:\n{entities_text}"
        )
        return system_prompt, user_prompt

    def _build_scenarist_prompts(
        self,
        user_context: str | None,
        furniture_context: str,
        duration: int,
        scenario_parameters: list[list[int]],
    ) -> tuple[str, str]:
        """Build system and user prompts for the scenarist agent.

        Single source of truth used by both scenarist_agent and stream_scenarist_agent.
        """
        duration_mmss = f"{duration // 60}:{duration % 60:02d}"
        context_note = (
            f'\nAdditional context about this space: "{user_context}"'
            if user_context
            else ""
        )
        system_prompt = (
            "You are a creative scenarist specializing in architectural space usage. "
            "Create realistic, detailed scenarios showing how people interact with "
            "furniture and objects in architectural spaces. First think potential usages "
            "of the space, then derive a scenario from this usage. Include natural "
            "human behaviors, movements, and object interactions with precise timestamps. "
            "Each object in the architectural space information includes an 'object_ids' dict "
            "with bounding box data — use it to understand spatial layout and ground the "
            "scenario on realistic paths (proximity, group effects, ...)."
        )
        user_prompt = (
            "Create detailed usage scenarios for this space based on input parameters "
            "(see below): typology of the space, number of people using the space, "
            "the likeliness / plausibility of the usage scenario and the list of "
            "furniture of this space. Make scenarios realistic and varied "
            "(e.g., meeting, focused work, casual conversation). "
            "The scenarios have to be rooted to the usage enabled by the architectural "
            "space through: affordances of furniture_list, what is realistic to happen "
            "in the dimension of the space total_bounds, etc. "
            "You don't have to use all the objects, prioritize scenario credibility.\n\n"
            "Input definition:\n"
            "- number of people: Tune the scenario to the number of people. "
            "E.g.: if 2 people > conversation, 0 people > imagine the inherent "
            "soundscape of the space, 20 people > gathering or event\n"
            "- likeliness (1 to 10): 10 = realistic and expected use of the space "
            "(e.g.: an office space > corporate meeting, client presentation, ...), "
            "1 = imagine alternative uses of the space (be creative) that still match "
            "the typology and furniture affordances "
            "(e.g.: a classroom > fire alarm situation, student arguing, ...\n\n"
            "For each scenario, provide:\n"
            "- title: descriptive scenario name\n"
            "- duration: \"MM:SS\" format\n"
            "- peopleCount: number of people (from input)\n"
            "- likeliness: plausibility of the scenario (from input)\n"
            "- events: array of timestamped events (each 5-30 seconds)\n"
            "  - timestamp: \"MM:SS-MM:SS\" format\n"
            "  - description: detailed action description with references to "
            "objects as object.name (ids:ALL hex keys from that object's object_ids, comma-separated)\n"
            f"Now create {len(scenario_parameters)} scenario(s) of approximately "
            f"{duration_mmss} approximately ({duration} seconds) each.\n"
            f"Scenario(s) requested (number of people, likeliness): {scenario_parameters}\n"
            f"{context_note}\n"
            f"Architectural space information:\n{furniture_context}"
        )
        return system_prompt, user_prompt

    def _build_foley_prompts(
        self,
        scenarios_json: str,
        furniture_json: str,
        maximum_number_of_sounds: int,
        total_bounds: dict | None = None,
    ) -> tuple[str, str]:
        """Build system and user prompts for the foley artist.

        Single source of truth used by both foley_artist and async_foley_artist.
        """
        system_prompt = (
            "You are an expert foley artist specializing in architectural soundscapes. "
            "Create comprehensive, realistic sound event lists for interior spaces, and "
            "orchestrate it on a timeline in a realistic way, to match as close as possible the scenario. "
            "Consider material properties (wood, metal, fabric), human actions (walking, "
            "sitting, handling objects), ambient sounds (HVAC, outside noise), and speech "
            "patterns. Be specific about sound characteristics. "
            "DO NOT include room acoustics characteristics (reverberant, echo, ...). "
            "Each object in the architectural space information includes an 'object_ids' dict "
            "with bounding box data — use it to derive accurate spatial positions "
            "for sounds linked to those objects, and as reference when estimating positions "
            "for unlinked sounds (speech, footsteps, ambient)."
        )
        user_prompt = (
            f"Convert this scenario into detailed single sound events, background sounds, "
            f"and speech sounds (total maximum of {maximum_number_of_sounds} sounds).\n\n"
            "For each sound event, provide:\n"
            "- soundName: brief sound identifier\n"
            "- description: 1-sentence (5 to 10 words) description of the sound using simple descriptive "
            "words (e.g., 'A wooden door closing firmly'), based on the context and on the "
            "related objectsInvolved description and material properties from the "
            "architectural space information. Do NOT include scenario character names.\n"
            "- duration: duration of the sound in 'MM:SS' format\n"
            "- timestamps: starting positions of the sound in 'MM:SS' format (can be "
            "multiple and irregular); Be realistic in the orchestration: single events "
            "should happen at random moments to be realistic, background sounds, if "
            "continuous, should happen at a single timestamp. 0:00 \n"
            "- category: 'background sound' | 'sound event' | 'speech'\n"
            "- objectsInvolved: if the source of the sound is an object, copy the related "
            "hex ID keys from the object_ids dict in the architectural space information. "
            "If the sound is not linked "
            "to an object (e.g. speech, background hum), leave as an empty list.\n"
            "- position: if objectsInvolved is empty, provide a plausible [x, y, z] "
            "position for the sound within the room given the bounding box dimensions "
            "and the min_bounds/max_bounds of nearby objects in the architectural space information "
            "(e.g., speech at mouth height → z=1.50). Leave as an empty list when "
            "objectsInvolved is not empty — the frontend derives position from the linked objects.\n"
            "- spl: estimate a decibel level (Sound Pressure Level) at 1 metre "
            "(e.g., '65 dB').\n\n"
            "Include all realistic sounds: footsteps, object interactions, ambient sounds, "
            "speech, etc. Root your foley work in relation to the overall architecture, "
            "object materials, and the mood described by the scenario. "
            "Do not include room acoustic effects (e.g., reverberant, resonant). "
            "Sound events can have varied durations and can be repeated multiple times "
            "in the soundtrack. NOT every sound needs to be correlated with an object. "
            "You do NOT have to output the maximum number of sounds, create only the sounds "
            "necessary to render a plausible soundtrack for the scenario. "
            "Have at the end a critical look on the overall orchestration of the sounds and "
            "their timestamps to create a believable soundtrack of the input scenario, "
            "as if it was a movie.\n\n"
            f"Scenarios:\n{scenarios_json}\n\n"
            f"Room bounding box: {total_bounds}\n\n"
            f"Architectural space information:\n{furniture_json}"
        )
        return system_prompt, user_prompt

    async def stream_analyze_3dmodel(
        self,
        entities: list[dict],
        screenshots: list[str] | None = None,
        user_context: str | None = None,
        llm_model: str = DEFAULT_LLM_MODEL,
    ):
        """Async generator yielding architectural object dicts one by one as the LLM streams.

        Each yielded dict matches ArchitecturalObject shape:
            name, description, material, confidence, quantity, object_ids
        """
        entities, entities_text = self._prepare_entities(entities)
        print(f"[stream_analyze_3dmodel] {len(entities)} entities after filtering:\n{entities_text}", flush=True)

        if not entities:
            return

        bbox_map = self._build_entity_bbox_map(entities)
        system_prompt, user_prompt = self._build_analyze_3dmodel_prompts(
            entities, entities_text, screenshots, user_context
        )

        _ENTRY_START = re.compile(r'\n\s*\d+[\.\)]\s+')
        buffer = ""
        async for chunk in self._stream_llm_chunks(
            user_prompt, system_prompt,
            screenshots=screenshots,
            operation_name="Model analysis streaming",
            llm_model=llm_model,
        ):
            buffer += chunk
            while True:
                match = _ENTRY_START.search(buffer, 1)
                if not match:
                    break
                completed = buffer[: match.start()]
                buffer = buffer[match.start():]
                entry_clean = re.sub(r'^\s*\d+[\.\)]\s*', '', completed.strip())
                if entry_clean:
                    parsed = self._parse_architecture_object(entry_clean)
                    if parsed:
                        parsed['object_ids'] = self._resolve_and_build_object_ids(
                            parsed['object_ids'], entities, bbox_map
                        )
                        yield parsed
        # Yield trailing entry
        if buffer.strip():
            entry_clean = re.sub(r'^\s*\d+[\.\)]\s*', '', buffer.strip())
            if entry_clean:
                parsed = self._parse_architecture_object(entry_clean)
                if parsed:
                    parsed['object_ids'] = self._resolve_and_build_object_ids(
                        parsed['object_ids'], entities, bbox_map
                    )
                    yield parsed

    # ── 3D Model Analysis ─────────────────────────────────────────────────────

    def analyze_3dmodel(
        self,
        entities: list[dict],
        screenshots: list[str] | None = None,
        user_context: str | None = None,
        llm_model: str = DEFAULT_LLM_MODEL,
    ) -> dict:
        """
        Identify architectural objects from 3D model entity metadata and optional
        screenshots.

        Args:
            entities:     Speckle entity dicts (id, name, speckle_type, layer,
                          material, bounds, …)
            screenshots:  Optional list of base64 PNG data URIs (max 3). If None
                          or empty, analysis runs on metadata only.
            user_context: Optional free-text context (e.g. "open-plan office")
            llm_model:    Provider key ("gemini-2.5-flash", "openai", "anthropic")

        Returns:
            dict with an "objects" key — list of raw dicts matching ModelObjectResult fields.
        """
        entities, entities_text = self._prepare_entities(entities)
        print(f"[analyze_3dmodel] {len(entities)} entities after filtering:\n{entities_text}", flush=True)

        if not entities:
            return {"objects": []}

        system_prompt, user_prompt = self._build_analyze_3dmodel_prompts(
            entities, entities_text, screenshots, user_context
        )

        # ── Retry with exponential back-off ───────────────────────────────────
        from models.schemas import ModelAnalysisOutput

        result = asyncio.run(self._call_llm(  # type: ignore[return-value]
            user_prompt, system_prompt,
            response_schema=ModelAnalysisOutput,
            screenshots=screenshots,
            operation_name="Model analysis",
            llm_model=llm_model,
        ))
        # Resolve any numeric bracket indices the LLM may have used instead of Speckle IDs
        # and build per-entity bounds dict.
        if isinstance(result, dict):
            bbox_map = self._build_entity_bbox_map(entities)
            for obj in [o for o in (result.get("objects") or []) if isinstance(o, dict)]:
                if "object_ids" in obj and isinstance(obj["object_ids"], list):
                    obj["object_ids"] = self._resolve_and_build_object_ids(
                        obj["object_ids"], entities, bbox_map
                    )
        return result  # type: ignore[return-value]

    # ── Scenario Generation ───────────────────────────────────────────────────

    def scenarist_agent(
        self,
        user_context: str | None = None,
        llm_model: str = DEFAULT_LLM_MODEL,
        furniture_list: dict | None = None,
        duration: int = 150,
        scenario_parameters: list[list[int]] | None = None,
    ) -> dict:
        """
        Generate detailed usage scenarios for an architectural space using an LLM.

        Args:
            user_context:         Optional free-text description of the space
                                  (e.g. "open-plan office with kitchen corner").
            llm_model:            Provider key ("gemini", "openai", "anthropic").
            furniture_list:       JSON result from analyze_3dmodel / save_results_json
                                  containing architectural_objects and meta (optional).
            duration:             Approximate duration of each scenario in seconds
                                  (default: 150).
            scenario_parameters:  List of [number_of_people, likeliness] pairs,
                                  one per scenario to generate
                                  (default: [[5, 9], [1, 9]]).

        Returns:
            dict with a "scenarios" key — list of scenario dicts, each containing:
            title, duration, peopleCount, likeliness, events, objectsInvolved.
        """
        if scenario_parameters is None:
            scenario_parameters = [[5, 9], [100, 1], [0, 9]]

        furniture_context = json.dumps(furniture_list, indent=2) if furniture_list else "{}"
        system_prompt, user_prompt = self._build_scenarist_prompts(
            user_context, furniture_context, duration, scenario_parameters
        )

        # ── Retry with exponential back-off ───────────────────────────────────
        from models.schemas import ScenarioResponse

        result = asyncio.run(self._call_llm(  # type: ignore[return-value]
            user_prompt, system_prompt,
            response_schema=ScenarioResponse,
            operation_name="Scenarist",
            llm_model=llm_model,
        ))
        # Normalise bare hex IDs in event descriptions
        if isinstance(result, dict):
            for _sc in result.get("scenarios") or []:
                for _ev in _sc.get("events") or []:
                    if isinstance(_ev.get("description"), str):
                        _ev["description"] = self._normalize_object_refs(_ev["description"])
        return result

    async def stream_scenarist_agent(
        self,
        user_context: str | None = None,
        llm_model: str = DEFAULT_LLM_MODEL,
        furniture_list: dict | None = None,
        duration: int = 150,
        people_count: int = 5,
        likeliness: int = 9,
    ):
        """Async generator yielding formatted scenario events one by one.

        Replaces raw text chunk streaming with direct structured output.

        Yields:
            {"type": "scenario", "scenario_index": int, "title": str, "duration": str,
             "peopleCount": int, "likeliness": int}  — one per scenario header
            {"type": "event", "scenario_index": int, "event": {"timestamp": str, "description": str}}
            {"type": "error", "message": str}         — on LLM failure
            {"type": "done", "result": dict, "scenario_id": str}
        """
        from models.schemas import ScenarioResponse as _ScenarioResponse

        scenario_parameters = [[people_count, likeliness]]
        furniture_context = json.dumps(furniture_list, indent=2) if furniture_list else "{}"
        system_prompt, user_prompt = self._build_scenarist_prompts(
            user_context, furniture_context, duration, scenario_parameters
        )

        import uuid as _uuid
        scenario_id = str(_uuid.uuid4())

        # ── Single structured LLM call ────────────────────────────────────────
        try:
            result = await self._call_llm(
                user_prompt, system_prompt,
                response_schema=_ScenarioResponse,
                operation_name="Scenarist",
                llm_model=llm_model,
            )
            if not isinstance(result, dict):
                result = result.model_dump() if hasattr(result, "model_dump") else dict(result)
            # Normalise bare hex IDs in event descriptions
            for _sc in result.get("scenarios") or []:
                for _ev in _sc.get("events") or []:
                    if isinstance(_ev.get("description"), str):
                        _ev["description"] = self._normalize_object_refs(_ev["description"])
        except Exception as e:
            print(f"[stream_scenarist_agent] LLM call failed: {e}")
            yield {"type": "error", "message": str(e)}
            result = {"scenarios": [], "found": False}

        # ── Save to disk ──────────────────────────────────────────────────────
        from config.constants import TEMP_ANALYSIS_DIR as _TEMP_ANALYSIS_DIR
        import pathlib as _pathlib
        try:
            analysis_dir = _pathlib.Path(_TEMP_ANALYSIS_DIR)
            analysis_dir.mkdir(parents=True, exist_ok=True)
            out_file = analysis_dir / f"scenarios_{scenario_id}.json"
            tmp_file = out_file.with_suffix(".tmp")
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump({"scenario_id": scenario_id, **result}, f, indent=2)
            tmp_file.replace(out_file)
        except Exception as save_err:
            print(f"[stream_scenarist_agent] failed to save result: {save_err}")

        # ── Stream structured results one by one ──────────────────────────────
        for i, scenario in enumerate(result.get("scenarios", [])):
            await asyncio.sleep(0)  # allow SSE to flush
            yield {
                "type": "scenario",
                "scenario_index": i,
                "title": scenario.get("title", ""),
                "duration": scenario.get("duration", ""),
                "peopleCount": scenario.get("peopleCount", 0),
                "likeliness": scenario.get("likeliness", 0),
            }
            for event in scenario.get("events", []):
                await asyncio.sleep(0)
                yield {"type": "event", "scenario_index": i, "event": event}

        yield {"type": "done", "result": result, "scenario_id": scenario_id}

    # ── Foley Artist ──────────────────────────────────────────────────────────

    def foley_artist(
        self,
        scenarist_agent_result: dict,
        furniture_list: dict | None = None,
        scenario_ids: list[int] | None = None,
        maximum_number_of_sounds: int = 20,
        llm_model: str = DEFAULT_LLM_MODEL,
    ) -> dict:
        """
        Generate detailed foley sound events for scenarios from scenarist_agent.

        Args:
            scenarist_agent_result:   JSON output from scenarist_agent() containing
                                      a "scenarios" list.
            furniture_list:           3D model analysis result from analyze_3dmodel /
                                      save_results_json, containing architectural_objects
                                      and meta (optional).
            scenario_ids:             Indices (0-based) of scenarios to process from
                                      scenarist_agent_result. If None, all scenarios
                                      are processed.
            maximum_number_of_sounds: Maximum total number of sound events to create
                                      across all selected scenarios (default: 20).
            llm_model:                Provider key ("gemini", "openai", "anthropic").

        Returns:
            dict with a "sound_events" key — list of sound event dicts, each containing:
            soundName, description, duration, timestamps, category, objectsInvolved,
            position, spl.
        """
        # ── Filter scenarios ──────────────────────────────────────────────────
        all_scenarios = scenarist_agent_result.get("scenarios", [])
        if scenario_ids is not None:
            selected_scenarios = [
                all_scenarios[i] for i in scenario_ids if 0 <= i < len(all_scenarios)
            ]
        else:
            selected_scenarios = all_scenarios

        if not selected_scenarios:
            return {"sound_events": []}

        # ── Serialize inputs ──────────────────────────────────────────────────
        scenarios_json = json.dumps({"scenarios": selected_scenarios}, indent=2)
        furniture_json = json.dumps(furniture_list, indent=2) if furniture_list else "{}"
        total_bounds = (furniture_list or {}).get("meta", {}).get("total_bounds")
        system_prompt, user_prompt = self._build_foley_prompts(
            scenarios_json, furniture_json, maximum_number_of_sounds, total_bounds
        )

        # ── Call LLM with structured output ───────────────────────────────────
        from models.schemas import FoleyResponse

        return asyncio.run(self._call_llm(  # type: ignore[return-value]
            user_prompt, system_prompt,
            response_schema=FoleyResponse,
            operation_name="Foley artist",
            llm_model=llm_model,
        ))

    async def async_foley_artist(
        self,
        scenarist_agent_result: dict,
        furniture_list: dict | None = None,
        maximum_number_of_sounds: int = 20,
        llm_model: str = DEFAULT_LLM_MODEL,
    ) -> dict:
        """Async version of foley_artist — awaits _call_llm directly.

        Identical logic to foley_artist but avoids asyncio.run() so it can be
        called safely from within an async FastAPI endpoint.
        """
        from models.schemas import FoleyResponse as _FoleyResponse

        all_scenarios = scenarist_agent_result.get("scenarios", [])
        if not all_scenarios:
            return _FoleyResponse(scenarios=[]).model_dump()

        scenarios_json = json.dumps({"scenarios": all_scenarios}, indent=2)
        furniture_json = json.dumps(furniture_list, indent=2) if furniture_list else "{}"
        total_bounds = (furniture_list or {}).get("meta", {}).get("total_bounds")
        system_prompt, user_prompt = self._build_foley_prompts(
            scenarios_json, furniture_json, maximum_number_of_sounds, total_bounds
        )

        result = await self._call_llm(
            user_prompt, system_prompt,
            response_schema=_FoleyResponse,
            operation_name="Foley artist (async)",
            llm_model=llm_model,
        )
        if not isinstance(result, dict):
            result = result.model_dump() if hasattr(result, "model_dump") else dict(result)
        return result

    async def stream_foley_artist(
        self,
        scenarist_agent_result: dict,
        furniture_list: dict | None = None,
        maximum_number_of_sounds: int = 20,
        llm_model: str = DEFAULT_LLM_MODEL,
    ):
        """Async generator yielding foley sound events one by one.

        Makes the full structured LLM call, saves the result, then yields sounds
        progressively so the frontend can display them as they arrive.

        Yields:
            {"type": "sound", "scenario_title": str, "scenario_index": int, "sound": dict}
            {"type": "error", "message": str}
            {"type": "done", "result": dict, "foley_id": str}
        """
        try:
            result = await self.async_foley_artist(
                scenarist_agent_result=scenarist_agent_result,
                furniture_list=furniture_list,
                maximum_number_of_sounds=maximum_number_of_sounds,
                llm_model=llm_model,
            )
        except Exception as e:
            yield {"type": "error", "message": str(e)}
            return

        # ── Save to disk ──────────────────────────────────────────────────────
        import uuid as _uuid
        foley_id = str(_uuid.uuid4())
        from config.constants import TEMP_ANALYSIS_DIR as _TEMP_ANALYSIS_DIR
        import pathlib as _pathlib
        try:
            analysis_dir = _pathlib.Path(_TEMP_ANALYSIS_DIR)
            analysis_dir.mkdir(parents=True, exist_ok=True)
            out_file = analysis_dir / f"foley_{foley_id}.json"
            tmp_file = out_file.with_suffix(".tmp")
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump({"foley_id": foley_id, **result}, f, indent=2)
            tmp_file.replace(out_file)
        except Exception as save_err:
            print(f"[stream_foley_artist] failed to save result: {save_err}")

        # ── Stream sounds one by one ──────────────────────────────────────────
        for si, scenario in enumerate(result.get("scenarios", [])):
            for sound in scenario.get("sound_events", []):
                await asyncio.sleep(0)  # allow SSE to flush
                yield {
                    "type": "sound",
                    "scenario_title": scenario.get("scenario_title", ""),
                    "scenario_index": si,
                    "sound": sound,
                }

        yield {"type": "done", "result": result, "foley_id": foley_id}
