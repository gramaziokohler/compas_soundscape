"""
Classify Gemini API quota errors (429 RESOURCE_EXHAUSTED).

google-genai raises ``google.genai.errors.APIError`` with ``.code`` and a
message holding the response's ``details`` list, e.g.
``429 RESOURCE_EXHAUSTED. {... 'quotaId': 'GenerateRequestsPerDayPerProjectPerModel',
... 'retryDelay': '23s' ...}``. Matching the text keeps this independent of
the SDK version.
"""
from __future__ import annotations

import re
from typing import Literal, Optional, Tuple

QuotaKind = Literal["daily", "minute", "other"]

_RETRY_DELAY_RE = re.compile(r"retryDelay\W+(\d+(?:\.\d+)?)s")


def classify_quota_error(exc: BaseException) -> Tuple[QuotaKind, Optional[float]]:
    """Return ("daily", None) for a per-day quota hit (retrying cannot help
    before the reset), ("minute", retry_delay_s or None) for a per-minute 429,
    and ("other", None) for anything else."""
    text = str(exc)
    if getattr(exc, "code", None) != 429 and "RESOURCE_EXHAUSTED" not in text:
        return "other", None
    if "PerDay" in text or "per_day" in text:
        return "daily", None
    match = _RETRY_DELAY_RE.search(text)
    return "minute", float(match.group(1)) if match else None
