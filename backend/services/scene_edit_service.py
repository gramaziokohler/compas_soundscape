"""Scene edit chat: turn a user's request about a generated sound scene into typed edit ops.

The frontend sends a compact snapshot of the scene (utils/sceneEditSnapshot.ts): sound cards
with short refs ("S1"), analysis objects ("O1"), the room and the timeline. The edit agent
answers with a ``SceneEditPlan`` (a chat reply + ``SceneEditOp`` list); ``normalise_plan``
drops ops that reference unknown cards and clamps every value before the frontend applies
them (utils/sceneEditApply.ts).
"""
from __future__ import annotations

import json

from config.constants import (
    DBFS_MAX,
    DBFS_MIN,
    DEFAULT_LLM_MODEL,
    SCENE_EDIT_HISTORY_MAX_MESSAGES,
    SCENE_EDIT_HISTORY_MESSAGE_MAX_CHARS,
    SCENE_EDIT_INSTRUCTION_MAX_CHARS,
    SCENE_EDIT_LEVEL_DELTA_MAX_DB,
    SCENE_EDIT_MAX_LINES,
    SCENE_EDIT_MAX_NEW_SOUNDS,
    SCENE_EDIT_MAX_OPS,
    SCENE_EDIT_MAX_TIMES,
    SCENE_EDIT_MAX_VARIANTS,
    SCENE_EDIT_SCENE_DURATION_RANGE_S,
    SCENE_EDIT_SOUND_DURATION_RANGE_S,
    SCENE_EDIT_TEMPERATURE,
    SOUND_POSITION_WALL_MARGIN_M,
    SPEECH_DBFS_DEFAULT,
    TTS_CHARACTER_NAMES,
    TTS_INLINE_VOCAL_TAGS,
)
from models.schemas import (
    SceneEditHistoryMessage,
    SceneEditOp,
    SceneEditPlan,
    SceneEditResult,
    SceneEditSnapshot,
)
from services.llm_service import LLMService
from utils.spatial import clamp_position, room_extents_text
from utils.speech_style import clean_style, proposed_speech_dbfs

# Ops that act on existing sound cards (need at least one valid target).
_TARGET_OPS = {
    "set_level", "mute", "unmute", "solo", "unsolo", "set_loopable", "trim",
    "set_times", "shift", "set_density", "remove_occurrences",
    "move", "set_directivity",
    "remove", "change_sound", "regenerate", "set_variants",
    "edit_lines", "change_voice", "set_style",
}
# Ops whose targets must be speech cards.
_SPEECH_OPS = {"edit_lines", "change_voice", "set_style"}
_NEW_SOUND_OPS = {"add_sound", "add_speaker"}
_BACKGROUND_CATEGORY = "background sound"
_EVENT_CATEGORY = "sound event"
_OMNI_PRESET = "omni"

_OP_REFERENCE = """\
MIX (instant, no regeneration)
- set_level {targets, db | delta_db}: absolute level in dBFS (-60..0) or a relative change in dB.
  "Too loud" = delta_db about -6; "a bit" = -3; "much" = -10. Prefer delta_db.
- mute / unmute / solo / unsolo {targets}
- set_loopable {targets, on}: make a sound loop seamlessly (beds, machinery).
- trim {targets, start, end}: keep only this part of the clip (fractions 0-1 of its length).
TIMING (instant)
- set_times {targets, times_s}: the exact start times (s) of every occurrence. Replaces all of them.
- shift {targets, delta_s}: move every occurrence by delta_s seconds.
- set_density {targets, count | interval_s}: spread this many occurrences (or one every interval_s)
  over the scene.
- remove_occurrences {targets, times_s}: drop the occurrences starting nearest those times.
- set_scene_duration {seconds}
SPACE (instant)
- move {targets, position}: the new [x, y, z] in metres (see PLACEMENT).
- set_directivity {targets, preset, yaw_deg}: preset from the snapshot's directivity_presets.
CONTENT (regenerates audio)
- add_sound {new_ref, name, prompt, category, duration_s, times_s, count, position}: a new foley sound. prompt = a concrete text-to-audio description of the sound only
  (source, action, material, acoustic character; no room or reverb words). category "sound event" or
  "background sound". count = distinct audio variants (1-5).
- remove {targets}
- change_sound {targets, prompt, duration_s}: same sound slot, new audio.
- regenerate {targets}: new takes with the same prompt ("make it different").
- set_variants {targets, count}: number of distinct audio copies (1-5); only new copies are generated.
SPEECH (regenerates voices)
- add_speaker {new_ref, character, lines, times_s, position, style}: ONE new person talking. lines =
  only what THIS person says, one entry per spoken turn; times_s = when each turn starts. A new
  conversation between two new people = two add_speaker ops, one per person. style = how they
  speak (see set_style), "" for ordinary talk.
- edit_lines {targets, lines}: rewrite a speaker's turns (e.g. cut a line short where someone
  interrupts, translate, change tone). Give ALL lines of that speaker, edited ones included.
- change_voice {targets, character}
- set_style {targets, style}: how a speaker delivers all their lines, a short English direction for
  the voice ("whispering", "shouting across the room", "excited and fast", "tired and slow"); "" =
  ordinary talk. Never write a delivery as a tag inside the lines. The app proposes a matching level
  (a whisper plays quieter, a shout louder); add set_level only when the user asks for a level.
SCENE
- rename_scene {title}
PLACEMENT
- Every add_sound, add_speaker and move op MUST have position = [x, y, z] in metres, chosen from the
  room extents, the objects' centre / extent and the positions of the existing cards, following the
  SPATIAL PLACEMENT rules. An op without a position is dropped.
"""


def _clip(text: str, limit: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


class SceneEditService:
    """Builds the edit-agent prompts, calls the LLM and normalises its plan."""

    def __init__(self, llm_service: LLMService):
        self._llm = llm_service

    # ── Prompts ──────────────────────────────────────────────────────────────

    @staticmethod
    def build_prompts(
        snapshot: SceneEditSnapshot,
        history: list[SceneEditHistoryMessage],
        instruction: str,
    ) -> tuple[str, str]:
        system_prompt = (
            "You are the sound editor of an architectural soundscape tool. A sound scene was generated "
            "from a scenario: foley sounds and speech placed in a 3D room on a timeline. The user asks for "
            "changes in plain language. You answer with a short chat reply and a list of edit operations "
            "that the app applies exactly.\n"
            "RULES\n"
            "- Do exactly what is asked, nothing more. Everything not mentioned stays as it is.\n"
            "- Use the fewest ops. Prefer instant ops (level, timing, position) over regenerating audio.\n"
            "- Refer to sounds only by their snapshot ref (S1, S2…) or by the new_ref (N1, N2…) of a sound "
            "you add earlier in the same plan. Refer to model objects only by their ref (O1…). Never invent "
            "refs.\n"
            "- Times are seconds from the scene start and must lie inside the scene duration.\n"
            "- When the user names a sound loosely (\"the background\", \"footsteps\"), match it to every "
            "card that fits by name, category or prompt.\n"
            "- When the user asks for something in a place (\"at the entrance\", \"near the window\"), give "
            "new or moved sounds a position at the matching objects (doors, entrance, window…), at the right "
            "height for the source, or a plausible position inside the room when no object fits.\n"
            f"- Speakers use a character name from this list (it sets the voice): {', '.join(TTS_CHARACTER_NAMES)}. "
            "Pick one that is not already used in the scene for a new person.\n"
            f"- Speech lines may use these inline vocal tags only: {' '.join(TTS_INLINE_VOCAL_TAGS)}.\n"
            "- An interruption: decide whether the interrupted speaker is cut off (edit_lines to end their "
            "line mid-sentence, e.g. with an em dash) or keeps talking over the newcomer (overlap). Choose "
            "what sounds natural for the scene. After every turn the app re-orchestrates the timeline with "
            "the user's request, so give approximate times.\n"
            "- If the request is ambiguous or impossible with these ops, return no ops and ask a short "
            "question or explain in the reply.\n"
            "- Write the ops first, then the reply. The reply is one or two short sentences, in the user's "
            "language, describing exactly the ops you wrote: every sound or person it mentions as added, "
            "changed or removed has its own op.\n"
            "- Spoken lines are in the scene language when one is given.\n"
        )
        room = room_extents_text(snapshot.room)
        spatial = LLMService._spatial_placement_rules(room)
        recent = history[-SCENE_EDIT_HISTORY_MAX_MESSAGES:]
        history_text = "\n".join(
            f"{m.role.upper()}: {_clip(m.text, SCENE_EDIT_HISTORY_MESSAGE_MAX_CHARS)}" for m in recent
        ) or "(none)"
        scene_json = json.dumps(snapshot.model_dump(exclude_none=True), ensure_ascii=False, indent=1)
        user_prompt = (
            f"OPERATIONS\n{_OP_REFERENCE}\n"
            f"{spatial}"
            f"SCENE\n{scene_json}\n\n"
            f"EARLIER CHAT\n{history_text}\n\n"
            f"USER REQUEST\n{_clip(instruction, SCENE_EDIT_INSTRUCTION_MAX_CHARS)}\n"
        )
        return system_prompt, user_prompt

    # ── LLM call ─────────────────────────────────────────────────────────────

    async def plan_edit(
        self,
        snapshot: SceneEditSnapshot,
        history: list[SceneEditHistoryMessage],
        instruction: str,
        llm_model: str = DEFAULT_LLM_MODEL,
        on_progress=None,
    ) -> dict:
        """Ask the edit agent for a plan and return a normalised ``SceneEditResult`` dict."""
        system_prompt, user_prompt = self.build_prompts(snapshot, history, instruction)
        raw = await self._llm._call_llm(
            user_prompt,
            system_prompt,
            response_schema=SceneEditPlan,
            operation_name="Scene edit agent",
            llm_model=llm_model,
            temperature=SCENE_EDIT_TEMPERATURE,
            on_progress=on_progress,
        )
        plan = SceneEditPlan.model_validate(raw if isinstance(raw, dict) else json.loads(str(raw)))
        ops, warnings = normalise_plan(plan, snapshot)
        return SceneEditResult(reply=plan.reply.strip(), ops=ops, warnings=warnings).model_dump()


# ── Normalisation ────────────────────────────────────────────────────────────


def _times(values: list[float], duration_s: float) -> list[float]:
    out = sorted({round(_clamp(float(t), 0.0, duration_s), 2) for t in values})
    return out[:SCENE_EDIT_MAX_TIMES]


def _character(name: str) -> str | None:
    wanted = (name or "").strip().lower()
    for candidate in TTS_CHARACTER_NAMES:
        if candidate.lower() == wanted:
            return candidate
    return None


def _free_character(used: set[str]) -> str:
    for candidate in TTS_CHARACTER_NAMES:
        if candidate not in used:
            return candidate
    return TTS_CHARACTER_NAMES[0]


def _lines(lines: list[str]) -> list[str]:
    return [line.strip() for line in lines if line and line.strip()][:SCENE_EDIT_MAX_LINES]


def _placement(op: SceneEditOp, room: dict | None) -> bool:
    """Clamp the agent's ``position`` inside the room (in place). True when it is usable.

    The agent picks the position itself (like the scenarist); there is no fallback place.
    """
    op.position = clamp_position(op.position, room, SOUND_POSITION_WALL_MARGIN_M) if op.position else []
    return bool(op.position)


def normalise_plan(plan: SceneEditPlan, snapshot: SceneEditSnapshot) -> tuple[list[SceneEditOp], list[str]]:
    """Validate and clamp the agent's ops against the snapshot.

    Returns the ops to apply and human-readable warnings for the ones dropped or changed.
    """
    duration = snapshot.duration_s
    cards = {c.ref: c for c in snapshot.cards}
    speech_refs = {ref for ref, c in cards.items() if c.kind == "speech"}
    used_characters = {c.character for c in snapshot.cards if c.character}
    new_refs: set[str] = set()
    new_speech_refs: set[str] = set()
    ops: list[SceneEditOp] = []
    warnings: list[str] = []

    def skip(op: SceneEditOp, reason: str) -> None:
        warnings.append(f"Skipped {op.op}: {reason}")

    for op in plan.ops:
        if len(ops) >= SCENE_EDIT_MAX_OPS:
            warnings.append(f"Only the first {SCENE_EDIT_MAX_OPS} changes were applied")
            break
        op = op.model_copy(deep=True)
        sound_refs = set(cards) | new_refs

        if op.op in _TARGET_OPS:
            unknown = [t for t in op.targets if t not in sound_refs]
            op.targets = list(dict.fromkeys(t for t in op.targets if t in sound_refs))
            if unknown:
                warnings.append(f"{op.op}: unknown sound {', '.join(unknown)} ignored")
            if op.op in _SPEECH_OPS:
                op.targets = [t for t in op.targets if t in speech_refs or t in new_speech_refs]
            if not op.targets:
                skip(op, "no matching sound")
                continue

        if op.op == "set_level":
            if op.db is not None:
                op.db = _clamp(op.db, DBFS_MIN, DBFS_MAX)
                op.delta_db = None
            elif op.delta_db is not None:
                op.delta_db = _clamp(op.delta_db, -SCENE_EDIT_LEVEL_DELTA_MAX_DB, SCENE_EDIT_LEVEL_DELTA_MAX_DB)
            else:
                skip(op, "no level given")
                continue
        elif op.op == "set_loopable":
            op.on = True if op.on is None else op.on
        elif op.op == "trim":
            start = _clamp(op.start if op.start is not None else 0.0, 0.0, 1.0)
            end = _clamp(op.end if op.end is not None else 1.0, 0.0, 1.0)
            if end <= start:
                skip(op, "empty trim range")
                continue
            op.start, op.end = start, end
        elif op.op in ("set_times", "remove_occurrences"):
            op.times_s = _times(op.times_s, duration)
            if not op.times_s:
                skip(op, "no times given")
                continue
        elif op.op == "shift":
            if not op.delta_s:
                skip(op, "no shift given")
                continue
            op.delta_s = _clamp(op.delta_s, -duration, duration)
        elif op.op == "set_density":
            if op.count is not None and op.count >= 1:
                op.count = min(op.count, SCENE_EDIT_MAX_TIMES)
                op.interval_s = None
            elif op.interval_s is not None and op.interval_s > 0:
                op.interval_s = _clamp(op.interval_s, duration / SCENE_EDIT_MAX_TIMES, duration)
                op.count = None
            else:
                skip(op, "no count or interval given")
                continue
        elif op.op == "set_scene_duration":
            if op.seconds is None:
                skip(op, "no duration given")
                continue
            op.seconds = _clamp(op.seconds, *SCENE_EDIT_SCENE_DURATION_RANGE_S)
        elif op.op == "move":
            if not _placement(op, snapshot.room):
                skip(op, "no position given")
                continue
        elif op.op == "set_directivity":
            presets = set(snapshot.directivity_presets) | {_OMNI_PRESET}
            if op.preset not in presets:
                skip(op, f"unknown directivity '{op.preset}'")
                continue
        elif op.op == "change_sound":
            op.prompt = op.prompt.strip()
            if op.duration_s is not None:
                op.duration_s = _clamp(op.duration_s, *SCENE_EDIT_SOUND_DURATION_RANGE_S)
            if not op.prompt and op.duration_s is None:
                skip(op, "nothing to change")
                continue
        elif op.op == "set_variants":
            if op.count is None:
                skip(op, "no variant count given")
                continue
            op.count = int(_clamp(op.count, 1, SCENE_EDIT_MAX_VARIANTS))
        elif op.op in ("edit_lines",):
            op.lines = _lines(op.lines)
            if not op.lines:
                skip(op, "no lines given")
                continue
        elif op.op == "change_voice":
            character = _character(op.character)
            if not character:
                skip(op, f"unknown voice '{op.character}'")
                continue
            op.character = character
        elif op.op == "set_style":
            op.style = clean_style(op.style)
            # Propose the style's level (a neutral style goes back to normal talk)
            # unless the agent set one itself.
            if op.db is None:
                op.db = proposed_speech_dbfs(op.style) or SPEECH_DBFS_DEFAULT
            op.db = _clamp(op.db, DBFS_MIN, DBFS_MAX)
        elif op.op == "rename_scene":
            op.title = op.title.strip()
            if not op.title:
                skip(op, "empty title")
                continue
        elif op.op in _NEW_SOUND_OPS:
            if len(new_refs) >= SCENE_EDIT_MAX_NEW_SOUNDS:
                skip(op, f"at most {SCENE_EDIT_MAX_NEW_SOUNDS} new sounds per message")
                continue
            ref = op.new_ref.strip()
            if not ref or ref in sound_refs:
                ref = f"N{len(new_refs) + 1}"
                while ref in sound_refs:
                    ref = f"N{int(ref[1:]) + 1}"
            op.new_ref = ref
            op.times_s = _times(op.times_s, duration)
            if not _placement(op, snapshot.room):
                skip(op, f"no position given for {op.name or op.character or ref}")
                continue
            if op.op == "add_sound":
                op.prompt = op.prompt.strip() or op.name.strip()
                if not op.prompt:
                    skip(op, "no sound description")
                    continue
                op.name = op.name.strip() or _clip(op.prompt, 40)
                op.category = (
                    _BACKGROUND_CATEGORY if _BACKGROUND_CATEGORY in op.category.lower() else _EVENT_CATEGORY
                )
                if op.duration_s is not None:
                    op.duration_s = _clamp(op.duration_s, *SCENE_EDIT_SOUND_DURATION_RANGE_S)
                op.count = int(_clamp(op.count or 1, 1, SCENE_EDIT_MAX_VARIANTS))
            else:
                op.lines = _lines(op.lines)
                if not op.lines:
                    skip(op, "the new speaker has no lines")
                    continue
                character = _character(op.character)
                if not character or character in used_characters:
                    replacement = _free_character(used_characters)
                    if op.character:
                        warnings.append(f"add_speaker: voice '{op.character}' replaced by {replacement}")
                    character = replacement
                op.character = character
                op.style = clean_style(op.style)
                if op.db is None:
                    op.db = proposed_speech_dbfs(op.style)
                if op.db is not None:
                    op.db = _clamp(op.db, DBFS_MIN, DBFS_MAX)
                used_characters.add(character)
                new_speech_refs.add(ref)
            new_refs.add(ref)

        ops.append(op)
    return ops, warnings
