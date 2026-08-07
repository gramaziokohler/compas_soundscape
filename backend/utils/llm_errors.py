# backend/utils/llm_errors.py
# Stateless helpers for converting raw LLM provider errors into clean
# user-facing messages before they reach the frontend.

_QUOTA_MARKERS = (
    "429",
    "quota",
    "RESOURCE_EXHAUSTED",
    "RateLimitError",
)
_BUSY_MARKERS = (
    "503",
    "UNAVAILABLE",
    "overloaded",
    "request timed out",
    "temporarily unavailable",
    "ServerError",
)


def llm_error_message(exc: Exception) -> str:
    """Map a raw LLM provider exception to a clean, human-readable message.

    Handles google.genai ServerError/ClientError, openai/anthropic errors, and
    generic network failures. Unknown errors keep their raw text so no detail
    is lost.
    """
    error_str = str(exc)
    error_lower = error_str.lower()
    type_name = type(exc).__name__

    if any(m in error_str for m in ("429", "RESOURCE_EXHAUSTED")) or any(
        m in error_lower for m in ("quota", "ratelimiterror")
    ) or type_name == "RateLimitError":
        return "AI API quota exhausted. Please try again later."

    if any(m in error_str for m in ("503", "UNAVAILABLE", "ServerError")) or any(
        m in error_lower for m in ("overloaded", "request timed out", "temporarily unavailable")
    ):
        return "The AI service is busy or timed out. Please try again."

    return f"AI request failed: {error_str}"
