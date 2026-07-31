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
    DEFAULT_DBFS,
    LLM_SUGGESTED_INTERVAL_SECONDS,
    DEFAULT_DURATION_SECONDS,
    DBFS_MIN,
    DBFS_MAX,
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
        temperature: float | None = None,
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
                        openai_kwargs = {"model": LLM_MODEL_VERSIONS[LLM_MODEL_OPENAI], "messages": messages, "response_format": rf}
                        if temperature is not None:
                            openai_kwargs["temperature"] = temperature
                        if streaming:
                            accumulated = ""
                            async with async_client.chat.completions.stream(**openai_kwargs) as stream:
                                async for event in stream:
                                    if event.type == "content.delta":
                                        print(event.delta, end="", flush=True)
                                        accumulated += event.delta
                            print(flush=True)
                            return json.loads(accumulated)
                        else:
                            resp = await async_client.chat.completions.create(**openai_kwargs)
                            return json.loads(resp.choices[0].message.content)
                    else:
                        openai_kwargs = {"model": LLM_MODEL_VERSIONS[LLM_MODEL_OPENAI], "messages": messages}
                        if temperature is not None:
                            openai_kwargs["temperature"] = temperature
                        if streaming:
                            accumulated = ""
                            stream = await async_client.chat.completions.create(**openai_kwargs, stream=True)
                            async for chunk in stream:
                                delta = chunk.choices[0].delta.content
                                if delta:
                                    print(delta, end="", flush=True)
                                    accumulated += delta
                            print(flush=True)
                            return accumulated
                        else:
                            resp = await async_client.chat.completions.create(**openai_kwargs)
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
                        anthropic_kwargs = {
                            "model": LLM_MODEL_VERSIONS[LLM_MODEL_ANTHROPIC],
                            "max_tokens": 4096,
                            "system": system_prompt,
                            "tools": [tool],
                            "tool_choice": {"type": "tool", "name": "output"},
                            "messages": [{"role": "user", "content": content_blocks}],
                        }
                        if temperature is not None:
                            anthropic_kwargs["temperature"] = temperature
                        if streaming:
                            async with async_client.messages.stream(**anthropic_kwargs) as stream:
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
                            resp = await async_client.messages.create(**anthropic_kwargs)
                            for block in resp.content:
                                if block.type == "tool_use" and block.name == "output":
                                    return block.input
                            raise ValueError("Anthropic response did not contain expected tool_use block")
                    else:
                        anthropic_kwargs = {
                            "model": LLM_MODEL_VERSIONS[LLM_MODEL_ANTHROPIC],
                            "max_tokens": 4096,
                            "system": system_prompt,
                            "messages": [{"role": "user", "content": content_blocks}],
                        }
                        if temperature is not None:
                            anthropic_kwargs["temperature"] = temperature
                        if streaming:
                            accumulated = ""
                            async with async_client.messages.stream(**anthropic_kwargs) as stream:
                                async for text in stream.text_stream:
                                    print(text, end="", flush=True)
                                    accumulated += text
                            print(flush=True)
                            return accumulated
                        else:
                            resp = await async_client.messages.create(**anthropic_kwargs)
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
                        gemini_config = _gtypes.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_json_schema=schema_dict,
                            system_instruction=system_prompt,
                        )
                        if temperature is not None:
                            gemini_config.temperature = temperature
                        if streaming:
                            accumulated = ""
                            response_stream = await self.gemini_client.aio.models.generate_content_stream(
                                model=model_to_use,
                                contents=[_gtypes.Content(role="user", parts=parts)],
                                config=gemini_config,
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
                                config=gemini_config,
                            )
                            return json.loads(response.text or "{}")
                    else:
                        gemini_config = None
                        if system_prompt or temperature is not None:
                            gemini_config = _gtypes.GenerateContentConfig(
                                system_instruction=system_prompt,
                            ) if system_prompt else _gtypes.GenerateContentConfig()
                            if temperature is not None:
                                gemini_config.temperature = temperature
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
                                **({"config": gemini_config} if gemini_config else {}),
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
                                **({"config": gemini_config} if gemini_config else {}),
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
                    print(f"[FAIL] {operation_name} failed after {LLM_MAX_RETRIES} attempts")
                    raise

                wait_time = min(delay, LLM_MAX_RETRY_DELAY)
                if self.progress_callback:
                    self.progress_callback(
                        attempt=attempt,
                        max_attempts=LLM_MAX_RETRIES,
                        delay=wait_time,
                        error_msg=error_str,
                    )
                print(f"\n[RETRY] {operation_name} failed (attempt {attempt}/{LLM_MAX_RETRIES}): {type(e).__name__}: {error_str}")
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
            dict: {"prompt": str, "display_name": str, "dbfs": float, "interval_seconds": float, "duration_seconds": float, "entity_indices": list[int]} or None if parsing fails
        """
        # Try to parse PROMPT: ... NAME: ... SPL: ... INTERVAL: ... DURATION: ... ENTITY: ... format
        _SOUND_FIELD = r'(?:PROMPT|NAME|SPL|INTERVAL|DURATION|ENTITY)'
        prompt_match = re.search(rf'PROMPT:\s*(.*?)(?=\s*{_SOUND_FIELD}:|$)', text, re.DOTALL)
        name_match = re.search(rf'NAME:\s*(.*?)(?=\s*{_SOUND_FIELD}:|$)', text, re.DOTALL | re.MULTILINE)
        spl_match = re.search(r'SPL:\s*(-?\d+(?:\.\d+)?)', text, re.IGNORECASE)
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

            # Extract dBFS value
            dbfs = DEFAULT_DBFS
            if spl_match:
                try:
                    dbfs = float(spl_match.group(1))
                    # Clamp to reasonable range
                    dbfs = max(DBFS_MIN, min(DBFS_MAX, dbfs))
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
                "dbfs": dbfs,
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

For each sound, provide a 2 to 10 words sound prompt, a short 2-3 word display name, estimate a target loudness level in dBFS (decibels relative to digital full scale), estimate how often this sound would typically occur (in seconds), estimate the typical duration of the sound event (in seconds with 0.1 precision), AND indicate if it's linked to an entity.

Format your response as a numbered list with each sound using this EXACT format, without any extra text:
1. PROMPT: [your sound prompt here]
NAME: [your 2-3 word display name here]
SPL: [estimated dBFS value, e.g., -18]
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

For the loudness estimation (in dBFS):
    *   Consider how loud this sound should be IN THE MIX OF: {context}
    *   dBFS is relative to digital full scale: 0 dBFS is the clipping ceiling, so use NEGATIVE values.
    *   Reference examples: subtle background texture (-45 dBFS), quiet ambience (-36 dBFS), normal foreground sound (-24 dBFS), prominent sound event (-18 dBFS), loud impact (-12 dBFS), near-clipping foreground (-6 dBFS)
    *   Provide a single number between -60 and 0 dBFS representing the target playback level
    *   The level should fit realistically in the mix for: {context}

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
            list[dict]: List of {"prompt": str, "display_name": str, "dbfs": float, "interval_seconds": float, "duration_seconds": float, "entity_indices": list[int]}
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
                            "dbfs": DEFAULT_DBFS,
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
            tuple: (raw_text, list of {"prompt": str, "display_name": str, "dbfs": float, "interval_seconds": float, "duration_seconds": float, "entity_indices": []})
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
                        "dbfs": DEFAULT_DBFS,
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
        """Parse a NAME:/DESCRIPTION:/MATERIAL:/QUANTITY:/IDS: block.

        Returns:
            dict with keys name, description, material, quantity, object_ids
            or None if NAME: is missing.
        """
        _FIELD = r'(?:NAME|DESCRIPTION|MATERIAL|QUANTITY|IDS)'
        name_match = re.search(rf'NAME:\s*(.*?)(?=\s*{_FIELD}:|$)', text, re.DOTALL | re.IGNORECASE)
        if not name_match:
            return None

        desc_match = re.search(rf'DESCRIPTION:\s*(.*?)(?=\s*{_FIELD}:|$)', text, re.DOTALL | re.IGNORECASE)
        mat_match = re.search(rf'MATERIAL:\s*(.*?)(?=\s*{_FIELD}:|$)', text, re.DOTALL | re.IGNORECASE)
        qty_match = re.search(r'QUANTITY:\s*(\d+)', text, re.IGNORECASE)
        ids_match = re.search(r'IDS:\s*(.+?)$', text, re.DOTALL | re.IGNORECASE)

        name = name_match.group(1).strip()
        description = desc_match.group(1).strip() if desc_match else ''
        material = mat_match.group(1).strip() if mat_match else ''
        if re.search(rf'{_FIELD}:', material, re.IGNORECASE):
            material = ''

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
                # Strip any id: / ids: prefix the LLM may have hallucinated
                tok = re.sub(r'^(?:ids?:)?\s*(?:id:)?\s*', '', tok, count=1)
                # Keep only tokens that look like a Speckle ID (hex ≥20 chars)
                # or a plain/bracket integer (handled later by _resolve_object_ids)
                if re.fullmatch(r'[0-9a-fA-F]{20,}', tok) or re.fullmatch(r'\d+', tok):
                    tokens.append(tok)
            object_ids = tokens

        return {
            'name': name,
            'description': description,
            'material': material,
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
        # Normalize dot-separated object refs: ObjectName.hexid → ObjectName (id:hexid)
        text = re.sub(
            r'\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)\.(' + HEX + r')\b',
            r'\1 (id:\2)',
            text,
        )
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
        # Normalise all hex IDs inside parentheses to id:hexid format.
        # Handles singles, comma-separated lists, mixed (id:HEX, HEX, HEX),
        # and doubled prefixes the LLM sometimes produces (ids:id:HEX).
        def _prefix_bare_ids(m: re.Match) -> str:
            inner = m.group(1)
            # Skip parenthesized groups that contain no hex IDs
            # (e.g. descriptive qualifiers like "Chair (EmbruHassenpflug Style)")
            if not re.search(HEX, inner):
                return '(' + inner + ')'
            # Strip any arbitrary word prefix and normalize to id:HEX.
            # Handles: ids:HEX, ids:id:HEX, human_figures:HEX, human_figures:id:HEX, etc.
            inner = re.sub(r'\b\w+:\s*(?:id:\s*)?(' + HEX + ')', r'id:\1', inner)
            # Normalise any remaining bare hex to id:HEX.
            inner = re.sub(r'(?:id:\s*)?(' + HEX + ')', r'id:\1', inner)
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
            "A preview image of the model is also provided — use it alongside the metadata. "
            "The preview image contains a position grid in metres. Correlate it with the objects' "
            "bounding boxes to improve identification when needed.\n"
            if screenshots
            else "No visual screenshots available; rely on metadata only.\n"
        )
        system_prompt = (
            "You are an expert 3D model analyzer specializing in architecture and interior design. "
            "Identify and group objects/furniture from entity metadata and optional screenshots. "
            "Understand the architectural layout of the space. "
            "Never include 3D modelling primitives (e.g.: Brep, Mesh, Line, Curve, ...); "
            "focus on real-world object description."
        )
        user_prompt = (
            f"Analyze this 3D architectural model and group objects by type/function.\n"
            f"{screenshot_note}{context_note}\n"
            f"Each input entity line includes 'Position=[min] to [max]' — the 3D bounding box in metres. "
            f"Use this to understand the spatial layout of the room (which objects are near each other, "
            f"their height, footprint, etc.).\n\n"
            f"First, output at the beginning of the response:\n"
            f"SPACE: [description of the architectural typology and general layout of the space "
            f"(minimalist, a few sentences)]\n\n"
            f"Then, for EACH identified group, output ONE numbered entry using EXACTLY this format:\n\n"
            f"1. NAME: [standardized object name]\n"
            f"DESCRIPTION: [brief functional description]\n"
            f"MATERIAL: [finishing material, e.g. polished wood, plaster, rough concrete — focus on material, not color]\n"
            f"QUANTITY: [integer count]\n"
            f"IDS: [raw hex IDs only, comma-separated — e.g. b30f783e4ae80e8331c0c5377c2a9dab, 9f1c2e…]\n\n"
            f"Rules:\n"
            f"- Group similar objects together depending on their function (e.g. desk chair and conference chair → Chairs).\n"
            f"- IDS must contain ONLY the raw hex SPECKLE_ID strings — no backticks, no code formatting, no quotes, no brackets, no extra text.\n"
            f"- Do NOT put any section headers, labels, or comments inside an IDS field.\n"
            f"- Output ONLY the SPACE: line followed by the numbered list.\n\n"
            f"Model contains {len(entities)} objects:\n{entities_text}"
        )
        return system_prompt, user_prompt

    def _build_scenarist_prompts(
        self,
        user_context: str | None,
        furniture_context: str,
        duration: int,
        people_count: int,
        likeliness: int,
    ) -> tuple[str, str]:
        """Build system and user prompts for the scenarist agent.

        Always generates exactly 1 scenario.
        Single source of truth used by both scenarist_agent and stream_scenarist_agent.
        """
        duration_mmss = f"{duration // 60}:{duration % 60:02d}"
        context_note = (
            f'\n- Additional Context: "{user_context}"'
            if user_context
            else ""
        )
        system_prompt = (
            "You are an expert architectural scenarist and spatial behavioral psychologist. "
            "Your job is to simulate hyper-realistic human interactions within a 3D architectural space.\n\n"
            "You must anchor every human movement, gesture, and pathing decision strictly within the "
            "physical layout provided by the object bounding boxes.\n\n"
            "### Core Operational Directives\n"
            "1. Spatial Grounding: Do not allow humans to walk through objects. Account for proximity, "
            "clearance, sightlines, comfort, and group effects (e.g., people crowding around a table "
            "or leaving walking lanes open).\n"
            "2. The Likeliness Spectrum:\n"
            "   - High Likeliness (7–10): Simulate mundane, high-probability routines. Focus on "
            "micro-behaviors (fidgeting, checking phones, shifting weight).\n"
            "   - Low Likeliness (1–6): Introduce unexpected but physically possible human drama, "
            "emergencies, or alternative spatial uses (e.g., a flash mob, an intense argument, "
            "seeking cover from a storm, searching for a lost contact lens).\n"
            "3. Chain-of-Thought (CoT): Before generating the final output, think step-by-step about "
            "the spatial affordances, traffic flow, and emotional friction of the scenario."
        )
        user_prompt = (
            f"### Task\n"
            f"Generate exactly 1 detailed usage scenario based on the provided architectural space, "
            f"furniture list, and scenario parameters. The scenario must last approximately "
            f"{duration_mmss} ({duration} seconds).\n\n"
            f"### Input Parameters\n"
            f"- People Count: {people_count}\n"
            f"- Likeliness (1–10): {likeliness}\n"
            f"- Space Typology & Bounds: {furniture_context}"
            f"{context_note}\n\n"
            f"### Constraints & Rules\n"
            f"1. Object Referencing: When an object is interacted with, you MUST reference it exactly "
            f"as `object.name (ids: HEX_KEY_1, HEX_KEY_2)`. Use multiple hex keys if associated with "
            f"multiple objects.\n"
            f"2. Timeline Continuity: The `events` array must be sequential. Timestamps cannot overlap, "
            f"and there must be no gaps between events. Each event block must span between 5 to 30 seconds.\n"
            f"3. Scale to People Count:\n"
            f"   - 0 People: Focus on environmental changes (sunlight shifting, a robotic vacuum, "
            f"wind through a window, ambient soundscape echoes).\n"
            f"   - 1–2 People: Focus on intimate, detailed micro-interactions and psychological "
            f"tension/comfort.\n"
            f"   - Large Groups: Focus on spatial crowding, bottlenecks, and split-group dynamics.\n\n"
            f"### Step-by-Step Generation Process\n"
            f"Follow these steps inside your thinking process:\n"
            f"1. Spatial Analysis: Identify the primary paths, seating capacities, and dead zones "
            f"based on the bounding boxes.\n"
            f"2. Affordance Mapping: Which objects invite specific actions based on the likeliness score?\n"
            f"3. Narrative Arc: Draft a realistic sequence of human behaviors matching the required duration.\n\n"
            f"### Expected Output Format\n"
            f"Respond ONLY in the following JSON format structure "
            f"(do not include markdown wrapper text other than the json block):\n\n"
            f"[{{\n"
            f'  "title": "Descriptive and evocative scenario name",\n'
            f'  "duration": "{duration_mmss}",\n'
            f'  "peopleCount": {people_count},\n'
            f'  "likeliness": {likeliness},\n'
            f'  "events": [\n'
            f'    {{\n'
            f'      "timestamp": "MM:SS-MM:SS",\n'
            f'      "description": "Detailed behavioral description referencing objects as '
            f'object.name (ids: hex1, hex2)."\n'
            f'    }}\n'
            f'  ]\n'
            f"}}]"
        )
        return system_prompt, user_prompt

    def _build_foley_prompts(
        self,
        scenarios_json: str,
        furniture_json: str,
    ) -> tuple[str, str]:
        """Build system and user prompts for the foley artist agent.

        Single source of truth used by both foley_artist and async_foley_artist.
        Outputs a flat, globally-deduplicated list of sound types — no scenario grouping.
        Each entry carries either linked object IDs or a guessed spatial position.
        """
        system_prompt = (
            "You are an expert foley artist specializing in architectural soundscapes. "
            "Create comprehensive, realistic sound event lists for interior spaces, and "
            "orchestrate them on a timeline in a realistic way to match the scenario as closely as possible. "
            "Consider material properties (wood, metal, fabric) and human actions (walking, sitting, "
            "handling objects), ambient sounds (HVAC, outside noise). "
            "Be specific about sound characteristics. "
            "DO NOT include room acoustics characteristics (reverberant, echo, ...). "
            "DO NOT include speech or conversations (handled by another agent). "
            "Use the object bounding boxes from the architectural space information to derive accurate "
            "spatial positions for sounds linked to objects, and as spatial reference when estimating "
            "positions for unlinked sounds (footsteps, ambient, etc.)."
        )
        user_prompt = (
            "Your task is to extract all physical, material, and ambient actions that can produce a sound "
            "from the narrative scenario and group them into similar sound types.\n\n"
            "1. Example sonic actions to extract: footsteps, object placements, mechanical chair adjustments, "
            "door movements, glass handlings, ambient background tones, HVAC sound.\n"
            "2. STRICT GLOBAL DEDUPLICATION: You must group all actions of a similar audio category into a "
            "single object entry, even if they happen multiple times in the script. "
            'E.g.: "walking on the carpet", "footsteps on the floor", "John walks past the door" '
            '→ 1 sound: "footsteps".\n'
            '3. It is STRICTLY FORBIDDEN to append personal names, character roles, or scene numbers to the '
            '"soundName" or "id" fields (e.g., "laptop_placement_sarah" or "footsteps_michael" are WRONG).\n'
            '4. The "description" must focus on a SINGLE generic instance of that acoustic profile, optimized '
            "for a Text-to-Audio (TTA) generation model. Do not use plural nouns "
            '(e.g., use "An office chair" instead of "Multiple chairs").\n'
            '5. The "objectsInvolved" array must collect ALL the target object hex IDs from the spatial context '
            "that execute this specific sound type across the entire story timeline. "
            "Order them chronologically as they appear in the text.\n"
            "6. Spatial positioning — for EVERY entry, populate exactly ONE of these two fields:\n"
            '   - "objectsInvolved": non-empty hex ID list → set "position" to an empty list []. '
            "The position will be derived from the linked objects by the audio engine.\n"
            '   - "position": when objectsInvolved is empty (e.g. footsteps, ambient hum, HVAC), '
            "provide a plausible [x, y, z] centroid within the room using the bounding box and nearby object "
            "bounds as reference. Ambient/background sounds should be placed at the room centroid.\n"
            "7. Always add at least one background sound that matches the space.\n\n"
            "Output Format — respond ONLY with a JSON array:\n"
            "[\n"
            "  {\n"
            '    "id": "string (ordered snake_case identifier starting with \\"sound\\", '
            'e.g., sound_01, sound_02)",\n'
            '    "soundName": "string (brief generic descriptive name of the sound profile)",\n'
            '    "description": "1-sentence (5 to 10 words) description of the sound. '
            'Do NOT include scenario character names.",\n'
            '    "timestamps": ["MM:SS", ...],\n'
            '    "objectsInvolved": ["hex IDs chronologically, or empty list []"],\n'
            '    "position": [x, y, z or empty list []]\n'
            "  }\n"
            "]\n\n"
            f"Scenarios:\n{scenarios_json}\n\n"
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

        Yields:
            {"type": "space_description", "text": str}  — once, at the start
            {"type": "object", **ArchitecturalObject}    — one per identified group

        Each object dict matches ArchitecturalObject shape:
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
        _SPACE_LINE = re.compile(r'\bSPACE\s*:\s*(.+?)(?:\n|$)', re.IGNORECASE)
        buffer = ""
        space_yielded = False
        async for chunk in self._stream_llm_chunks(
            user_prompt, system_prompt,
            screenshots=screenshots,
            operation_name="Model analysis streaming",
            llm_model=llm_model,
        ):
            buffer += chunk
            if not space_yielded:
                space_match = _SPACE_LINE.search(buffer)
                if space_match:
                    space_text = space_match.group(1).strip()
                    if space_text:
                        yield {"type": "space_description", "text": space_text}
                    space_yielded = True
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
                        yield {"type": "object", **parsed}
        # Yield trailing entry
        if buffer.strip():
            entry_clean = re.sub(r'^\s*\d+[\.\)]\s*', '', buffer.strip())
            if entry_clean:
                parsed = self._parse_architecture_object(entry_clean)
                if parsed:
                    parsed['object_ids'] = self._resolve_and_build_object_ids(
                        parsed['object_ids'], entities, bbox_map
                    )
                    yield {"type": "object", **parsed}

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
        people_count: int = 5,
        likeliness: int = 9,
    ) -> dict:
        """
        Generate a single usage scenario for an architectural space using an LLM.

        Args:
            user_context:  Optional free-text description of the space
                           (e.g. "open-plan office with kitchen corner").
            llm_model:     Provider key ("gemini", "openai", "anthropic").
            furniture_list: JSON result from analyze_3dmodel / save_results_json
                            containing architectural_objects and meta (optional).
            duration:      Approximate duration of the scenario in seconds (default: 150).
            people_count:  Number of people in the scenario (default: 5).
            likeliness:    Likeliness score 1–10 (default: 9).

        Returns:
            dict with a "scenarios" key — list containing 1 scenario dict with:
            title, duration, peopleCount, likeliness, events.
        """
        furniture_context = json.dumps(furniture_list, indent=2) if furniture_list else "{}"
        system_prompt, user_prompt = self._build_scenarist_prompts(
            user_context, furniture_context, duration, people_count, likeliness
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

        furniture_context = json.dumps(furniture_list, indent=2) if furniture_list else "{}"
        system_prompt, user_prompt = self._build_scenarist_prompts(
            user_context, furniture_context, duration, people_count, likeliness
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
            return {"sounds": []}

        # ── Serialize inputs ──────────────────────────────────────────────────
        scenarios_json = json.dumps({"scenarios": selected_scenarios}, indent=2)
        furniture_json = json.dumps(furniture_list, indent=2) if furniture_list else "{}"
        system_prompt, user_prompt = self._build_foley_prompts(
            scenarios_json, furniture_json
        )

        # ── Call LLM with structured output ───────────────────────────────────
        from models.schemas import FoleyOutput

        return asyncio.run(self._call_llm(  # type: ignore[return-value]
            user_prompt, system_prompt,
            response_schema=FoleyOutput,
            operation_name="Foley artist",
            llm_model=llm_model,
        ))

    async def async_foley_artist(
        self,
        scenarist_agent_result: dict,
        furniture_list: dict | None = None,
        maximum_number_of_sounds: int = 20,  # kept for API backwards-compat; not used in prompt
        llm_model: str = DEFAULT_LLM_MODEL,
    ) -> dict:
        """Async version of foley_artist — awaits _call_llm directly.

        Identical logic to foley_artist but avoids asyncio.run() so it can be
        called safely from within an async FastAPI endpoint.
        """
        from models.schemas import FoleyOutput as _FoleyOutput

        all_scenarios = scenarist_agent_result.get("scenarios", [])
        if not all_scenarios:
            return _FoleyOutput(sounds=[]).model_dump()

        scenarios_json = json.dumps({"scenarios": all_scenarios}, indent=2)
        furniture_json = json.dumps(furniture_list, indent=2) if furniture_list else "{}"
        system_prompt, user_prompt = self._build_foley_prompts(
            scenarios_json, furniture_json
        )

        result = await self._call_llm(
            user_prompt, system_prompt,
            response_schema=_FoleyOutput,
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
        for sound in result.get("sounds", []):
            await asyncio.sleep(0)  # allow SSE to flush
            yield {"type": "sound", "sound": sound}

        yield {"type": "done", "result": result, "foley_id": foley_id}

    # ── Speech Agent ──────────────────────────────────────────────────────────

    def _build_speech_prompts(
        self,
        scenarios_json: str,
        furniture_json: str = "{}"
    ) -> tuple[str, str]:
        """Build system and user prompts for the speech scripting agent.

        Single source of truth used by async_speech_agent and stream_speech_agent.
        Each speech entry includes a guessed [x,y,z] mouth-height position using
        the room bounding box and nearby furniture bounds.
        """
        system_prompt = (
            "You are an expert dialogue writer and narrative director. "
            "Your task is to analyze an architectural/spatial narrative scenario and extract "
            "or generate high-quality, creative, and contextually accurate spoken dialogue "
            "scripts for the characters involved. "
            "You also have access to the architectural space information to estimate where "
            "each character is speaking from within the room."
        )
        user_prompt = (
            "1. Identify all moments where a character speaks, greets, or when the narrative implies "
            "active conversation (e.g., 'the brainstorming intensifies', 'explaining an idea').\n"
            "2. Write full, natural, realistic dialogue lines for these moments. Do not summarize speech.\n"
            "3. Group all spoken lines belonging to a specific character into a single narrative block.\n"
            "4. Separate chronologically distinct spoken lines or speech events for that same character "
            "using a semicolon (;).\n"
            '5. Format the script text strictly as: "First dialogue line text; Second dialogue line text" '
            "(no character name prefix in the script field — the character field carries the name).\n"
            "6. Do not include any physical action descriptions, timing parameters, or formatting "
            "outside the requested JSON structure.\n"
            "7. Do not add spoken lines when not directly implied by the scenario script.\n"
            "8. Use real character names.\n"
            "9. Spatial position: for each character, estimate a plausible [x, y, z] position "
            "where the character is standing or sitting when they speak. Use the object bounding boxes "
            "and room bounds as reference. Speech height is typically z = 1.25 m (seated) to 1.60 m "
            "(standing). Use one position poer character."
            "Place the character near the object(s) they are interacting with in average.\n\n"
            "Output Format — respond ONLY with a JSON array:\n"
            "[\n"
            "  {\n"
            '    "id": "string (ordered snake_case identifier starting with \\"speech\\", '
            'e.g., speech_01, speech_02)",\n'
            '    "timestamps": ["MM:SS", ...],\n'
            '    "character": "string (name of the person speaking)",\n'
            '    "script": "string (dialogue lines separated chronologically by semicolons)",\n'
            '    "position": [x, y, z]\n'
            "  }\n"
            "]\n\n"
            "Example input scenario:\n"
            '"Alice walks into the conference room and says hello to Bob near the entrance door. '
            'Later, she stands at the projector screen and walks him through the third quarter drops."\n\n'
            "Example output:\n"
            "[\n"
            "  {\n"
            '    "id": "speech_01",\n'
            '    "timestamps": ["00:21", "00:45"],\n'
            '    "character": "Alice",\n'
            '    "script": "Morning Bob, good to see you!; If you look closely at July, '
            'that is exactly where our third quarter drops began to manifest.",\n'
            '    "position": [1.2, 0.8, 1.55]\n'
            "  }\n"
            "]\n\n"
            f"Architectural space information:\n{furniture_json}\n\n"
            f"Scenario:\n{scenarios_json}"
        )
        return system_prompt, user_prompt

    async def async_speech_agent(
        self,
        scenarist_agent_result: dict,
        furniture_list: dict | None = None,
        llm_model: str = DEFAULT_LLM_MODEL,
    ) -> dict:
        """Extract and generate spoken dialogue from scenario events.

        Args:
            scenarist_agent_result: Output from scenarist_agent / stream_scenarist_agent
                                    containing a "scenarios" list.
            furniture_list:         3D model analysis result used for spatial position
                                    guessing (optional but recommended).
            llm_model:              Provider key ("gemini", "openai", "anthropic").

        Returns:
            dict with a "speeches" key — list of speech entry dicts, each containing:
            id, timestamps, character, script, position.
        """
        from models.schemas import SpeechOutput as _SpeechOutput

        all_scenarios = scenarist_agent_result.get("scenarios", [])
        if not all_scenarios:
            return _SpeechOutput(speeches=[]).model_dump()

        scenarios_json = json.dumps({"scenarios": all_scenarios}, indent=2)
        furniture_json = json.dumps(furniture_list, indent=2) if furniture_list else "{}"
        system_prompt, user_prompt = self._build_speech_prompts(
            scenarios_json, furniture_json
        )

        result = await self._call_llm(
            user_prompt, system_prompt,
            response_schema=_SpeechOutput,
            operation_name="Speech agent",
            llm_model=llm_model,
        )
        if not isinstance(result, dict):
            result = result.model_dump() if hasattr(result, "model_dump") else dict(result)
        return result

    async def stream_speech_agent(
        self,
        scenarist_agent_result: dict,
        furniture_list: dict | None = None,
        llm_model: str = DEFAULT_LLM_MODEL,
    ):
        """Async generator yielding speech entries one by one.

        Yields:
            {"type": "speech", "speech": dict}
            {"type": "error", "message": str}
            {"type": "done", "result": dict, "speech_id": str}
        """
        try:
            result = await self.async_speech_agent(
                scenarist_agent_result=scenarist_agent_result,
                furniture_list=furniture_list,
                llm_model=llm_model,
            )
        except Exception as e:
            yield {"type": "error", "message": str(e)}
            return

        # ── Save to disk ──────────────────────────────────────────────────────
        import uuid as _uuid
        speech_id = str(_uuid.uuid4())
        from config.constants import TEMP_ANALYSIS_DIR as _TEMP_ANALYSIS_DIR
        import pathlib as _pathlib
        try:
            analysis_dir = _pathlib.Path(_TEMP_ANALYSIS_DIR)
            analysis_dir.mkdir(parents=True, exist_ok=True)
            out_file = analysis_dir / f"speech_{speech_id}.json"
            tmp_file = out_file.with_suffix(".tmp")
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump({"speech_id": speech_id, **result}, f, indent=2)
            tmp_file.replace(out_file)
        except Exception as save_err:
            print(f"[stream_speech_agent] failed to save result: {save_err}")

        # ── Stream entries one by one ─────────────────────────────────────────
        for entry in result.get("speeches", []):
            await asyncio.sleep(0)
            yield {"type": "speech", "speech": entry}

        yield {"type": "done", "result": result, "speech_id": speech_id}

    # ── Orchestrate Agent ─────────────────────────────────────────────────────

    def _build_orchestrate_prompts(
            self,
            scenarios_json: str,
            foley_json: str,
            speech_json: str,
        ) -> tuple[str, str]:
            """Build system and user prompts for the orchestrate agent.

            Single source of truth used by async_orchestrate_agent and stream_orchestrate_agent.
            Positions are already resolved by foley_agent and speech_agent — this agent only
            assembles timing, triggers, and variants; it copies positions from the input data.
            """
            system_prompt = (
                "You are a precision audio systems assembler and compiler. "
                "Your job is to take the scripts from the Speech Agent, the asset lists from the "
                "Foley Agent, and the original timeline narrative to compile the final parametric "
                "playlist JSON for a Web Audio engine. You must globally reflect on the soundtrack "
                "to ensure a cohesive audio experience: remove any duplicate sounds, decide how many variants "
                "each sound should have to sound realistic."
            )
            user_prompt = (
                "1. Merge the 'speech' entries alongside the foley assets 'sounds' into single unique "
                "IDs (e.g., sound_01, speech_01). Use the timestamps to locate them in the timeline and "
                "correlate them with the scenario script to understand sound dependencies.\n"
                "2. Every entry must map cleanly to structural relationships using parametric trigger "
                "formulas. DO NOT use absolute timestamps (e.g., '00:15') for individual events unless "
                "initializing an environment background loop or a primary scene arrival.\n"
                "3. Formulate triggers using these strict string expressions. 'expression' is ALWAYS an "
                "array, with exactly one string per timestamp in that entry's timestamps input. 'delay' is "
                "ALWAYS an array of floats, with exactly one float per timestamp, index-aligned with "
                "'expression':\n"
                '   - For absolute starting blocks: {"type": "absolute", "expression": ["00:15"], "delay": [0.0]} '
                "— every 'expression' element is the literal MM:SS timestamp for that occurrence. Never an "
                "empty string, and never a param formula.\n"
                '   - For sequential blocks: {"type": "param", "expression": ["after(id_of_previous_sound)", '
                '"after(id_of_another_sound)"], "delay": [0.2, 0.0]} — every \'expression\' element is a param '
                "formula string (after/alignEnd). Never a raw MM:SS timestamp.\n"
                '   - For leading pre-actions: {"type": "param", "expression": ["alignEnd(id_of_following_sound)"], '
                '"delay": [0.0]}\n'
                '   - For blocks where some occurrences anchor to a fixed point on the timeline and others anchor '
                "to another sound: \"type\": \"mixed\", where 'expression' freely combines, element by element, "
                "either a literal MM:SS timestamp OR a param formula string (after/alignEnd) — never both roles "
                'inside the same string. Example: {"type": "mixed", "expression": ["00:15", "after(sound_05__1)", '
                '"after(sound_05__2)"], "delay": [0.0, 0.0, 0.0]} — typical for a repeating background loop whose '
                "first occurrence starts at a fixed timeline point and whose later occurrences simply chain off "
                "the previous occurrence of that same sound.\n"
                "4. SINGLE INSTANCES ONLY WITH ITERATION ARRAYS: Do NOT split an asset into separate IDs per "
                "occurrence (NO sound_01_01, sound_01_02). Keep a single base entry (e.g., sound_01).\n"
                "5. Inside the param-formula elements of a 'param' or 'mixed' trigger expression, you can point to "
                "specific iterations of another sound when it has multiple timestamps by appending a double "
                "underscore and the iteration index (e.g., 'after(speech_02_1)', 'after(speech_02_2)', "
                "'alignEnd(sound_01_3)'). Double underscores are ONLY allowed inside param-formula strings — never "
                "inside an absolute MM:SS timestamp string.\n"
                "6. Strict Array Alignment: 'trigger.expression' and 'trigger.delay' MUST ALWAYS be arrays whose "
                "length exactly equals the number of timestamps for that entry (never a bare string, never a bare "
                "float, never a mismatched length). For multi-iteration entries, 'variants' and 'objectsInvolved' "
                "(if not empty) MUST also be arrays of that same exact length, for index correlation.\n"
                "7. Speech Description Integrity: For 'speech' category entries, 'description' is ALWAYS a "
                "single string — the complete, untouched 'script' value copied verbatim from the speech input, "
                "including all of its semicolon (';') separators. NEVER split it into an array, NEVER truncate it "
                "to a single segment, and NEVER drop any part of it — even when that entry's 'trigger.expression', "
                "'variants', etc. have multiple iterations.\n"
                "8. For each sound foley entry, estimate how many variants should be provided in the variants array "
                "to create a realistic effect depending on repetitions, and order them in a list (e.g [1,2,1])."
                "For speech, create a arithmetic series of variants corresponding to the length of timestamps [1,2,3,4,...]\n"
                "9. Position: copy the 'position' value directly from the input foley or speech entry. "
                "Do NOT recompute or modify positions — they were already resolved by the upstream agents.\n\n"
                "Output Format — respond ONLY with a JSON array:\n"
                "[\n"
                "  {\n"
                '    "id": "input base id (e.g., sound_01)",\n'
                '    "soundName": "string",\n'
                '    "description": "untouched from input",\n'
                '    "category": "\\"background sound\\" | \\"sound event\\" | \\"speech\\"",\n'
                '    "duration": "duration of the sound in MM:SS format, empty string if speech",\n'
                '    "trigger": { "type": "\\"absolute\\" | \\"param\\" | \\"mixed\\"", "expression": ["array of '
                "strings, one per input timestamp — MM:SS timestamps for 'absolute', param formulas for 'param', "
                'a free per-element mix of both for \'mixed\'"], "delay": ["array of floats, one per input '
                'timestamp, same length as expression"] },\n'
                '    "objectsInvolved": "untouched from input"],\n'
                '    "position": untouched from input,\n'
                '    "variants": [1,2,1],\n'
                '    "spl": "float as string, e.g. \\"-18 dBFS\\""\n'
                "  }\n"
                "]\n\n"
                f"Scenarios:\n{scenarios_json}\n\n"
                f"Foley sounds:\n{foley_json}\n\n"
                f"Speech:\n{speech_json}\n\n"
                "Before outputting the final JSON, verify silently against this checklist and fix"
                "any violation you find — only then output the JSON:\n\n"
                "- [ ] Every id appears as exactly one object in the array.\n"
                "- [ ] trigger.expression is always an array (never a bare string).\n"
                "- [ ] trigger.delay is always an array of floats (never a bare float).\n"
                "- [ ] len(trigger.expression) == len(trigger.delay) == len(variants) == number of timestamps for "
                "that id.\n"
                "- [ ] type \"absolute\" entries contain ONLY MM:SS timestamp strings in expression — no after( or "
                "alignEnd(.\n"
                "- [ ] type \"param\" entries contain ONLY after( / alignEnd( formula strings in expression — no "
                "raw MM:SS timestamps.\n"
                "- [ ] type \"mixed\" entries deliberately combine MM:SS timestamps and after( / alignEnd( "
                "formulas, with each element matching the correct occurrence by index.\n"
                "- [ ] objectsInvolved contains no after( or alignEnd( strings.\n"
                "- [ ] Every speech description is one untouched string with its semicolons intact.\n"
                "If any item fails, fix it and re-check before responding."
            )
            return system_prompt, user_prompt

    async def async_orchestrate_agent(
        self,
        scenarist_agent_result: dict,
        foley_result: dict,
        speech_result: dict,
        llm_model: str = DEFAULT_LLM_MODEL,
        temperature: float = 0.1,
    ) -> dict:
        """Compile the final parametric audio playlist from foley + speech + scenario.

        Positions are already resolved in the foley and speech results — this agent
        handles only timing, triggers, and variant counts.

        Args:
            scenarist_agent_result: Output from scenarist_agent containing "scenarios".
            foley_result:           Output from async_foley_artist containing "sounds".
            speech_result:          Output from async_speech_agent containing "speeches".
            llm_model:              Provider key ("gemini", "openai", "anthropic").
            temperature:            LLM sampling temperature (near 0 for deterministic output).

        Returns:
            dict with a "playlist" key — list of orchestrated sound entries each containing:
            id, soundName, description, category, duration, trigger, objectsInvolved,
            position, variants, spl.
        """
        from models.schemas import OrchestrateOutput as _OrchestrateOutput

        all_scenarios = scenarist_agent_result.get("scenarios", [])
        if not all_scenarios:
            return _OrchestrateOutput(playlist=[]).model_dump()

        scenarios_json = json.dumps({"scenarios": all_scenarios}, indent=2)
        foley_json = json.dumps(foley_result, indent=2)
        speech_json = json.dumps(speech_result, indent=2)

        system_prompt, user_prompt = self._build_orchestrate_prompts(
            scenarios_json, foley_json, speech_json
        )

        result = await self._call_llm(
            user_prompt, system_prompt,
            response_schema=_OrchestrateOutput,
            operation_name="Orchestrate agent",
            llm_model=llm_model,
            temperature=temperature,
        )
        if not isinstance(result, dict):
            result = result.model_dump() if hasattr(result, "model_dump") else dict(result)
        return result

    async def stream_orchestrate_agent(
        self,
        scenarist_agent_result: dict,
        foley_result: dict,
        speech_result: dict,
        llm_model: str = DEFAULT_LLM_MODEL,
        temperature: float = 0.1,
    ):
        """Async generator yielding orchestrated playlist entries one by one.

        Yields:
            {"type": "entry", "entry": dict}
            {"type": "error", "message": str}
            {"type": "done", "result": dict, "orchestrate_id": str}
        """
        try:
            result = await self.async_orchestrate_agent(
                scenarist_agent_result=scenarist_agent_result,
                foley_result=foley_result,
                speech_result=speech_result,
                llm_model=llm_model,
                temperature=temperature,
            )
        except Exception as e:
            yield {"type": "error", "message": str(e)}
            return

        # ── Save to disk ──────────────────────────────────────────────────────
        import uuid as _uuid
        orchestrate_id = str(_uuid.uuid4())
        from config.constants import TEMP_ANALYSIS_DIR as _TEMP_ANALYSIS_DIR
        import pathlib as _pathlib
        try:
            analysis_dir = _pathlib.Path(_TEMP_ANALYSIS_DIR)
            analysis_dir.mkdir(parents=True, exist_ok=True)
            out_file = analysis_dir / f"orchestrate_{orchestrate_id}.json"
            tmp_file = out_file.with_suffix(".tmp")
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump({"orchestrate_id": orchestrate_id, **result}, f, indent=2)
            tmp_file.replace(out_file)
        except Exception as save_err:
            print(f"[stream_orchestrate_agent] failed to save result: {save_err}")

        # ── Stream entries one by one ─────────────────────────────────────────
        for entry in result.get("playlist", []):
            await asyncio.sleep(0)
            yield {"type": "entry", "entry": entry}

        yield {"type": "done", "result": result, "orchestrate_id": orchestrate_id}
