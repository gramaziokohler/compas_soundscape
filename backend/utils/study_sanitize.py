"""Make arbitrary payloads safe to store in the study log.

Turns any value into plain JSON (dict / list / str / number / bool / None):
``data:`` URLs (base64 screenshots) and over-long strings become
``"<omitted, N chars>"``, deep nesting and long lists are cut, Pydantic models
are dumped, and anything else becomes ``"<TypeName>"``. Never raises.
"""

from typing import Any

from config.constants import STUDY_MAX_FIELD_CHARS, STUDY_MAX_LIST_ITEMS, STUDY_MAX_PAYLOAD_DEPTH


def _omitted(text: str) -> str:
    return f"<omitted, {len(text)} chars>"


def sanitize_payload(value: Any, _depth: int = 0) -> Any:
    """Return a JSON-safe, size-bounded copy of ``value``."""
    try:
        if value is None or isinstance(value, (bool, int, float)):
            return value
        if isinstance(value, str):
            if value.startswith("data:") or len(value) > STUDY_MAX_FIELD_CHARS:
                return _omitted(value)
            return value
        if isinstance(value, bytes):
            return f"<bytes, {len(value)} bytes>"
        if _depth >= STUDY_MAX_PAYLOAD_DEPTH:
            return f"<{type(value).__name__}, depth limit>"
        model_dump = getattr(value, "model_dump", None)
        if callable(model_dump):
            return sanitize_payload(model_dump(mode="json"), _depth + 1)
        if isinstance(value, dict):
            return {str(k): sanitize_payload(v, _depth + 1) for k, v in value.items()}
        if isinstance(value, (list, tuple, set)):
            items = list(value)
            out = [sanitize_payload(v, _depth + 1) for v in items[:STUDY_MAX_LIST_ITEMS]]
            if len(items) > STUDY_MAX_LIST_ITEMS:
                out.append(f"<{len(items) - STUDY_MAX_LIST_ITEMS} more items>")
            return out
        return f"<{type(value).__name__}>"
    except Exception:  # noqa: BLE001 - sanitizing must never fail the caller
        return "<unserializable>"
