"""
Free-text TTS language → Gemini 3.8 voice/language resolution.

Gemini 3.8 TTS only accepts a BCP-47 tag in ``speech_config.language`` and
speaks the language of the transcript; the dialect/accent comes from the voice.
This module turns what the user typed ("Swiss German", "Egyptian Arabic",
"de-AT", "Schweizerdeutsch") into a ``LanguageMatch``. Resolution order, first
hit wins:

1. ``custom``  — a custom (prompted) voice this user created under that name.
2. ``library`` — an exact accent of the live voice library ("Egyptian Arabic",
   "Glasgow English").
3. ``tag``     — Babel knows the name or the text is already a tag ("Swiss
   German" → ``gsw``). Upgraded to ``library`` when the voice library has
   native voices for that language (``German`` → ``de-DE``).
4. ``unknown`` — nothing matched; TTS falls back to auto-detect.

Pure functions: the voice-library dialects and the user's custom voices are
passed in, so this is testable without network or database.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from typing import Optional

from babel import Locale, localedata

from config.constants import (
    TTS_CLASSIC_VOICE_ACCENT,
    TTS_LANGUAGE_NAME_LOCALES,
    TTS_LANGUAGE_MATCH_CUSTOM,
    TTS_LANGUAGE_MATCH_LIBRARY,
    TTS_LANGUAGE_MATCH_TAG,
    TTS_LANGUAGE_MATCH_UNKNOWN,
)

_TAG_RE = re.compile(r"^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$")


@dataclass
class LanguageMatch:
    kind: str
    query: str
    label: str
    language_code: Optional[str] = None  # BCP-47, safe to send to Gemini
    accent: Optional[str] = None          # voice-library accent (library kind)
    voice_count: int = 0
    custom_voices: list[dict] = field(default_factory=list)

    @property
    def uses_classic_voices(self) -> bool:
        return self.kind != TTS_LANGUAGE_MATCH_LIBRARY or self.accent == TTS_CLASSIC_VOICE_ACCENT

    def to_dict(self) -> dict:
        return asdict(self)


def _norm(text: str) -> str:
    return " ".join(text.strip().lower().split())


def _to_bcp47(identifier: str) -> str:
    return identifier.replace("_", "-")


@lru_cache(maxsize=1)
def _babel_index() -> tuple[dict[str, str], dict[str, str]]:
    """(name → tag, tag(lower) → canonical tag) built from Babel's CLDR data.

    Names come from each locale's ``languages`` table (which includes dialect
    entries such as "Swiss German"/gsw, "Austrian German"/de_AT, "Moroccan
    Arabic"/ary) plus regional display names ("German (Switzerland)").
    """
    names: dict[str, str] = {}
    tags: dict[str, str] = {}
    for loc in TTS_LANGUAGE_NAME_LOCALES:
        for code, name in Locale.parse(loc).languages.items():
            tag = _to_bcp47(code)
            tags.setdefault(tag.lower(), tag)
            names.setdefault(_norm(name), tag)
    for ident in localedata.locale_identifiers():
        try:
            locale = Locale.parse(ident)
        except Exception:
            continue
        tag = _to_bcp47(str(locale))
        tags.setdefault(tag.lower(), tag)
        for loc in TTS_LANGUAGE_NAME_LOCALES:
            display = locale.get_display_name(loc)
            if display:
                names.setdefault(_norm(display), tag)
    return names, tags


def babel_tag_for(text: str) -> Optional[str]:
    """BCP-47 tag for a language name or tag, or None when Babel doesn't know it."""
    names, tags = _babel_index()
    q = _norm(text)
    if not q:
        return None
    if _TAG_RE.match(q.replace(" ", "")):
        canonical = tags.get(q.replace("_", "-"))
        if canonical:
            return canonical
        base, _, region = q.replace("_", "-").partition("-")
        if base in tags and region:
            return f"{tags[base]}-{region.upper() if len(region) == 2 else region}"
    return names.get(q)


def infer_base_language(text: str) -> Optional[str]:
    """Best-effort tag for an unrecognised dialect name, from the longest known
    language name it contains ("Zurich Swiss German" → gsw, "Darija Arabic" → ar).
    Used as the ``language_code`` of a custom voice."""
    direct = babel_tag_for(text)
    if direct:
        return direct
    names, _ = _babel_index()
    q = f" {_norm(text)} "
    best: tuple[int, Optional[str]] = (0, None)
    for name, tag in names.items():
        if len(name) > best[0] and f" {name} " in q:
            best = (len(name), tag)
    return best[1]


def _library_dialect_for_tag(tag: str, dialects: list[dict]) -> Optional[dict]:
    """Voice-library dialect for a tag: exact locale first, then (for a bare
    language) any locale of that language. Prefers the classic voices' accent,
    then the world/standard region (001), then the largest voice pool."""
    t = tag.lower()
    exact = [d for d in dialects if d["language_code"].lower() == t]
    pool = exact
    if not pool and "-" not in t:
        pool = [d for d in dialects if d["language_code"].lower().split("-")[0] == t]
    if not pool:
        return None
    return sorted(
        pool,
        key=lambda d: (
            d["accent"] != TTS_CLASSIC_VOICE_ACCENT,
            (d.get("region_code") or "") != "001",
            -d["voice_count"],
        ),
    )[0]


def resolve_language(
    text: Optional[str],
    dialects: list[dict],
    custom_voices: Optional[list[dict]] = None,
) -> LanguageMatch:
    """Resolve the user's language text. See module docstring for the order."""
    query = (text or "").strip()
    q = _norm(query)
    if not q:
        return LanguageMatch(kind=TTS_LANGUAGE_MATCH_UNKNOWN, query=query, label="")

    customs = [c for c in (custom_voices or []) if _norm(c.get("dialect_name", "")) == q]
    if customs:
        return LanguageMatch(
            kind=TTS_LANGUAGE_MATCH_CUSTOM,
            query=query,
            label=customs[0]["dialect_name"],
            language_code=customs[0].get("language_code"),
            custom_voices=customs,
        )

    for d in dialects:
        if _norm(d["accent"]) == q:
            return LanguageMatch(
                kind=TTS_LANGUAGE_MATCH_LIBRARY, query=query, label=d["accent"],
                language_code=d["language_code"], accent=d["accent"], voice_count=d["voice_count"],
            )

    tag = babel_tag_for(query)
    if tag:
        d = _library_dialect_for_tag(tag, dialects)
        if d:
            return LanguageMatch(
                kind=TTS_LANGUAGE_MATCH_LIBRARY, query=query, label=d["accent"],
                language_code=d["language_code"], accent=d["accent"], voice_count=d["voice_count"],
            )
        return LanguageMatch(kind=TTS_LANGUAGE_MATCH_TAG, query=query, label=query, language_code=tag)

    return LanguageMatch(kind=TTS_LANGUAGE_MATCH_UNKNOWN, query=query, label=query)
