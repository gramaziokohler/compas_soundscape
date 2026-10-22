"""Pure merge logic for ``transfer_scenes.py`` (no filesystem, DB or network).

Takes two ``soundscape.json`` dicts and copies sound scenes from one into the
other. Everything in a soundscape is linked by array index, so the copy is
re-indexed against the target, and every copied card / event gets a fresh id so
the same scenes can be transferred more than once without collisions.

Flow (driven by ``transfer_scenes.py``):
    package = extract_package(source, scene_numbers, strip_entities, reset_positions)
    apply_audio_renames(package, renames, missing)   # decided by the caller (I/O)
    merged  = merge_package(target, package)

Index/id rules mirrored from the frontend:
    * scene detection        — frontend/src/hooks/useSoundScenes.ts
    * event id shape         — frontend/src/utils/config-id.ts (cardEventId)
    * speech prompt_index    — frontend/src/utils/soundscape-serializer.ts (card * 10000 + line)
    * per-iteration map keys — `${soundId}-${iterationIndex}`
"""

from __future__ import annotations

import copy
import uuid
from typing import Callable, Optional

# Speech-line events encode `cardIndex * PROMPT_INDEX_BASE + lineIndex`.
PROMPT_INDEX_BASE = 10000
USAGE_CARD_TYPES = ("scenario", "text", "freeform")
ENTITY_FIELDS = ("entity_index", "entity_indices", "entity_node_id", "entity_node_ids", "entity_meta")
ITERATION_LINK_ENTITY_KEYS = ("entityNodeId", "entityPosition", "entityIndex")
AUDIO_REF_KEYS = ("audio_filename", "persisted_audio_filename")
UNPLACED_POSITION = [0.0, 0.0, 0.0]  # SoundSphereManager places it in front of the camera
# Per-sound maps keyed `${soundId}-${iterationIndex}`.
ITERATION_KEYED_MAPS = ("iteration_links", "iteration_trims", "exclusion_reasons")
SCENE_TITLE_MAX_CHARS = 48


# ── scene listing ────────────────────────────────────────────────────────────


def _analysis_configs(data: dict) -> list[dict]:
    return list(((data.get("analysis_state") or {}).get("configs")) or [])


def _scene_title(config: dict, fallback: str) -> str:
    title = (config.get("display_name") or "").strip()
    if not title:
        title = (config.get("textInput") or "").strip()
    if not title:
        scenario = config.get("scenarioResult") or {}
        title = str(scenario.get("title") or "").strip() if isinstance(scenario, dict) else ""
    title = title or fallback
    return title if len(title) <= SCENE_TITLE_MAX_CHARS else title[: SCENE_TITLE_MAX_CHARS - 1] + "…"


def list_scenes(data: dict) -> list[dict]:
    """Scenes in display order: ``[{number, usage_index, title, sound_count}]``.

    Same rule as useSoundScenes: a usage card (scenario / text / parented
    freeform) that is a scenario or already has child sounds.
    """
    sound_configs = data.get("sound_configs") or []
    scenes: list[dict] = []
    for usage_index, config in enumerate(_analysis_configs(data)):
        ctype = config.get("type")
        parent = config.get("parentContextOriginalIndex")
        is_usage = ctype in ("scenario", "text") or (ctype == "freeform" and parent is not None)
        if not is_usage:
            continue
        sound_count = sum(
            1 for sc in sound_configs if sc.get("parent_usage_original_index") == usage_index
        )
        if ctype != "scenario" and sound_count == 0:
            continue
        scenes.append(
            {
                "number": len(scenes),
                "usage_index": usage_index,
                "title": _scene_title(config, f"Scene {len(scenes) + 1}"),
                "sound_count": sound_count,
            }
        )
    return scenes


# ── selection ────────────────────────────────────────────────────────────────


def _select(data: dict, scene_numbers: Optional[list[int]]) -> tuple[list[int], list[int]]:
    """``(analysis_config_indices, sound_config_indices)`` to copy, ascending.

    ``None`` copies everything (all cards, all sounds — scenes and loose sounds).
    """
    configs = _analysis_configs(data)
    sound_configs = data.get("sound_configs") or []
    if scene_numbers is None:
        return list(range(len(configs))), list(range(len(sound_configs)))

    scenes = list_scenes(data)
    by_number = {s["number"]: s for s in scenes}
    unknown = [n for n in scene_numbers if n not in by_number]
    if unknown:
        raise ValueError(f"Unknown scene number(s) {unknown}; the source has {len(scenes)} scene(s).")

    usage = {by_number[n]["usage_index"] for n in scene_numbers}
    selected = set(usage)
    for u in usage:  # carry the scene's parent context card along
        parent = configs[u].get("parentContextOriginalIndex")
        if isinstance(parent, int) and 0 <= parent < len(configs):
            selected.add(parent)
    sounds = [
        i for i, sc in enumerate(sound_configs) if sc.get("parent_usage_original_index") in usage
    ]
    return sorted(selected), sounds


def _event_card_index(event: dict, cid_to_index: dict[str, int]) -> Optional[int]:
    cid = event.get("config_id")
    if cid and cid in cid_to_index:
        return cid_to_index[cid]
    pi = event.get("prompt_index")
    if not isinstance(pi, int):
        return None
    return pi // PROMPT_INDEX_BASE if pi >= PROMPT_INDEX_BASE else pi


# ── ids ──────────────────────────────────────────────────────────────────────


def rekey_event_id(old_id: str, old_cid: Optional[str], new_cid: str, old_card_index: int) -> str:
    """New event id for a copied card, keeping the id's prefix/copy/suffix shape."""
    new_key = new_cid.replace("_", "-")
    if old_cid:
        for candidate in (old_cid.replace("_", "-"), old_cid):
            if candidate and candidate in old_id:
                return old_id.replace(candidate, new_key)
    parts = old_id.split("_")
    if len(parts) >= 3 and parts[1] == str(old_card_index):  # legacy index-keyed id
        parts[1] = new_key
        return "_".join(parts)
    return f"{old_id}-{new_key}"


def _rekey_iteration_key(key: str, id_map: dict[str, str]) -> Optional[str]:
    base, sep, iteration = key.rpartition("-")
    if sep and iteration.isdigit() and base in id_map:
        return f"{id_map[base]}-{iteration}"
    return None


# ── spatial stripping ────────────────────────────────────────────────────────


def _strip_card_entities(item: dict) -> None:
    for field in ENTITY_FIELDS:
        if field in item:
            item[field] = None
    item["pinned"] = False


def _strip_analysis_config(config: dict) -> None:
    config.pop("drawnArea", None)
    for prompt in config.get("prompts") or []:
        prompt["entities"] = []
        prompt.pop("position", None)
    result = config.get("analysisResult")
    if isinstance(result, dict) and "architecturalObjects" in result:
        result["architecturalObjects"] = []


# ── extract ──────────────────────────────────────────────────────────────────


def extract_package(
    source: dict,
    scene_numbers: Optional[list[int]] = None,
    strip_entities: bool = True,
    reset_positions: bool = True,
    new_id: Callable[[], str] = lambda: str(uuid.uuid4()),
) -> dict:
    """Copy the selected scenes out of ``source`` with fresh card/event ids.

    Indices in the returned package are still the SOURCE indices; they are
    remapped against the target in ``merge_package``.
    """
    config_idx, sound_idx = _select(source, scene_numbers)
    configs = _analysis_configs(source)
    sound_configs = source.get("sound_configs") or []
    sound_set = set(sound_idx)

    cid_to_index = {
        sc["config_id"]: i for i, sc in enumerate(sound_configs) if sc.get("config_id")
    }
    new_cids = {i: new_id() for i in sound_idx}

    package_sounds: list[tuple[int, dict]] = []
    for i in sound_idx:
        sc = copy.deepcopy(sound_configs[i])
        sc["config_id"] = new_cids[i]
        if strip_entities:
            _strip_card_entities(sc)
            meta = sc.get("orchestrate_meta")
            if isinstance(meta, dict) and "allObjectIds" in meta:
                meta["allObjectIds"] = []
        if reset_positions:
            sc["position"] = None
        package_sounds.append((i, sc))

    id_map: dict[str, str] = {}
    events: list[tuple[int, dict]] = []
    dropped_events = 0
    for ev in source.get("sound_events") or []:
        card = _event_card_index(ev, cid_to_index)
        if card not in sound_set:
            dropped_events += 1 if scene_numbers is None else 0
            continue
        ev = copy.deepcopy(ev)
        old_cid = sound_configs[card].get("config_id") or ev.get("config_id")
        new_eid = rekey_event_id(str(ev.get("id", "")), old_cid, new_cids[card], card)
        id_map[str(ev.get("id", ""))] = new_eid
        ev["id"] = new_eid
        ev["config_id"] = new_cids[card]
        if strip_entities:
            _strip_card_entities(ev)
        if reset_positions:
            ev["position"] = list(UNPLACED_POSITION)
        events.append((card, ev))

    maps: dict = {}
    for name in ITERATION_KEYED_MAPS:
        src = source.get(name) or {}
        out = {}
        for key, value in src.items():
            new_key = _rekey_iteration_key(key, id_map)
            if new_key is None:
                continue
            value = copy.deepcopy(value)
            if name == "iteration_links" and strip_entities and isinstance(value, dict):
                for k in ITERATION_LINK_ENTITY_KEYS:
                    value.pop(k, None)
            out[new_key] = value
        maps[name] = out
    maps["excluded_iterations"] = {
        id_map[k]: copy.deepcopy(v)
        for k, v in (source.get("excluded_iterations") or {}).items()
        if k in id_map
    }
    soloed = list(source.get("soloed_sounds") or [])
    if not soloed and source.get("soloed_sound"):
        soloed = [source["soloed_sound"]]
    maps["muted_sounds"] = [id_map[s] for s in source.get("muted_sounds") or [] if s in id_map]
    maps["soloed_sounds"] = [id_map[s] for s in soloed if s in id_map]

    package_configs: list[tuple[int, dict]] = []
    for i in config_idx:
        cfg = copy.deepcopy(configs[i])
        if strip_entities:
            _strip_analysis_config(cfg)
        package_configs.append((i, cfg))

    return {
        "analysis_configs": package_configs,
        "sound_configs": package_sounds,
        "events": events,
        "maps": maps,
        "card_flow": copy.deepcopy((source.get("analysis_state") or {}).get("card_flow") or {}),
        "dropped_events": dropped_events,
    }


# ── referenced files ─────────────────────────────────────────────────────────


def _walk_audio_refs(node: object, visit: Callable[[dict, str], None]) -> None:
    if isinstance(node, dict):
        for key in list(node.keys()):
            value = node[key]
            if key in AUDIO_REF_KEYS and isinstance(value, str):
                if value.strip():
                    visit(node, key)
            else:
                _walk_audio_refs(value, visit)
    elif isinstance(node, list):
        for item in node:
            _walk_audio_refs(item, visit)


def package_audio_files(package: dict) -> list[str]:
    """Every audio filename the package references (deduplicated, ordered)."""
    names: list[str] = []
    for _, ev in package["events"]:
        for key in ("audio_filename", "fx_audio_filename"):
            name = (ev.get(key) or "").strip()
            if name:
                names.append(name)
    _walk_audio_refs([c for _, c in package["analysis_configs"]], lambda n, k: names.append(n[k].strip()))
    return list(dict.fromkeys(names))


def package_analysis_files(package: dict) -> list[str]:
    """``analysis/`` JSON filenames the copied cards reference."""
    names: list[str] = []
    for _, cfg in package["analysis_configs"]:
        if cfg.get("scenarioId"):
            names.append(f"scenarios_{cfg['scenarioId']}.json")
        foley = cfg.get("foleyResult")
        if isinstance(foley, dict) and foley.get("foleyId"):
            names.append(f"scenarios_{foley['foleyId']}.json")
        result = cfg.get("analysisResult")
        if isinstance(result, dict) and result.get("analysisId"):
            names.append(f"analysis_{result['analysisId']}.json")
    return list(dict.fromkeys(names))


def apply_audio_renames(package: dict, renames: dict[str, str], missing: set[str]) -> None:
    """Point the package at the copied audio names; clear refs to missing files."""

    def _fix(holder: dict, key: str) -> None:
        name = (holder.get(key) or "").strip()
        if not name:
            return
        if name in missing:
            holder[key] = ""
            if key == "fx_audio_filename":
                holder["fx_enabled"] = False
        elif name in renames:
            holder[key] = renames[name]

    for _, ev in package["events"]:
        _fix(ev, "audio_filename")
        _fix(ev, "fx_audio_filename")
    _walk_audio_refs([c for _, c in package["analysis_configs"]], _fix)


# ── merge ────────────────────────────────────────────────────────────────────


def _remap_list(values: list, index_map: dict[int, int]) -> list[int]:
    return [index_map[int(v)] for v in values or [] if _as_int(v) in index_map]


def _as_int(value: object) -> Optional[int]:
    try:
        return int(value)  # JSON object keys are strings
    except (TypeError, ValueError):
        return None


def _remap_card_flow(flow: dict, cfg_map: dict[int, int], snd_map: dict[int, int]) -> dict:
    out = {
        "contextAdvanced": _remap_list(flow.get("contextAdvanced"), cfg_map),
        "usageAdvanced": _remap_list(flow.get("usageAdvanced"), cfg_map),
        "contextToUsageMap": {},
        "usageToSoundMap": {},
    }
    for key, values in (flow.get("contextToUsageMap") or {}).items():
        k = _as_int(key)
        mapped = _remap_list(values, cfg_map)
        if k in cfg_map and mapped:
            out["contextToUsageMap"][str(cfg_map[k])] = mapped
    for key, values in (flow.get("usageToSoundMap") or {}).items():
        k = _as_int(key)
        mapped = _remap_list(values, snd_map)
        if k in cfg_map and mapped:
            out["usageToSoundMap"][str(cfg_map[k])] = mapped
    return out


def merge_package(target: dict, package: dict) -> dict:
    """Append the package to ``target`` (returns a new dict; target untouched)."""
    merged = copy.deepcopy(target)
    analysis_state = merged.get("analysis_state") or {"active_tab": 0, "configs": []}
    analysis_state.setdefault("configs", [])
    merged["analysis_state"] = analysis_state
    merged.setdefault("sound_configs", [])
    merged.setdefault("sound_events", [])

    cfg_offset = len(analysis_state["configs"])
    snd_offset = len(merged["sound_configs"])
    cfg_map = {old: cfg_offset + n for n, (old, _) in enumerate(package["analysis_configs"])}
    snd_map = {old: snd_offset + n for n, (old, _) in enumerate(package["sound_configs"])}

    for old, cfg in package["analysis_configs"]:
        cfg = copy.deepcopy(cfg)
        parent = cfg.get("parentContextOriginalIndex")
        if parent is not None:
            cfg["parentContextOriginalIndex"] = cfg_map.get(parent)
            if cfg["parentContextOriginalIndex"] is None:
                cfg.pop("parentContextOriginalIndex")
        if "sound_config_indices" in cfg:
            cfg["sound_config_indices"] = _remap_list(cfg["sound_config_indices"], snd_map)
        analysis_state["configs"].append(cfg)

    for old, sc in package["sound_configs"]:
        sc = copy.deepcopy(sc)
        sc["index"] = snd_map[old]
        parent = sc.get("parent_usage_original_index")
        sc["parent_usage_original_index"] = cfg_map.get(parent) if parent is not None else None
        merged["sound_configs"].append(sc)

    for card, ev in package["events"]:
        ev = copy.deepcopy(ev)
        pi = ev.get("prompt_index")
        if isinstance(pi, int) and pi >= PROMPT_INDEX_BASE:
            ev["prompt_index"] = snd_map[card] * PROMPT_INDEX_BASE + pi % PROMPT_INDEX_BASE
        else:
            ev["prompt_index"] = snd_map[card]
        merged["sound_events"].append(ev)

    maps = package["maps"]
    for name in (*ITERATION_KEYED_MAPS, "excluded_iterations"):
        if maps.get(name):
            merged[name] = {**(merged.get(name) or {}), **maps[name]}
    for name in ("muted_sounds", "soloed_sounds"):
        if maps.get(name):
            merged[name] = list(dict.fromkeys([*(merged.get(name) or []), *maps[name]]))

    added_flow = _remap_card_flow(package["card_flow"], cfg_map, snd_map)
    flow = analysis_state.get("card_flow") or {}
    analysis_state["card_flow"] = {
        "contextAdvanced": list(dict.fromkeys([*(flow.get("contextAdvanced") or []), *added_flow["contextAdvanced"]])),
        "usageAdvanced": list(dict.fromkeys([*(flow.get("usageAdvanced") or []), *added_flow["usageAdvanced"]])),
        "contextToUsageMap": {**(flow.get("contextToUsageMap") or {}), **added_flow["contextToUsageMap"]},
        "usageToSoundMap": {**(flow.get("usageToSoundMap") or {}), **added_flow["usageToSoundMap"]},
    }
    return merged
