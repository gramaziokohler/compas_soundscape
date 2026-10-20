# backend/services/speckle_version_service.py
# Version history of a Speckle model, as the user thinks of it.
#
# Every model uploaded through the app produces TWO raw Speckle versions: the
# bundle-only version created by Speckle's file ingestion (unreadable by the
# pinned viewer) and the legacy copy the app materializes from it (see
# speckle.mdc § File Uploads). Healing can add further copies of the same
# bundle. This module collapses that into one entry per user-visible version:
# the loadable copy's id, carrying the bundle's author / source / file name.

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from gql import gql

from config.constants import (
    SPECKLE_INGESTION_HISTORY_LIMIT,
    SPECKLE_LEGACY_COPY_SOURCE_APP,
    SPECKLE_VERSIONS_FETCH_LIMIT,
)

logger = logging.getLogger(__name__)

_INGESTION_HISTORY_QUERY = gql(
    """
    query ModelIngestionHistory($projectId: String!, $modelId: String!, $limit: Int!) {
        project(id: $projectId) {
            model(id: $modelId) {
                ingestionHistory(input: { limit: $limit }) {
                    items { versionId sourceData { fileName } }
                }
            }
        }
    }
    """
)


def _is_bundle(version) -> bool:
    return (getattr(version, "referenced_object", "") or "").startswith("bundle.")


def _is_legacy_copy(version) -> bool:
    return getattr(version, "source_application", None) == SPECKLE_LEGACY_COPY_SOURCE_APP


def _ingested_file_names(service, model_id: str) -> Dict[str, str]:
    """versionId → original uploaded file name, from Speckle's ingestion history."""
    try:
        response = service.client.httpclient.execute(
            _INGESTION_HISTORY_QUERY,
            variable_values={
                "projectId": service.project_id,
                "modelId": model_id,
                "limit": SPECKLE_INGESTION_HISTORY_LIMIT,
            },
        )
        items = (
            ((response or {}).get("project") or {}).get("model") or {}
        ).get("ingestionHistory", {}).get("items") or []
        return {
            item["versionId"]: item["sourceData"]["fileName"]
            for item in items
            if item.get("versionId")
            and (item.get("sourceData") or {}).get("fileName")
        }
    except Exception as exc:  # noqa: BLE001 — file names are best-effort metadata
        logger.warning(f"Could not read ingestion history for model {model_id}: {exc}")
        return {}


def list_model_versions(service, model_id: str) -> Optional[Dict]:
    """
    User-visible version history of a model, newest first.

    Returns ``{model_id, model_name, versions: [...], total_count}`` where each
    version is ``{id, number, created_at, author_name, source_application,
    message, file_name, is_latest}``. ``id`` is always a viewer-loadable
    version (never a bundle), ``number`` counts from 1 (oldest). Returns
    ``None`` when unauthenticated or the model is missing.
    """
    if not service.client or not service.project_id:
        logger.error("Not authenticated or no project selected.")
        return None

    try:
        mwv = service.client.model.get_with_versions(
            model_id=model_id,
            project_id=service.project_id,
            versions_limit=SPECKLE_VERSIONS_FETCH_LIMIT,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"list_model_versions failed for model {model_id}: {exc}")
        return None
    if not mwv:
        return None

    raw = list(mwv.versions.items) if mwv.versions else []
    file_names = _ingested_file_names(service, model_id)

    entries: List[Dict] = []
    # Raw versions arrive newest first; walk oldest → newest so each legacy copy
    # attaches to the bundle it was materialized from (the latest bundle before it).
    last_bundle = None
    last_bundle_entry: Optional[Dict] = None
    for version in reversed(raw):
        if _is_bundle(version):
            last_bundle = version
            last_bundle_entry = None
            continue

        serialized = service._serialize_version(version)
        if _is_legacy_copy(version) and last_bundle is not None:
            origin = service._serialize_version(last_bundle)
            entry = {
                "id": version.id,
                "created_at": origin.get("created_at") or serialized.get("created_at"),
                "author_name": origin.get("author_name") or serialized.get("author_name"),
                "source_application": origin.get("source_application"),
                "message": origin.get("message") or None,
                "file_name": file_names.get(last_bundle.id) or file_names.get(version.id),
            }
            if last_bundle_entry is not None:
                # A healed re-copy of the same bundle replaces the earlier copy.
                last_bundle_entry.update(entry)
                continue
            last_bundle_entry = entry
            entries.append(entry)
            continue

        entries.append({
            "id": version.id,
            "created_at": serialized.get("created_at"),
            "author_name": serialized.get("author_name"),
            "source_application": serialized.get("source_application"),
            "message": serialized.get("message") or None,
            "file_name": file_names.get(version.id),
        })

    for number, entry in enumerate(entries, start=1):
        entry["number"] = number
        entry["is_latest"] = number == len(entries)

    entries.reverse()
    return {
        "model_id": model_id,
        "model_name": getattr(mwv, "display_name", None) or getattr(mwv, "name", None) or model_id,
        "versions": entries,
        "total_count": len(entries),
    }
