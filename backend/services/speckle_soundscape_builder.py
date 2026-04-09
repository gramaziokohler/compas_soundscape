# backend/services/speckle_soundscape_builder.py
# Builds Speckle objects (Points, Collections) from soundscape data
"""
Converts soundscape JSON data into proper Speckle objects with properties.

- Free-standing sound events → Point objects at their position
- Entity-linked sound events → properties added to existing Speckle entities
- Receivers → Point objects at their position
- Material assignments → properties added to existing Speckle geometry objects

The Soundscape Collection also carries the full metadata as properties
(JSON-stringified for complex fields) so the soundscape can be fully
reconstructed from Speckle alone (no local JSON needed).

All properties respect Speckle's 2-level nesting maximum.
"""

import json
import re
import logging
from typing import Optional

from specklepy.objects import Base
from specklepy.objects.geometry import Point
from specklepy.objects.models.collections.collection import Collection

from config.constants import (
    SPECKLE_SOUNDSCAPE_PINK_COLOR,
    SPECKLE_SOUNDSCAPE_COLLECTION_NAME,
    SPECKLE_SOUND_SOURCES_COLLECTION_NAME,
    SPECKLE_RECEIVERS_COLLECTION_NAME,
)


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _js_parse_int_base10(s: str) -> Optional[int]:
    """Emulate JavaScript's ``parseInt(s, 10)`` for Speckle hash IDs.

    JavaScript's parseInt reads leading decimal digits and ignores the rest.
    E.g. ``parseInt("8809a5a9f82...", 10)`` → ``8809``.
    """
    m = re.match(r"\d+", s)
    return int(m.group()) if m else None


def _traverse_tree(obj, visitor, _visited=None):
    """Depth-first traversal of a Speckle Base object tree.

    Recurses into **every** dynamic member that is a ``Base`` or a list
    containing ``Base`` instances, so objects stored under custom attribute
    names (e.g. ``@data``, ``@geometry``, ``@children``) are not missed.

    A ``_visited`` set prevents infinite loops on cyclic graphs.
    """
    if not isinstance(obj, Base):
        return
    if _visited is None:
        _visited = set()
    obj_py_id = id(obj)
    if obj_py_id in _visited:
        return
    _visited.add(obj_py_id)

    visitor(obj)

    # Iterate ALL dynamic members (specklepy stores them in __dict__)
    for attr_name in list(obj.__dict__.keys()):
        value = obj.__dict__[attr_name]
        if isinstance(value, Base):
            _traverse_tree(value, visitor, _visited)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, Base):
                    _traverse_tree(item, visitor, _visited)
        elif isinstance(value, dict):
            for item in value.values():
                if isinstance(item, Base):
                    _traverse_tree(item, visitor, _visited)


# ---------------------------------------------------------------------------
# Index builders
# ---------------------------------------------------------------------------

def build_object_indices(root_object: Base):
    """Build look-up tables for the object tree.

    Returns:
        (hash_to_obj, entity_idx_to_obj)
        - hash_to_obj:       Speckle hash ID (str) → Base object
        - entity_idx_to_obj: parseInt(hash, 10) (int) → Base object
    """
    hash_to_obj: dict[str, Base] = {}
    entity_idx_to_obj: dict[int, Base] = {}

    def _index(obj: Base):
        obj_id = getattr(obj, "id", "") or ""
        if not obj_id:
            return
        if obj_id not in hash_to_obj:
            hash_to_obj[obj_id] = obj
        parsed = _js_parse_int_base10(obj_id)
        if parsed is not None and parsed not in entity_idx_to_obj:
            entity_idx_to_obj[parsed] = obj

    _traverse_tree(root_object, _index)
    logger.info(
        f"Object indices built: {len(hash_to_obj)} hash entries, "
        f"{len(entity_idx_to_obj)} parseInt entries"
    )
    return hash_to_obj, entity_idx_to_obj


# ---------------------------------------------------------------------------
# Point / object factory
# ---------------------------------------------------------------------------

def _create_point(x: float, y: float, z: float) -> Point:
    """Create a Speckle Point using the ``__new__`` workaround for specklepy
    property-descriptor bugs."""
    p = Point.__new__(Point)
    Base.__init__(p)
    p.x = float(x)
    p.y = float(y)
    p.z = float(z)
    p.units = "m"
    return p


def _flatten_sound_event_properties(
    event: dict,
    *,
    include_position: bool = False,
) -> dict:
    """Flatten a sound-event dict into a properties dict (max 2-level nesting).

    Args:
        event: A single entry from ``soundscape_data["sound_events"]``.
        include_position: If True, expand ``position`` to flat keys
            ``position_x``, ``position_y``, ``position_z``.
    """
    props: dict = {}
    for key, value in event.items():
        if key == "position":
            if include_position:
                pos = value or [0, 0, 0]
                props["position_x"] = pos[0] if len(pos) > 0 else 0
                props["position_y"] = pos[1] if len(pos) > 1 else 0
                props["position_z"] = pos[2] if len(pos) > 2 else 0
            continue
        # Convert None to empty string for Speckle compatibility
        props[key] = value if value is not None else ""
    return props


# ---------------------------------------------------------------------------
# Build (save direction)
# ---------------------------------------------------------------------------

def build_soundscape_objects(
    root_object: Base,
    soundscape_data: dict,
    model_id: str,
) -> tuple[Collection, int, int, int]:
    """Build Speckle objects from soundscape data and modify existing entities.

    Creates a ``Soundscape`` Collection containing:
    - ``Sound Sources`` Collection with Point objects for free sounds
    - ``Receivers`` Collection with Point objects
    - Full metadata as properties on the Collection (for round-trip loading)

    Also modifies existing entities in *root_object* for:
    - Entity-linked sound events (adds properties + pink color)
    - Material assignments (adds material name + simulation_id)

    Args:
        root_object: The Speckle root object tree (will be mutated for
            entity-linked sounds and materials).
        soundscape_data: The full soundscape dict from the JSON payload.
        model_id: The Speckle model ID.

    Returns:
        (collection, sources_count, receivers_count, materials_count)
    """
    sound_events = soundscape_data.get("sound_events", [])
    receivers = soundscape_data.get("receivers", [])
    simulation_configs = soundscape_data.get("simulation_configs", [])

    # Build indices for entity / material matching
    hash_to_obj, entity_idx_to_obj = build_object_indices(root_object)

    # ----- Sound Sources -----
    source_points: list[Point] = []
    entities_modified = 0

    for event in sound_events:
        entity_index = event.get("entity_index")
        entity_node_id = event.get("entity_node_id")
        position = event.get("position", [0, 0, 0])

        if entity_index is None and entity_node_id is None:
            # Free-standing sound → create Point (position in geometry)
            point = _create_point(position[0], position[1], position[2])
            props = _flatten_sound_event_properties(event, include_position=False)
            props["type"] = "sound_source"
            point["properties"] = props
            source_points.append(point)
        else:
            # Entity-linked sound → find entity and add properties + color
            # Prefer direct hash lookup (entity_node_id) over lossy parseInt lookup
            entity_obj = None
            if entity_node_id:
                entity_obj = hash_to_obj.get(entity_node_id)
                if entity_obj:
                    logger.info(
                        f"Entity matched by node_id '{entity_node_id[:16]}...' "
                        f"for sound '{event.get('id')}'"
                    )
                else:
                    logger.warning(
                        f"entity_node_id '{entity_node_id[:16]}...' not found "
                        f"in {len(hash_to_obj)} indexed objects"
                    )
            if entity_obj is None and entity_index is not None:
                entity_obj = entity_idx_to_obj.get(entity_index)
                if entity_obj:
                    logger.info(
                        f"Entity matched by parseInt index {entity_index} "
                        f"for sound '{event.get('id')}'"
                    )
            if entity_obj is not None:
                sound_props = _flatten_sound_event_properties(
                    event, include_position=True
                )
                # Prefix keys with "sound_" to avoid collisions
                prefixed: dict = {}
                for k, v in sound_props.items():
                    prefixed[f"sound_{k}"] = v

                existing_props = getattr(entity_obj, "properties", None)
                if isinstance(existing_props, dict):
                    existing_props.update(prefixed)
                else:
                    entity_obj["properties"] = prefixed

                # Change color to pink
                entity_obj["color"] = SPECKLE_SOUNDSCAPE_PINK_COLOR

                entities_modified += 1
                logger.info(
                    f"Modified entity for sound '{event.get('id')}' "
                    f"(entity_index={entity_index})"
                )
            else:
                # Entity not found → fall back to creating a Point
                logger.warning(
                    f"Entity not found for entity_node_id={entity_node_id}, "
                    f"entity_index={entity_index}, creating Point instead"
                )
                point = _create_point(position[0], position[1], position[2])
                props = _flatten_sound_event_properties(
                    event, include_position=False
                )
                props["type"] = "sound_source"
                props["entity_index"] = entity_index
                point["properties"] = props
                point["color"] = SPECKLE_SOUNDSCAPE_PINK_COLOR
                source_points.append(point)

    # ----- Receivers -----
    receiver_points: list[Point] = []
    for recv in receivers:
        pos = recv.get("position", [0, 0, 0])
        point = _create_point(pos[0], pos[1], pos[2])
        props = {
            "id": recv.get("id", ""),
            "name": recv.get("name", ""),
            "type": recv.get("type") or "receiver",
        }
        point["properties"] = props
        receiver_points.append(point)

    # ----- Material Assignments -----
    materials_modified = 0
    for sim_config in simulation_configs:
        sim_id = sim_config.get("id", "")
        assignments = sim_config.get("speckle_material_assignments") or {}
        if not assignments:
            continue

        logger.info(
            f"Processing {len(assignments)} material assignments for sim '{sim_id}'"
        )
        for obj_hash, material_name in assignments.items():
            target_obj = hash_to_obj.get(obj_hash)
            if target_obj is None:
                logger.debug(
                    f"Object {obj_hash[:12]}... not found for material assignment"
                )
                continue

            existing_props = getattr(target_obj, "properties", None)
            mat_props = {
                "acoustic_material": material_name,
                "acoustic_simulation_id": sim_id,
            }
            if isinstance(existing_props, dict):
                existing_props.update(mat_props)
            else:
                target_obj["properties"] = mat_props
            materials_modified += 1

    logger.info(
        f"Material assignments applied: {materials_modified} objects"
    )

    # ----- Build Collections -----
    sources_collection = Collection(
        name=SPECKLE_SOUND_SOURCES_COLLECTION_NAME,
        elements=source_points,
    )
    receivers_collection = Collection(
        name=SPECKLE_RECEIVERS_COLLECTION_NAME,
        elements=receiver_points,
    )

    soundscape_collection = Collection(
        name=SPECKLE_SOUNDSCAPE_COLLECTION_NAME,
        elements=[sources_collection, receivers_collection],
    )

    # Store full metadata on Collection properties for round-trip loading.
    # Complex/nested fields are JSON-stringified to respect 2-level max.
    soundscape_collection["properties"] = {
        "version": soundscape_data.get("version", "1.0"),
        "model_id": model_id,
        "model_name": soundscape_data.get("model_name", ""),
        "created_at": soundscape_data.get("created_at", ""),
        "global_settings": json.dumps(
            soundscape_data.get("global_settings", {})
        ),
        "sound_configs": json.dumps(
            soundscape_data.get("sound_configs", [])
        ),
        "sound_events": json.dumps(
            soundscape_data.get("sound_events", [])
        ),
        "receivers": json.dumps(
            soundscape_data.get("receivers", [])
        ),
        "selected_receiver_id": soundscape_data.get(
            "selected_receiver_id"
        ) or "",
        "simulation_configs": json.dumps(
            soundscape_data.get("simulation_configs", [])
        ),
        "active_simulation_index": soundscape_data.get(
            "active_simulation_index", -1
        ),
    }

    return (
        soundscape_collection,
        len(source_points),
        len(receiver_points),
        materials_modified,
    )


# ---------------------------------------------------------------------------
# Parse (load direction)
# ---------------------------------------------------------------------------

def parse_soundscape_collection(
    soundscape_collection: Base,
    model_id: str,
) -> Optional[dict]:
    """Reconstruct a soundscape data dict from a Soundscape Collection.

    Reads the ``properties`` stored on the Collection and returns a dict
    compatible with ``SoundscapeData``.

    Args:
        soundscape_collection: The Speckle Collection named "Soundscape".
        model_id: The Speckle model ID (fallback for properties).

    Returns:
        dict suitable for constructing ``SoundscapeData``, or None.
    """
    props = getattr(soundscape_collection, "properties", None)
    if not isinstance(props, dict):
        return None

    def _load(key, default):
        val = props.get(key, default)
        if isinstance(val, str):
            try:
                return json.loads(val)
            except (json.JSONDecodeError, TypeError):
                pass
        return val

    soundscape = {
        "version": props.get("version", "1.0"),
        "model_id": props.get("model_id", model_id),
        "model_name": props.get("model_name", ""),
        "created_at": props.get("created_at", ""),
        "global_settings": _load("global_settings", {}),
        "sound_configs": _load("sound_configs", []),
        "sound_events": _load("sound_events", []),
        "receivers": _load("receivers", []),
        "selected_receiver_id": props.get("selected_receiver_id") or None,
        "simulation_configs": _load("simulation_configs", []),
        "active_simulation_index": props.get("active_simulation_index"),
    }

    # Clean sentinel values
    if soundscape["active_simulation_index"] == -1:
        soundscape["active_simulation_index"] = None
    if soundscape["selected_receiver_id"] == "":
        soundscape["selected_receiver_id"] = None

    return soundscape
