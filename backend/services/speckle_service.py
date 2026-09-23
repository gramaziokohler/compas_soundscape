# backend/services/speckle_service.py
# Speckle Integration Service
"""
Speckle Service for Cloud-Based 3D Geometry Management

This service provides integration with Speckle (https://speckle.systems) for
cloud-based storage and versioning of 3D geometry files.

Usage Example:
    ```python
    from services.speckle_service import SpeckleService
    
    # Initialize service
    service = SpeckleService()
    
    # Authenticate with Speckle
    if service.authenticate():
        # Get or create project
        project_id = service.get_or_create_project()
        
        # Upload a model
        result = service.upload_model(
            file_path="model.3dm",
            file_type="3dm",
            model_name="My Model"
        )
        
        if result:
            print(f"Model uploaded: {result['url']}")
            
        # List all models in project
        models = service.list_project_models()
    ```

Requirements:
    - SPECKLE_TOKEN environment variable must be set in .env file
    - User must have a workspace created on app.speckle.systems

Documentation:
    - https://docs.speckle.systems/developers/python.html
    - https://docs.speckle.systems/developers/python-examples.html
"""

import os
import json
import logging
import threading
from typing import Optional, Dict, List
from dotenv import load_dotenv
from gql import gql

from specklepy.api.client import SpeckleClient
from specklepy.api import operations
from specklepy.transports.server import ServerTransport
from specklepy.api.inputs.project_inputs import WorkspaceProjectCreateInput
from specklepy.api.inputs.model_inputs import CreateModelInput
from specklepy.api.inputs.version_inputs import CreateVersionInput
from specklepy.objects import Base
from specklepy.objects.data_objects import DataObject

from utils.geometry import canonical_object_id

from config.constants import (
    SPECKLE_SERVER_URL,
    SPECKLE_PROJECT_NAME,
    SPECKLE_SUPPORTED_FORMATS,
    REDIS_URL,
)


logger = logging.getLogger(__name__)

# Speckle's 2026.9 file ingestion creates *bundle-only* versions (referencedObject
# `bundle.<project>.<model>.<version>`) whose data lives in parquet artifacts on the
# `/api/v2` rail — there is no legacy object graph. The web viewer pinned in this app
# (and the acoustic pipeline) can only read classic object graphs, so a bundle version
# is re-materialized once into a normal version and the result is cached here (keyed by
# the bundle version id) to keep polled ingestion checks idempotent.
_LEGACY_VERSION_CACHE: Dict[str, Dict[str, str]] = {}
_LEGACY_VERSION_LOCK = threading.Lock()
_MATERIALIZE_LOCK = threading.Lock()
# ``v3`` prefix invalidates cached mappings created before ``created_at`` was
# included (needed by the frontend version watcher to tell a real new publish
# from a re-materialized copy).
_LEGACY_VERSION_REDIS_PREFIX = "speckle:legacy_version:v3:"
_redis_client = None

# Appended to the version message of every legacy copy created with the viewer-safe
# projection. A copy whose message lacks it predates the displayValue applicationId
# fix and is re-materialized on demand (see ``ensure_model_ready``).
_PROJECTION_FIX_MARKER = "[geo-fix-v1]"
_LEGACY_VERSION_MESSAGE = (
    f"Legacy copy materialized for the soundscape viewer {_PROJECTION_FIX_MARKER}"
)


def _get_redis():
    """Lazily create a short-timeout sync Redis client (best-effort cache)."""
    global _redis_client
    if _redis_client is None:
        import redis as _redis

        _redis_client = _redis.from_url(
            REDIS_URL, decode_responses=True, socket_connect_timeout=2, socket_timeout=2
        )
    return _redis_client


def _cache_get_legacy_version(bundle_version_id: str) -> Optional[Dict[str, str]]:
    with _LEGACY_VERSION_LOCK:
        cached = _LEGACY_VERSION_CACHE.get(bundle_version_id)
    if cached:
        return cached
    try:
        raw = _get_redis().get(_LEGACY_VERSION_REDIS_PREFIX + bundle_version_id)
        if raw:
            data = json.loads(raw)
            with _LEGACY_VERSION_LOCK:
                _LEGACY_VERSION_CACHE[bundle_version_id] = data
            return data
    except Exception as exc:
        logger.warning(f"Legacy-version Redis cache read failed: {exc}")
    return None


def _cache_set_legacy_version(bundle_version_id: str, data: Dict[str, str]) -> None:
    with _LEGACY_VERSION_LOCK:
        _LEGACY_VERSION_CACHE[bundle_version_id] = data
    try:
        _get_redis().set(
            _LEGACY_VERSION_REDIS_PREFIX + bundle_version_id, json.dumps(data)
        )
    except Exception as exc:
        logger.warning(f"Legacy-version Redis cache write failed: {exc}")


def _strip_display_geometry_application_ids(base: Base) -> bool:
    """Remove ``applicationId`` from every ``displayValue`` mesh in a projected tree.

    The bundle projection (``specklepy.bundle.base_projection``) stamps each host
    object's ``applicationId`` onto its ``displayValue`` meshes too, so every id
    resolves to TWO nodes in the viewer's world tree. ``@speckle/viewer``'s
    ``convertInstances`` seeds its consumable counter with the number of *unique*
    instance-definition members but decrements it once per matching node — the counter
    reaches zero before the tail of the definition geometry is visited and the viewer
    logs ``Consumable applicationId def-geo-… could not be found``, dropping the
    instanced geometry (broken model). Connector-published models never put
    ``applicationId`` on displayValue meshes, so stripping the duplicates restores a
    one-to-one id → node mapping and keeps the counter exact.

    Returns True if anything was stripped.
    """
    changed = False
    visited: set[int] = set()

    def walk(obj: Base) -> None:
        nonlocal changed
        if id(obj) in visited:
            return
        visited.add(id(obj))

        display = getattr(obj, "displayValue", None)
        if display is not None:
            meshes = display if isinstance(display, list) else [display]
            for mesh in meshes:
                if isinstance(mesh, Base) and getattr(mesh, "applicationId", None) is not None:
                    mesh.applicationId = None
                    changed = True

        for name in obj.get_member_names():
            value = getattr(obj, name, None)
            if isinstance(value, Base):
                walk(value)
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, Base):
                        walk(item)

    walk(base)
    return changed


class SpeckleService:
    """Service for managing Speckle integration"""

    def __init__(self):
        """Initialize SpeckleService"""
        self.client: Optional[SpeckleClient] = None
        self.project_id: Optional[str] = None
        self.workspace_id: Optional[str] = None
        self.auth_token: Optional[str] = None
        load_dotenv()

    def authenticate(self) -> bool:
        """
        Authenticate with Speckle using SPECKLE_TOKEN environment variable.

        Returns:
            bool: True if authentication successful, False otherwise
        """
        try:
            from services.runtime_config import resolve_speckle_token
            token = resolve_speckle_token()
        except Exception:
            token = os.getenv("SPECKLE_TOKEN")
        if not token:
            logger.error("SPECKLE_TOKEN is not configured (env var or Redis runtime config)")
            return False

        try:
            # Create and authenticate client
            self.client = SpeckleClient(host=SPECKLE_SERVER_URL)
            self.client.authenticate_with_token(token)
            self.auth_token = token  # Store for frontend use

            logger.info(f"Authenticated as {self.client.account.userInfo.name}")

            # Fetch and store workspace
            workspaces = self.client.active_user.get_workspaces()
            if not workspaces.items:
                logger.error("No workspaces found. Please create a workspace on app.speckle.systems")
                return False

            # Use the first available workspace
            self.workspace_id = workspaces.items[0].id
            logger.info(f"Using workspace: {workspaces.items[0].name} ({self.workspace_id})")

            return True

        except Exception as e:
            logger.error(f"Authentication failed: {str(e)}")
            return False

    def get_or_create_project(self, name: str = None) -> Optional[str]:
        """
        Get existing project or create new 'soundscape-viewer' project.

        Args:
            name: Project name (defaults to SPECKLE_PROJECT_NAME from constants)

        Returns:
            str: Project ID if successful, None otherwise
        """
        if not self.client or not self.workspace_id:
            logger.error("Not authenticated. Call authenticate() first.")
            return None

        try:
            # Allow runtime override of project name via os.environ
            project_name = name or os.environ.get("SPECKLE_PROJECT_NAME", SPECKLE_PROJECT_NAME)

            # Check if project already exists
            projects_response = self.client.active_user.get_projects()
            if hasattr(projects_response, 'items'):
                for project in projects_response.items:
                    if project.name == project_name:
                        self.project_id = project.id
                        logger.info(f"Using existing project: {project_name} ({self.project_id})")
                        return self.project_id

            # Create new project
            project = self.client.project.create_in_workspace(
                WorkspaceProjectCreateInput(
                    name=project_name,
                    description="Soundscape Viewer - 3D models for acoustic simulation",
                    visibility="PRIVATE",
                    workspaceId=self.workspace_id
                )
            )

            self.project_id = project.id
            logger.info(f"Created new project: {project_name} ({self.project_id})")
            return self.project_id

        except Exception as e:
            logger.error(f"Failed to get or create project: {str(e)}")
            return None

    def _get_or_create_model(self, model_name: str, file_type: str, file_name: str):
        """
        Get existing model by name or create a new one.

        When uploading a file with the same name as an existing model, this will
        return the existing model, allowing the file import to create a new version
        instead of failing with a duplicate name error.

        Args:
            model_name: Name of the model to find or create
            file_type: File extension (3dm, obj, ifc)
            file_name: Original filename

        Returns:
            Model object from Speckle

        Raises:
            Exception: If both retrieval and creation fail
        """
        # Use GraphQL query to fetch models directly for better reliability
        def fetch_model_by_name(name: str):
            """Fetch model using GraphQL query"""
            try:
                query = gql("""
                query GetProjectModels($projectId: String!) {
                    project(id: $projectId) {
                        models {
                            totalCount
                            items {
                                id
                                name
                                description
                            }
                        }
                    }
                }
                """)

                result = self.client.httpclient.execute(
                    query, variable_values={"projectId": self.project_id}
                )
                models = result.get("project", {}).get("models", {}).get("items", [])

                logger.info(f"Found {len(models)} models in project")
                logger.debug(f"Model names: {[m['name'] for m in models]}")

                # Try exact match first
                for m in models:
                    if m["name"] == name:
                        logger.info(f"Found existing model (exact match) '{name}': {m['id']} - will create new version")
                        # Return a simple object with id attribute
                        class ModelRef:
                            def __init__(self, model_id):
                                self.id = model_id
                        return ModelRef(m["id"])

                # Try case-insensitive match as fallback
                for m in models:
                    if m["name"].lower() == name.lower():
                        logger.info(f"Found existing model (case-insensitive) '{m['name']}': {m['id']} - will create new version")
                        class ModelRef:
                            def __init__(self, model_id):
                                self.id = model_id
                        return ModelRef(m["id"])

                return None

            except Exception as e:
                logger.warning(f"GraphQL query for models failed: {e}")
                return None

        # First, try to find existing model with this name
        logger.info(f"Searching for existing model: {model_name}")
        existing_model = fetch_model_by_name(model_name)
        if existing_model:
            return existing_model

        # Model doesn't exist, create a new one
        logger.info(f"No existing model found. Creating new model: {model_name}")
        try:
            model_input = CreateModelInput(
                project_id=self.project_id,
                name=model_name,
                description=f"Uploaded {file_type} file: {file_name}"
            )
            model = self.client.model.create(model_input)
            logger.info(f"Created new model: {model.id}")
            return model
        except Exception as create_error:
            # If creation fails due to name conflict, try fetching one more time
            # This handles race conditions where model was created between our check and creation
            logger.warning(f"Model creation failed (likely duplicate name): {create_error}")
            logger.info("Attempting to retrieve existing model using GraphQL...")

            existing_model = fetch_model_by_name(model_name)
            if existing_model:
                logger.info(f"Successfully retrieved existing model after creation failure - will create new version")
                return existing_model

            # If we still can't find it, raise a clear error
            logger.error(f"Model exists but cannot be retrieved. Available models: {fetch_model_by_name('')}")
            raise Exception(f"Could not create or find model '{model_name}'. The model exists but cannot be retrieved. Error: {create_error}")

    def _materialize_legacy_version(self, bundle_version_id: str) -> Optional[Dict[str, str]]:
        """
        Convert a bundle-only version into a classic legacy version the app can load.

        Speckle's new ingestion stores uploaded files as bundles with no legacy object
        graph. This reads the bundle (``operations.receive`` dispatches on the
        ``bundle.`` reference), re-sends it as a normal object graph, and creates a
        new version pointing at it. The web viewer and the acoustic pipeline then work
        exactly as they do for connector-published models.

        Args:
            bundle_version_id: A version id whose ``referencedObject`` is a bundle ref.

        Returns:
            dict: {"version_id", "object_id"} of the legacy version, or None on failure.
        """
        cached = _cache_get_legacy_version(bundle_version_id)
        if cached:
            return cached

        if not self.client or not self.project_id:
            logger.error("Not authenticated or no project selected.")
            return None

        try:
            # Serialize the heavy materialization: concurrent ingestion polls must not
            # each download + re-send the (potentially large) bundle.
            with _MATERIALIZE_LOCK:
                cached = _cache_get_legacy_version(bundle_version_id)
                if cached:
                    return cached

                version = self.client.version.get(
                    version_id=bundle_version_id, project_id=self.project_id
                )
                referenced_object = getattr(version, "referenced_object", None)
                if not referenced_object:
                    logger.error(f"Version {bundle_version_id} has no referenced object")
                    return None

                # Already a classic object graph — nothing to materialize.
                if not referenced_object.startswith("bundle."):
                    result = {
                        "version_id": version.id,
                        "object_id": referenced_object,
                        "created_at": (
                            version.created_at.isoformat()
                            if getattr(version, "created_at", None)
                            else None
                        ),
                    }
                    _cache_set_legacy_version(bundle_version_id, result)
                    return result

                # bundle.<projectId>.<modelId>.<versionId>
                parts = referenced_object.split(".")
                if len(parts) != 4:
                    logger.error(f"Unrecognized bundle reference: {referenced_object}")
                    return None
                bundle_model_id = parts[2]

                logger.info(
                    f"Materializing bundle version {bundle_version_id} into a legacy version..."
                )
                transport = ServerTransport(stream_id=self.project_id, client=self.client)
                base = operations.receive(referenced_object, remote_transport=transport)
                # Drop the projection's duplicate applicationIds on displayValue meshes —
                # otherwise the viewer's instance counter stops early and instances break.
                if _strip_display_geometry_application_ids(base):
                    logger.info(
                        "Stripped duplicate displayValue applicationIds from projection "
                        f"of {bundle_version_id}"
                    )
                legacy_object_id = operations.send(base, [transport])
                legacy_version = self.client.version.create(
                    CreateVersionInput(
                        project_id=self.project_id,
                        model_id=bundle_model_id,
                        object_id=legacy_object_id,
                        message=_LEGACY_VERSION_MESSAGE,
                        source_application="compas-soundscape",
                    )
                )

                result = {
                    "version_id": legacy_version.id,
                    "object_id": legacy_object_id,
                    "created_at": (
                        legacy_version.created_at.isoformat()
                        if getattr(legacy_version, "created_at", None)
                        else None
                    ),
                }
                _cache_set_legacy_version(bundle_version_id, result)
                logger.info(
                    f"Materialized {bundle_version_id} -> legacy version "
                    f"{legacy_version.id} (object {legacy_object_id})"
                )
                return result
        except Exception as exc:
            logger.error(f"Failed to materialize bundle version {bundle_version_id}: {exc}")
            import traceback
            logger.error(traceback.format_exc())
            return None

    def ensure_model_ready(self, model_id: str) -> Optional[Dict[str, str]]:
        """Return a viewer-loadable ``{version_id, object_id}`` for a model.

        The app's model loader resolves a model URL to its *latest* version, so a model
        whose latest version is a bundle (never materialized) or a legacy copy created
        before the displayValue applicationId fix cannot render correctly. This looks at
        the latest version and, when needed, re-materializes the underlying bundle so the
        newly created (latest) version is viewer-safe. No-op for connector versions.

        Best-effort: returns ``None`` when unauthenticated; otherwise the current
        ``{version_id, object_id}`` even if healing could not be performed.
        """
        if not self.client or not self.project_id:
            logger.error("Not authenticated or no project selected.")
            return None

        try:
            mwv = self.client.model.get_with_versions(
                model_id=model_id, project_id=self.project_id, versions_limit=5
            )
            versions = list(mwv.versions.items) if mwv and mwv.versions else []
            if not versions:
                return None

            latest = versions[0]
            ref = getattr(latest, "referenced_object", None) or ""
            source_app = getattr(latest, "source_application", None)
            message = getattr(latest, "message", None) or ""

            # Latest is still a bundle-only version → materialize it.
            if ref.startswith("bundle."):
                healed = self._materialize_legacy_version(latest.id)
                if healed:
                    return healed
                return {
                    "version_id": latest.id,
                    "object_id": ref,
                    "created_at": (
                        latest.created_at.isoformat()
                        if getattr(latest, "created_at", None)
                        else None
                    ),
                }

            # A copy we materialized before the geometry fix → re-materialize from the
            # newest bundle version still present in the model.
            if source_app == "compas-soundscape" and _PROJECTION_FIX_MARKER not in message:
                bundle_version = next(
                    (
                        v
                        for v in versions
                        if (getattr(v, "referenced_object", "") or "").startswith("bundle.")
                    ),
                    None,
                )
                if bundle_version is not None:
                    healed = self._materialize_legacy_version(bundle_version.id)
                    if healed:
                        logger.info(
                            f"Healed pre-fix legacy copy {latest.id} for model {model_id} "
                            f"-> {healed['version_id']}"
                        )
                        return healed

            return {
                "version_id": latest.id,
                "object_id": ref,
                "created_at": (
                    latest.created_at.isoformat()
                    if getattr(latest, "created_at", None)
                    else None
                ),
            }
        except Exception as exc:
            logger.warning(f"ensure_model_ready failed for model {model_id}: {exc}")
            return None

    def get_model_latest_version(self, model_id: str) -> Optional[Dict]:
        """Read-only: return the latest version summary for a model.

        Used by the frontend version watcher to detect a newer commit without
        triggering the materialization side-effects of ``ensure_model_ready``.
        Returns ``{version_id, object_id, created_at, author_name,
        source_application, message}`` or ``None`` when unauthenticated/missing.
        """
        if not self.client or not self.project_id:
            logger.error("Not authenticated or no project selected.")
            return None

        try:
            mwv = self.client.model.get_with_versions(
                model_id=model_id, project_id=self.project_id, versions_limit=1
            )
            versions = list(mwv.versions.items) if mwv and mwv.versions else []
            if not versions:
                return None
            latest = versions[0]
            serialized = self._serialize_version(latest)
            return {
                "version_id": latest.id,
                "object_id": serialized.get("referenced_object") or latest.id,
                "created_at": serialized.get("created_at"),
                "author_name": serialized.get("author_name"),
                "source_application": serialized.get("source_application"),
                "message": serialized.get("message"),
            }
        except Exception as exc:
            logger.warning(f"get_model_latest_version failed for model {model_id}: {exc}")
            return None

    def get_ingestion_status(self, ingestion_id: str) -> Optional[Dict]:
        """
        Read the current status of a Speckle file ingestion job (single, non-blocking probe).

        `fileUploadMutations.startFileIngestion` is asynchronous: the model version
        (and therefore the object the viewer loads) is only created once ingestion
        succeeds. The client polls this to know when the new model is loadable and
        to obtain the resolved version/object ids.

        Args:
            ingestion_id: The `id` returned by `startFileIngestion`.

        Returns:
            dict: {status, progress_message, version_id, object_id, error} or None on
            transport failure. `status` is the ModelIngestionStatus enum value
            (queued | processing | success | failed | cancelled | invalid).
        """
        if not self.client or not self.project_id:
            logger.error("Not authenticated or no project selected.")
            return None

        status_query = gql("""
        query IngestionStatus($ingestionId: ID!, $projectId: String!) {
            project(id: $projectId) {
                ingestion(id: $ingestionId) {
                    statusData {
                        ... on ModelIngestionQueuedStatus { status progressMessage }
                        ... on ModelIngestionProcessingStatus { status progressMessage }
                        ... on ModelIngestionSuccessStatus { status versionId }
                        ... on ModelIngestionFailedStatus { status errorReason }
                        ... on ModelIngestionCancelledStatus { status }
                        ... on ModelIngestionInvalidStatus { status }
                    }
                }
            }
        }
        """)

        try:
            result = self.client.httpclient.execute(
                status_query,
                variable_values={"ingestionId": ingestion_id, "projectId": self.project_id},
            )
            status_data = (
                (result.get("project") or {}).get("ingestion") or {}
            ).get("statusData") or {}
        except Exception as exc:
            logger.warning(f"Ingestion status query failed: {exc}")
            return None

        status = status_data.get("status")
        version_id = status_data.get("versionId")
        progress_message = status_data.get("progressMessage")
        object_id = None

        if status == "success" and version_id:
            # The ingested version is bundle-only; convert it into a classic version the
            # viewer/simulation pipeline can read. If that fails we report no ids so the
            # client keeps polling rather than loading an unreadable bundle reference.
            legacy = self._materialize_legacy_version(version_id)
            if legacy:
                version_id = legacy["version_id"]
                object_id = legacy["object_id"]
            else:
                logger.error(
                    f"Ingestion {ingestion_id} succeeded but {version_id} could not be "
                    "materialized into a readable legacy version"
                )
                return {
                    "status": status,
                    "progress_message": "Preparing the model for the viewer...",
                    "version_id": None,
                    "object_id": None,
                    "error": None,
                }

        return {
            "status": status,
            "progress_message": progress_message,
            "version_id": version_id,
            "object_id": object_id,
            "error": status_data.get("errorReason"),
        }

    def upload_model(self, file_path: str, file_type: str, model_name: str = None) -> Optional[Dict]:
        """
        Upload 3dm/obj/ifc file to Speckle using the file upload API.

        This follows the proper Speckle file upload workflow:
        1. Generate presigned upload URL
        2. Upload file to S3
        3. Get or create model (reuses existing model to create new version)
        4. Trigger file ingestion (startFileIngestion) — asynchronous on Speckle's side
        5. Return model_id + URL + ingestion_id; the client polls for the created version

        **Version Handling:**
        - If a model with the same name exists, the file will be uploaded as a NEW VERSION
        - If no model exists, a new model will be created with the file as version 1
        - This prevents "branch already exists" errors when re-uploading files

        Args:
            file_path: Path to the file to upload
            file_type: File extension (3dm, obj, ifc)
            model_name: Optional custom model name (defaults to filename without extension)

        Returns:
            dict: {model_id, version_id, file_id, url} if successful, None otherwise
        """
        import requests
        
        if not self.client or not self.project_id:
            logger.error("Not authenticated or no project selected.")
            return None

        if file_type.lower() not in SPECKLE_SUPPORTED_FORMATS:
            logger.error(f"Unsupported file type: {file_type}")
            return None

        try:
            file_name = os.path.basename(file_path)
            logger.info(f"Uploading {file_type} file to Speckle: {file_name}")

            # Step 1: Generate upload URL
            logger.info("Step 1/5: Generating upload URL...")
            generate_url_mutation = gql("""
            mutation GenerateFileUploadUrl($input: GenerateFileUploadUrlInput!) {
                fileUploadMutations {
                    generateUploadUrl(input: $input) {
                        url
                        fileId
                    }
                }
            }
            """)
            
            variables = {
                "input": {
                    "fileName": file_name,
                    "projectId": self.project_id
                }
            }
            
            response = self.client.httpclient.execute(
                generate_url_mutation, variable_values=variables
            )
            upload_url = response["fileUploadMutations"]["generateUploadUrl"]["url"]
            file_id = response["fileUploadMutations"]["generateUploadUrl"]["fileId"]
            logger.info(f"Got upload URL and file ID: {file_id}")

            # Step 2: Upload file to S3
            logger.info("Step 2/5: Uploading file to S3...")
            with open(file_path, 'rb') as f:
                file_data = f.read()
            
            upload_response = requests.put(
                upload_url,
                data=file_data,
                headers={'Content-Type': 'application/octet-stream'}
            )
            
            if upload_response.status_code != 200:
                logger.error(f"S3 upload failed with status {upload_response.status_code}")
                return None
            
            etag = upload_response.headers.get('ETag', '').strip('"')
            logger.info(f"File uploaded to S3, ETag: {etag}")

            # Step 3: Get or create model (reuse existing to create new version)
            logger.info("Step 3/5: Getting or creating model...")
            if not model_name:
                model_name = os.path.splitext(file_name)[0]

            model = self._get_or_create_model(model_name, file_type, file_name)

            # Step 4: Trigger file ingestion
            # NOTE: `startFileImport` was removed from the Speckle Server GraphQL API
            # (2026.9 release) — calling it now fails with a 400 UNSUPPORTED_FILE_TYPE.
            # The replacement is `fileUploadMutations.startFileIngestion`, which takes the
            # same `StartFileImportInput` and returns a `ModelIngestion` with a `statusData` union.
            logger.info("Step 4/5: Triggering file ingestion...")
            start_ingestion_mutation = gql("""
            mutation StartFileIngestion($input: StartFileImportInput!) {
                fileUploadMutations {
                    startFileIngestion(input: $input) {
                        id
                        statusData {
                            ... on ModelIngestionQueuedStatus { status }
                            ... on ModelIngestionProcessingStatus { status }
                            ... on ModelIngestionSuccessStatus { status }
                            ... on ModelIngestionFailedStatus { status }
                            ... on ModelIngestionCancelledStatus { status }
                            ... on ModelIngestionInvalidStatus { status }
                        }
                    }
                }
            }
            """)
            
            import_variables = {
                "input": {
                    "etag": f'"{etag}"',  # Must be double-quoted
                    "fileId": file_id,
                    "modelId": model.id,
                    "projectId": self.project_id
                }
            }
            
            import_response = self.client.httpclient.execute(
                start_ingestion_mutation, variable_values=import_variables
            )
            ingestion = import_response["fileUploadMutations"]["startFileIngestion"]
            ingestion_id = ingestion["id"]
            import_status = (ingestion.get("statusData") or {}).get("status")
            logger.info(f"File ingestion started: {ingestion_id}, status: {import_status}")

            # Step 5: Return immediately — ingestion runs asynchronously on Speckle.
            # The client polls `get_ingestion_status(ingestion_id)` until the version exists,
            # then loads the model. We must NOT return the ingestion id as `version_id`: for
            # simulations the app needs the real version id, which only exists after ingestion.
            viewer_url = f"https://{SPECKLE_SERVER_URL}/projects/{self.project_id}/models/{model.id}"

            result = {
                "model_id": model.id,
                "version_id": "",          # resolved by the client once ingestion succeeds
                "file_id": file_id,
                "url": viewer_url,
                "object_id": "",
                "ingestion_id": ingestion_id,
            }

            logger.info(f"File upload initiated: {result['url']} (ingestion {ingestion_id})")
            logger.info("Ingestion is async — client polls for status until the model is ready")
            return result

        except Exception as e:
            logger.error(f"Failed to upload model: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return None

    def get_model_geometry(self, project_id: str, version_id_or_object_id: str, layer_name: str = None, object_ids_filter: list = None) -> Optional[Dict]:
        """
        Retrieve geometry from Speckle version or object using display values.
        
        Extracts mesh geometry from Speckle objects based on their displayValue property.
        Follows the Speckle display values pattern:
        https://docs.speckle.systems/developers/sdks/python/concepts/display-values
        
        Process:
        1. Tries to fetch version metadata using client.version.get() to get the referencedObject ID
        2. If version lookup fails, treats the ID as an object ID directly
        3. Uses operations.receive() with the object ID to retrieve the actual data
        4. Extracts geometry from displayValue properties
        
        Args:
            project_id: Speckle project ID
            version_id_or_object_id: Version ID or Object ID - will try version first, fallback to object ID
            layer_name: Optional layer name to filter objects (e.g., "Acoustics")

        Returns:
            dict: {
                "vertices": [[x,y,z], ...],
                "faces": [[v0,v1,v2], ...],
                "object_ids": [object_id1, object_id2, ...],
                "object_names": [name1, name2, ...],
                "object_face_ranges": {"obj_id": [start_face, end_face], ...}
            }
        """
        if not self.client:
            logger.error("Not authenticated.")
            return None

        try:
            from specklepy.objects.geometry import Mesh
            from specklepy.objects import Base
            
            # Try to get version metadata first
            object_id_to_receive = None
            
            try:
                logger.info(f"Attempting to fetch version metadata: {version_id_or_object_id}")
                version = self.client.version.get(version_id=version_id_or_object_id, project_id=project_id)
                
                if version:
                    # specklepy uses snake_case; fall back to camelCase for older SDK versions
                    ref_obj = (
                        getattr(version, "referenced_object", None)
                        or getattr(version, "referencedObject", None)
                    )
                    if ref_obj:
                        logger.info(f"Version found. Referenced Object ID: {ref_obj}")
                        object_id_to_receive = ref_obj
                    else:
                        logger.warning(f"Version lookup succeeded but no referenced_object found")
                        raise Exception("No referenced_object in version")
                else:
                    raise Exception("Version lookup returned None")
            except Exception as version_error:
                # Version lookup failed - try to get latest version from model
                logger.info(f"Version lookup failed: {str(version_error)}")
                logger.info(f"Attempting to get latest version for model: {version_id_or_object_id}")
                
                try:
                    # Try to get versions for this model (treating the ID as model_id)
                    versions = self.client.version.get_versions(
                        model_id=version_id_or_object_id,
                        project_id=project_id,
                        limit=1  # Get just the latest version
                    )
                    
                    logger.info(f"get_versions returned {len(versions.items) if versions and versions.items else 0} items")
                    
                    if versions and versions.items and len(versions.items) > 0:
                        latest_version = versions.items[0]
                        
                        # Log all available attributes to find the correct field name
                        logger.info(f"Version object attributes: {dir(latest_version)}")
                        logger.info(f"Version object dict: {latest_version.__dict__ if hasattr(latest_version, '__dict__') else 'No __dict__'}")
                        
                        # Try different possible attribute names
                        ref_obj = None
                        for attr_name in ['referencedObject', 'referenced_object', 'objectId', 'object_id', 'commitId', 'commit_id']:
                            if hasattr(latest_version, attr_name):
                                ref_obj = getattr(latest_version, attr_name)
                                logger.info(f"Found object ID via attribute '{attr_name}': {ref_obj}")
                                break
                        
                        if ref_obj:
                            object_id_to_receive = ref_obj
                        else:
                            raise Exception(f"Latest version {latest_version.id} - could not find referenced object field")
                    else:
                        raise Exception(f"No versions found for model {version_id_or_object_id}")
                except Exception as model_error:
                    # All lookups failed
                    logger.error(f"All lookup methods failed: {str(model_error)}")
                    raise Exception(f"Cannot find object/version/model for ID {version_id_or_object_id}. Error: {str(model_error)}")
            
            # Create transport for this project
            transport = ServerTransport(stream_id=project_id, client=self.client)
            
            # Receive the actual object
            logger.info(f"Receiving Speckle object: {object_id_to_receive}")
            root_object = operations.receive(obj_id=object_id_to_receive, remote_transport=transport)
            
            if not root_object:
                logger.error(f"Failed to receive object {object_id_to_receive}")
                return None
            
            # Extract objects with display values
            logger.info("Extracting geometry from display values...")
            geometry_data = self._extract_geometry_from_display_values(
                root_object,
                layer_name=layer_name,
                object_ids_filter=object_ids_filter
            )
            
            logger.info(f"Extracted geometry: {len(geometry_data['vertices'])} vertices, {len(geometry_data['faces'])} faces from {len(geometry_data['object_ids'])} objects")
            return geometry_data

        except Exception as e:
            logger.error(f"Failed to retrieve geometry: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return None
    
    def _extract_geometry_from_display_values(self, root_object, layer_name: str = None, object_ids_filter: list = None) -> Dict:
        """
        Extract mesh geometry from Speckle objects using display values.
        
        Follows the Speckle SDK pattern for traversing and extracting display values.
        
        Args:
            root_object: Root Speckle object to traverse
            layer_name: Optional layer name to filter (e.g., "Acoustics")
        
        Returns:
            dict: Geometry data with vertices, faces, and object mapping
        """
        from specklepy.objects.geometry import Mesh
        from specklepy.objects import Base
        from specklepy.objects.graph_traversal.traversal import GraphTraversal
        
        logger.info(f"=== Extracting geometry with layer filter: {layer_name} ===")
        
        all_vertices = []
        all_faces = []
        object_ids = []
        object_names = []
        object_face_ranges = {}

        vertex_offset = 0
        face_count = 0

        # Unit conversion: Speckle unit string -> scale factor to meters
        _UNIT_TO_METERS = {
            "m": 1.0, "meters": 1.0, "metre": 1.0, "metres": 1.0,
            "mm": 0.001, "millimeters": 0.001, "millimetres": 0.001,
            "cm": 0.01, "centimeters": 0.01, "centimetres": 0.01,
            "ft": 0.3048, "feet": 0.3048,
            "in": 0.0254, "inches": 0.0254,
            "yd": 0.9144, "yards": 0.9144,
        }

        # Detect root-level units as fallback for meshes without their own units field
        root_units = str(getattr(root_object, 'units', None) or 'm').lower()
        root_scale = _UNIT_TO_METERS.get(root_units, 1.0)
        if root_units != 'm':
            logger.info(f"Root object units: '{root_units}' (scale {root_scale} -> meters)")

        def extract_mesh_data(mesh):
            """Extract vertices and faces from a Speckle Mesh object, scaling to meters."""
            if not isinstance(mesh, Mesh):
                return None

            if not hasattr(mesh, 'vertices') or not hasattr(mesh, 'faces'):
                return None

            # Per-mesh units override root units; default to root_units captured above
            mesh_units = str(getattr(mesh, 'units', None) or root_units).lower()
            scale = _UNIT_TO_METERS.get(mesh_units, 1.0)
            if scale != 1.0:
                logger.info(f"  Mesh units: '{mesh_units}' -> scale {scale} to meters")

            # Vertices are stored as flat list [x, y, z, x, y, z, ...]
            verts = []
            for i in range(0, len(mesh.vertices), 3):
                verts.append([
                    mesh.vertices[i] * scale,
                    mesh.vertices[i + 1] * scale,
                    mesh.vertices[i + 2] * scale,
                ])
            
            # Faces are stored with count prefix: [n, v0, v1, ..., vn-1, m, v0, v1, ...]
            faces_list = []
            i = 0
            while i < len(mesh.faces):
                n = mesh.faces[i]
                if n == 0:
                    i += 1
                    continue
                    
                face_verts = []
                for j in range(1, n + 1):
                    if i + j < len(mesh.faces):
                        face_verts.append(mesh.faces[i + j])
                
                # Triangulate
                if n == 4 and len(face_verts) == 4:
                    faces_list.append([face_verts[0], face_verts[1], face_verts[2]])
                    faces_list.append([face_verts[0], face_verts[2], face_verts[3]])
                elif n == 3 and len(face_verts) == 3:
                    faces_list.append(face_verts)
                elif n > 4:
                    for k in range(1, n - 1):
                        faces_list.append([face_verts[0], face_verts[k], face_verts[k + 1]])
                
                i += n + 1
            
            return {"vertices": verts, "faces": faces_list}
        
        # Use SDK's GraphTraversal to find all objects with displayValue
        # According to Speckle docs, GraphTraversal([]) traverses with default rules
        # which should traverse all members
        from specklepy.objects.graph_traversal.traversal import GraphTraversal
        
        logger.info("Traversing object graph to find geometry...")
        logger.info(f"Root object type: {type(root_object).__name__}")
        
        if isinstance(root_object, Base):
            logger.info(f"Root object properties: {root_object.get_member_names()}")
        else:
            logger.error(f"Root object is not a Base object! Type: {type(root_object)}")
            return {
                "vertices": [],
                "faces": [],
                "object_ids": [],
                "object_names": [],
                "object_face_ranges": {}
            }
        
        # Create traversal with default rules
        traversal_func = GraphTraversal([])
        
        # Each entry is (obj, layer_path_string)
        objects_with_display = []
        total_objects = 0
        object_types = {}
        
        # Track objects with their layer context
        def manual_traverse(obj, depth=0, current_layer=None, from_display_value=False):
            """Manually traverse object tree while tracking layer context"""
            nonlocal total_objects
            
            if not isinstance(obj, Base):
                return
            
            total_objects += 1
            obj_type = type(obj).__name__
            object_types[obj_type] = object_types.get(obj_type, 0) + 1

            # Update current layer only for pure container/group nodes.
            # A container node has a name but NO displayValue and is not a Mesh.
            # BIM objects (doors, walls, etc.) have both a name AND displayValue —
            # they must NOT overwrite the layer tracked from their parent container.
            has_display_value = hasattr(obj, 'displayValue') and obj.displayValue is not None
            is_container = (
                hasattr(obj, 'name') and obj.name
                and not isinstance(obj, Mesh)
                and not has_display_value
            )
            if is_container:
                # Build a hierarchical path so nested layers are preserved
                # e.g. "Acoustics" → child group → "Acoustics::ChildGroup"
                current_layer = (
                    f"{current_layer}::{obj.name}" if current_layer else obj.name
                )
            
            # Debug first few objects
            if total_objects <= 20:
                has_display = hasattr(obj, 'displayValue')
                display_val = getattr(obj, 'displayValue', None) if has_display else None
                indent = "  " * depth
                logger.info(f"{indent}Object #{total_objects}: type={obj_type}, has_displayValue={has_display}, displayValue={type(display_val).__name__ if display_val else 'None'}, layer={current_layer}")
                if hasattr(obj, 'name'):
                    logger.info(f"{indent}  Name: {obj.name}")
            
            # Check layer filter
            # When object_ids_filter is provided, skip layer-name filtering entirely —
            # we collect everything and filter by ID after traversal.
            should_include = True
            if object_ids_filter is None and layer_name:
                # Only include objects in the selected layer
                should_include = current_layer and current_layer.lower() == layer_name.lower()
            
            # Check if this object has displayValue OR if it IS geometry itself.
            # A Mesh that is the displayValue of a parent object must NOT be
            # emitted as a separate geometry object — the parent already
            # contributes it, and emitting both duplicates every surface (and
            # splits the material assignments onto the copy that welding drops).
            if should_include:
                if hasattr(obj, 'displayValue') and obj.displayValue is not None:
                    objects_with_display.append((obj, current_layer))
                elif isinstance(obj, Mesh) and not from_display_value:
                    # Object IS geometry (e.g., from Rhino/3dm files)
                    objects_with_display.append((obj, current_layer))
            
            # Recurse through all properties, passing the current layer context
            for prop_name in obj.get_member_names():
                value = getattr(obj, prop_name, None)
                child_from_dv = from_display_value or prop_name == "displayValue"
                
                if isinstance(value, Base):
                    manual_traverse(value, depth + 1, current_layer, child_from_dv)
                elif isinstance(value, list):
                    for item in value:
                        if isinstance(item, Base):
                            manual_traverse(item, depth + 1, current_layer, child_from_dv)
        
        manual_traverse(root_object)
        
        logger.info(f"Total objects traversed: {total_objects}")
        logger.info(f"Object types found: {object_types}")
        logger.info(f"Found {len(objects_with_display)} objects with geometry (displayValue or direct Mesh)")
        
        # The frontend keys object ids by the viewer WorldTree node id, which may
        # carry a '#<n>' duplicate suffix (and may be the applicationId). Normalize
        # both sides so an assignment/filter keyed by '<hash>#3' still matches the
        # bare '<hash>' the backend received.
        object_ids_set = None
        if object_ids_filter:
            object_ids_set = set()
            for _x in object_ids_filter:
                object_ids_set.add(_x)
                object_ids_set.add(canonical_object_id(_x))
        # Maps obj_id → layer path for downstream consumers (e.g. get_model_entities)
        object_layers: dict[str, str | None] = {}

        # Process each object with geometry
        for obj, obj_layer in objects_with_display:
            obj_id = getattr(obj, 'id', f"obj_{len(object_ids)}")
            obj_name = getattr(obj, 'name', f"Object {len(object_ids) + 1}")
            obj_app_id = getattr(obj, 'applicationId', None)  # Rhino GUID — stable across commits

            # When filtering by explicit object IDs, skip objects not in the list
            if object_ids_set is not None:
                aliases = {obj_id, canonical_object_id(obj_id)}
                if obj_app_id:
                    aliases.add(obj_app_id)
                    aliases.add(canonical_object_id(obj_app_id))
                if not (aliases & object_ids_set):
                    continue
            
            logger.info(f"Processing object: {obj_name} (id: {obj_id})")
            
            start_face = face_count
            # Extra identifier aliases contributed by this object's display meshes
            # (the frontend's viewer tree exposes those nodes too, so saved
            # assignments may be keyed by a mesh id rather than the host object).
            display_mesh_ids: set[str] = set()
            
            # Check if object IS a Mesh directly (Rhino/3dm files)
            if isinstance(obj, Mesh):
                mesh_data = extract_mesh_data(obj)
                if mesh_data:
                    # Add vertices
                    all_vertices.extend(mesh_data['vertices'])
                    
                    # Add faces with offset indices
                    for face in mesh_data['faces']:
                        offset_face = [v + vertex_offset for v in face]
                        all_faces.append(offset_face)
                        face_count += 1
                    
                    vertex_offset += len(mesh_data['vertices'])
            
            # Otherwise check for displayValue property (BIM objects)
            elif hasattr(obj, 'displayValue') and obj.displayValue is not None:
                display_val = obj.displayValue
                if not isinstance(display_val, list):
                    display_val = [display_val]
                
                # Extract geometry from each mesh in displayValue
                for mesh in display_val:
                    mesh_data = extract_mesh_data(mesh)
                    if mesh_data:
                        mesh_id = getattr(mesh, 'id', None)
                        if mesh_id:
                            display_mesh_ids.add(mesh_id)
                            display_mesh_ids.add(canonical_object_id(mesh_id))
                        # Add vertices
                        all_vertices.extend(mesh_data['vertices'])
                        
                        # Add faces with offset indices
                        for face in mesh_data['faces']:
                            offset_face = [v + vertex_offset for v in face]
                            all_faces.append(offset_face)
                            face_count += 1
                        
                        vertex_offset += len(mesh_data['vertices'])
            
            # Record object if it had geometry
            if face_count > start_face:
                object_ids.append(obj_id)
                object_names.append(obj_name)
                face_range = [start_face, face_count - 1]
                # Index by the raw id, its canonical (suffix-stripped) form, the
                # applicationId (Rhino GUID / stable id), and the display meshes'
                # ids — all under both raw and canonical forms — so the frontend
                # can send whichever id its viewer tree exposed.
                alias_keys = {obj_id, canonical_object_id(obj_id), *display_mesh_ids}
                if obj_app_id:
                    alias_keys.add(obj_app_id)
                    alias_keys.add(canonical_object_id(obj_app_id))
                for key in alias_keys:
                    if not key:
                        continue
                    object_face_ranges.setdefault(key, face_range)
                    object_layers.setdefault(key, obj_layer)
                logger.info(f"Added {face_count - start_face} faces from {obj_name} (id={obj_id}, applicationId={obj_app_id}, layer={obj_layer})")
        
        logger.info(f"Total geometry extracted: {len(all_vertices)} vertices, {len(all_faces)} faces across {len(object_ids)} objects (units: '{root_units}', scaled to meters)")

        return {
            "vertices": all_vertices,
            "faces": all_faces,
            "object_ids": object_ids,
            "object_names": object_names,
            "object_face_ranges": object_face_ranges,
            "object_layers": object_layers,
            "units": root_units,
        }

    def get_model_entities(self, project_id: str, version_id_or_object_id: str) -> list:
        """
        Extract entity metadata from a Speckle model.

        Delegates to get_model_geometry() — which already handles all version/object
        ID resolution and traversal — then derives entity dicts from the returned
        object_ids, object_names, object_face_ranges and vertex data.
        """
        geometry = self.get_model_geometry(
            project_id=project_id,
            version_id_or_object_id=version_id_or_object_id,
        )
        if not geometry or not geometry.get("object_ids"):
            logger.warning(
                f"get_model_geometry returned no objects for {version_id_or_object_id}"
            )
            return []

        vertices = geometry["vertices"]           # list of [x, y, z]
        faces = geometry["faces"]                 # list of [v0, v1, v2]
        object_ids = geometry["object_ids"]       # list of str
        object_names = geometry["object_names"]   # list of str
        object_face_ranges = geometry["object_face_ranges"]  # {id: [start, end]}
        object_layers = geometry.get("object_layers", {})   # {id: layer_path}

        entities = []
        for idx, (obj_id, obj_name) in enumerate(zip(object_ids, object_names)):
            face_range = object_face_ranges.get(obj_id)

            bounds = None
            if face_range and vertices and faces:
                start_f, end_f = face_range
                used = set()
                for face in faces[start_f: end_f + 1]:
                    used.update(face)
                obj_verts = [vertices[vi] for vi in used if vi < len(vertices)]
                if obj_verts:
                    xs = [v[0] for v in obj_verts]
                    ys = [v[1] for v in obj_verts]
                    zs = [v[2] for v in obj_verts]
                    mn = [min(xs), min(ys), min(zs)]
                    mx = [max(xs), max(ys), max(zs)]
                    ct = [(mn[i] + mx[i]) / 2 for i in range(3)]
                    bounds = {"min": mn, "max": mx, "center": ct}

            entities.append({
                "id": obj_id,
                "index": idx,
                "name": obj_name,
                "type": obj_name,
                "speckle_type": obj_name,
                "layer": object_layers.get(obj_id),
                "material": None,
                "bounds": bounds,
            })

        logger.info(f"Extracted {len(entities)} entities from {version_id_or_object_id}")
        return entities

    async def get_object_materials(
        self, 
        project_id: str, 
        version_id_or_object_id: str
    ) -> Dict[str, List[Dict[str, str]]]:
        """
        Get materials assigned to objects in a Speckle version.
        
        Args:
            project_id: Speckle project ID
            version_id_or_object_id: Version ID, model ID, or object ID
            
        Returns:
            Dict with layer names as keys and lists of objects with materials as values
        """
        try:
            root_object = await self._get_root_object(project_id, version_id_or_object_id)
            
            materials_by_layer = {}
            
            def traverse(obj, current_layer=None):
                """Recursively traverse object tree"""
                if obj is None:
                    return
                
                # Check if this is a layer
                if hasattr(obj, 'name'):
                    obj_name = obj.name
                    if obj_name and not hasattr(obj, 'displayValue'):
                        current_layer = obj_name
                
                # Check if object has material
                if hasattr(obj, 'material') and obj.material:
                    layer_key = current_layer or "Default"
                    if layer_key not in materials_by_layer:
                        materials_by_layer[layer_key] = []
                    
                    materials_by_layer[layer_key].append({
                        "id": getattr(obj, 'id', 'unknown'),
                        "name": getattr(obj, 'name', 'Unnamed'),
                        "material": obj.material
                    })
                
                # Traverse children
                if isinstance(obj, Base):
                    if hasattr(obj, 'elements') and isinstance(obj.elements, list):
                        for element in obj.elements:
                            traverse(element, current_layer)
                
                # Check for @-prefixed detached properties
                for attr_name in obj.get_member_names():
                    if attr_name.startswith('@'):
                        attr_value = getattr(obj, attr_name, None)
                        if isinstance(attr_value, (Base, list)):
                            traverse(attr_value, current_layer)
                
                # Handle lists
                if isinstance(obj, list):
                    for item in obj:
                        traverse(item, current_layer)
            
            traverse(root_object)
            return materials_by_layer
            
        except Exception as e:
            logger.error(f"Error getting object materials: {str(e)}")
            return {}

    def list_project_models(self) -> Optional[List[Dict]]:
        """
        List all models in the current project.

        Returns:
            list: List of model metadata dicts if successful, None otherwise
        """
        if not self.client or not self.project_id:
            logger.error("Not authenticated or no project selected.")
            return None

        try:
            project = self.client.project.get(self.project_id)
            models = []

            if hasattr(project, 'models') and project.models:
                for model in project.models.items:
                    models.append({
                        "id": model.id,
                        "name": model.name,
                        "description": model.description if hasattr(model, 'description') else None,
                        "created_at": model.createdAt if hasattr(model, 'createdAt') else None,
                    })

            logger.info(f"Found {len(models)} models in project")
            return models

        except Exception as e:
            logger.error(f"Failed to list models: {str(e)}")
            return None

    def get_project_models_detailed(self, project_id: str = None) -> Optional[Dict]:
        """
        Get detailed info for all models in a project, including version data.

        Uses the specklepy SDK's ModelResource to fetch models with full metadata
        (author, timestamps, preview URL) and then fetches version info for each.

        Args:
            project_id: Speckle project ID. Defaults to self.project_id.

        Returns:
            dict: {
                "project_id": str,
                "models": [
                    {
                        "id": str,
                        "name": str,
                        "display_name": str,
                        "description": str | None,
                        "created_at": str | None,
                        "updated_at": str | None,
                        "preview_url": str | None,
                        "author": {"id": str, "name": str, "avatar": str | None} | None,
                        "versions_count": int,
                        "latest_version": {
                            "id": str,
                            "message": str | None,
                            "source_application": str | None,
                            "referenced_object": str | None,
                            "created_at": str | None,
                            "author_name": str | None,
                        } | None,
                    },
                    ...
                ],
                "total_count": int,
            }
            None if not authenticated.
        """
        if not self.client:
            logger.error("Not authenticated. Call authenticate() first.")
            return None

        pid = project_id or self.project_id
        if not pid:
            logger.error("No project ID provided and no active project.")
            return None

        try:
            # Fetch paginated list of models via the SDK
            models_collection = self.client.model.get_models(project_id=pid)
            items = models_collection.items if models_collection else []
            total = models_collection.total_count if models_collection else 0

            logger.info(f"Fetched {len(items)} models (total: {total}) for project {pid}")

            detailed_models: List[Dict] = []

            for model in items:
                model_info = self._serialize_model(model)

                # Fetch version data for this model
                try:
                    model_with_versions = self.client.model.get_with_versions(
                        model_id=model.id,
                        project_id=pid,
                        versions_limit=1,
                    )
                    versions = model_with_versions.versions if model_with_versions else None

                    if versions:
                        model_info["versions_count"] = versions.total_count
                        if versions.items:
                            model_info["latest_version"] = self._serialize_version(
                                versions.items[0]
                            )
                except Exception as ver_err:
                    logger.warning(
                        f"Could not fetch versions for model {model.id}: {ver_err}"
                    )

                detailed_models.append(model_info)

            return {
                "project_id": pid,
                "models": detailed_models,
                "total_count": total,
            }

        except Exception as e:
            logger.error(f"Failed to get detailed project models: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return None

    # ------------------------------------------------------------------
    # Serialization helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _serialize_model(model) -> Dict:
        """
        Convert a specklepy Model object to a plain dict.

        Args:
            model: specklepy Model instance.

        Returns:
            dict with model metadata.
        """
        author = None
        if getattr(model, "author", None):
            author = {
                "id": model.author.id,
                "name": model.author.name,
                "avatar": getattr(model.author, "avatar", None),
            }

        return {
            "id": model.id,
            "name": model.name,
            "display_name": getattr(model, "display_name", model.name),
            "description": getattr(model, "description", None),
            "created_at": (
                model.created_at.isoformat()
                if getattr(model, "created_at", None)
                else None
            ),
            "updated_at": (
                model.updated_at.isoformat()
                if getattr(model, "updated_at", None)
                else None
            ),
            "preview_url": getattr(model, "preview_url", None),
            "author": author,
            "versions_count": 0,
            "latest_version": None,
        }

    @staticmethod
    def _serialize_version(version) -> Dict:
        """
        Convert a specklepy Version object to a plain dict.

        Args:
            version: specklepy Version instance.

        Returns:
            dict with version metadata.
        """
        author_name = None
        if getattr(version, "author_user", None):
            author_name = version.author_user.name

        return {
            "id": version.id,
            "message": getattr(version, "message", None),
            "source_application": getattr(version, "source_application", None),
            "referenced_object": getattr(version, "referenced_object", None),
            "preview_url": getattr(version, "preview_url", None),
            "created_at": (
                version.created_at.isoformat()
                if getattr(version, "created_at", None)
                else None
            ),
            "author_name": author_name,
        }

    # ------------------------------------------------------------------
    # Soundscape data persistence (save/load to Speckle)
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Soundscape DataObject helpers
    # ------------------------------------------------------------------

    _SOUNDSCAPE_DATA_OBJECT_NAME = "Soundscape"

    @staticmethod
    def _create_soundscape_data_object(
        model_id: str,
        soundscape_data: dict,
    ) -> DataObject:
        """
        Build an ``Objects.Data.DataObject`` that holds the serialised
        soundscape payload inside its ``properties`` dict.

        The DataObject constructor has a known property-descriptor bug in
        specklepy, so we use ``__new__`` + direct field assignment.
        """
        obj = DataObject.__new__(DataObject)
        Base.__init__(obj)

        obj._name = SpeckleService._SOUNDSCAPE_DATA_OBJECT_NAME
        obj._displayValue = []
        obj._properties = {
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
            "grid_listeners": json.dumps(
                soundscape_data.get("grid_listeners", [])
            ),
            "selected_receiver_id": soundscape_data.get("selected_receiver_id", ""),
            "simulation_configs": json.dumps(
                soundscape_data.get("simulation_configs", [])
            ),
            "active_simulation_index": soundscape_data.get(
                "active_simulation_index", -1
            ),
        }
        return obj

    # Speckle types recognised as a Soundscape element in the root tree
    _SOUNDSCAPE_SPECKLE_TYPES = {
        "Objects.Data.DataObject",                            # legacy
        "Speckle.Core.Models.Collections.Collection",         # new
    }

    @staticmethod
    def _find_soundscape_element(root_object) -> tuple:
        """
        Search the root object's ``@elements`` / ``elements`` list for a
        Soundscape element (DataObject *or* Collection) named
        ``_SOUNDSCAPE_DATA_OBJECT_NAME``.

        Returns:
            (elements_list, index)  – the mutable list and the index of the
            soundscape object, or (None, -1) when not found.
        """
        target = SpeckleService._SOUNDSCAPE_DATA_OBJECT_NAME
        for attr in ("@elements", "elements"):
            elements = getattr(root_object, attr, None)
            if not isinstance(elements, list):
                continue
            for idx, elem in enumerate(elements):
                elem_name = getattr(elem, "name", None) or (
                    elem.get("name") if isinstance(elem, dict) else None
                )
                elem_type = getattr(elem, "speckle_type", None) or (
                    elem.get("speckle_type") if isinstance(elem, dict) else None
                )
                if (
                    elem_name == target
                    and elem_type in SpeckleService._SOUNDSCAPE_SPECKLE_TYPES
                ):
                    return (elements, idx)
        return (None, -1)

    def send_soundscape_data(self, model_id: str, soundscape_data: dict) -> Optional[str]:
        """
        Save soundscape data as proper Speckle objects on the model.

        Creates a ``Soundscape`` Collection (replaces the old DataObject)
        containing:

        - **Sound Sources** sub-collection with ``Point`` objects for
          free-standing sounds (``entity_index`` is ``None``).
        - **Receivers** sub-collection with ``Point`` objects.
        - Full metadata as ``properties`` on the Collection for round-trip
          loading.

        Also modifies existing entities in-place:

        - **Entity-linked sounds** (``entity_index`` is not ``None``):
          sound metadata written to the entity's ``properties`` (position
          flattened to ``position_x/y/z``), and ``color`` set to pink.
        - **Material assignments**: ``acoustic_material`` and
          ``acoustic_simulation_id`` written to each geometry object's
          ``properties``.

        All ``properties`` dicts respect Speckle's 2-level nesting maximum.

        Args:
            model_id: The Speckle model ID of the source 3D model.
            soundscape_data: Full soundscape dict (version, configs, events …)

        Returns:
            str: The new Speckle object ID if successful, None otherwise.
        """
        from services.speckle_soundscape_builder import build_soundscape_objects

        if not self.client or not self.project_id:
            logger.error("Not authenticated or no project selected.")
            return None

        try:
            transport = ServerTransport(
                stream_id=self.project_id, client=self.client
            )

            # ----- 1. Get latest version's root object -----
            root_object = None
            try:
                model_with_versions = self.client.model.get_with_versions(
                    model_id=model_id,
                    project_id=self.project_id,
                    versions_limit=1,
                )
                versions = model_with_versions.versions if model_with_versions else None
                if versions and versions.items:
                    latest = versions.items[0]
                    ref_obj = (
                        getattr(latest, "referenced_object", None)
                        or getattr(latest, "referencedObject", None)
                    )
                    if ref_obj:
                        logger.info(f"Receiving root object {ref_obj} for model {model_id}")
                        root_object = operations.receive(
                            obj_id=ref_obj, remote_transport=transport
                        )
            except Exception as e:
                logger.warning(f"Could not receive root object: {e}")

            if root_object is None:
                logger.warning("No root object found – creating empty wrapper")
                root_object = Base()

            # ----- 2. Build Speckle objects + modify entities -----
            soundscape_collection, sources_count, receivers_count, materials_count = (
                build_soundscape_objects(root_object, soundscape_data, model_id)
            )
            logger.info(
                f"Built Speckle objects: {sources_count} source points, "
                f"{receivers_count} receiver points, "
                f"{materials_count} material assignments"
            )

            # ----- 3. Insert Collection into root's @elements -----
            elements_attr = "@elements"
            if hasattr(root_object, "@elements"):
                elements_attr = "@elements"
            elif hasattr(root_object, "elements"):
                elements_attr = "elements"

            elements = getattr(root_object, elements_attr, None)
            if not isinstance(elements, list):
                elements = []

            # Remove any old Soundscape DataObject or Collection
            existing_list, existing_idx = self._find_soundscape_element(root_object)
            if existing_list is not None and existing_idx >= 0:
                existing_list[existing_idx] = soundscape_collection
                logger.info("Replaced existing Soundscape element in tree")
            else:
                elements.append(soundscape_collection)
                root_object[elements_attr] = elements
                logger.info("Appended Soundscape Collection to root elements")

            # Remove legacy @soundscape property (migration from old format)
            for legacy in ("@soundscape", "soundscape"):
                if hasattr(root_object, legacy):
                    try:
                        delattr(root_object, legacy)
                    except Exception:
                        pass

            # ----- 4. Send updated root & create version -----
            object_id = operations.send(base=root_object, transports=[transport])
            logger.info(f"Updated root with soundscape objects sent: {object_id}")

            version_input = CreateVersionInput(
                project_id=self.project_id,
                model_id=model_id,
                object_id=object_id,
                message="Updated with soundscape data",
            )
            version = self.client.version.create(version_input)
            logger.info(f"New version on model {model_id}: {version.id}")

            return object_id

        except Exception as e:
            logger.error(f"Failed to send soundscape data to Speckle: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return None

    @staticmethod
    def _parse_soundscape_object(soundscape_obj, model_id: str) -> dict:
        """
        Parse a Speckle soundscape object (DataObject *or* legacy Base) into
        a plain dict suitable for ``SoundscapeData`` construction.

        Handles both:
        - **New format**: ``DataObject`` with a ``properties`` dict.
        - **Legacy format**: ``Base`` with top-level JSON-string attributes.
        """
        # New format: DataObject with properties dict
        props = getattr(soundscape_obj, "properties", None)
        if isinstance(props, dict) and "sound_configs" in props:
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
                "grid_listeners": _load("grid_listeners", []),
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

        # Legacy format: direct attributes with JSON strings
        soundscape = {
            "version": getattr(soundscape_obj, "version", "1.0"),
            "model_id": getattr(soundscape_obj, "model_id", model_id),
            "model_name": getattr(soundscape_obj, "model_name", ""),
            "created_at": getattr(soundscape_obj, "created_at", ""),
            "global_settings": json.loads(
                getattr(soundscape_obj, "global_settings", "{}")
            ),
            "sound_configs": json.loads(
                getattr(soundscape_obj, "sound_configs", "[]")
            ),
            "sound_events": json.loads(
                getattr(soundscape_obj, "sound_events", "[]")
            ),
        }
        return soundscape

    def get_soundscape_data(self, model_id: str) -> Optional[dict]:
        """
        Retrieve soundscape data from the latest version of the given model.

        Search order:
        1. **Collection** named *Soundscape* (current format) — reads its
           ``properties`` via ``parse_soundscape_collection``.
        2. **DataObject** named *Soundscape* (prior format) — reads via
           ``_parse_soundscape_object``.
        3. **Legacy** ``@soundscape`` root property.

        Args:
            model_id: The Speckle model ID of the source 3D model.

        Returns:
            dict: The parsed soundscape data, or None if not found.
        """
        from services.speckle_soundscape_builder import parse_soundscape_collection

        if not self.client or not self.project_id:
            logger.error("Not authenticated or no project selected.")
            return None

        try:
            # Get latest version of this model
            model_with_versions = self.client.model.get_with_versions(
                model_id=model_id,
                project_id=self.project_id,
                versions_limit=1,
            )
            versions = model_with_versions.versions if model_with_versions else None
            if not versions or not versions.items:
                logger.info(f"No versions found for model {model_id}")
                return None

            latest_version = versions.items[0]
            ref_obj = (
                getattr(latest_version, "referenced_object", None)
                or getattr(latest_version, "referencedObject", None)
            )
            if not ref_obj:
                logger.warning("Latest version has no referenced object")
                return None

            # Receive root object
            transport = ServerTransport(
                stream_id=self.project_id, client=self.client
            )
            root_object = operations.receive(
                obj_id=ref_obj, remote_transport=transport
            )
            if not root_object:
                logger.warning("Failed to receive root object")
                return None

            # --- Strategy 1: Soundscape Collection or DataObject in elements ---
            elements_list, idx = self._find_soundscape_element(root_object)
            if elements_list is not None and idx >= 0:
                soundscape_obj = elements_list[idx]
                elem_type = getattr(soundscape_obj, "speckle_type", "") or ""

                if elem_type == "Speckle.Core.Models.Collections.Collection":
                    # New Collection format
                    soundscape = parse_soundscape_collection(
                        soundscape_obj, model_id
                    )
                    if soundscape:
                        logger.info(
                            f"Loaded soundscape Collection from Speckle: "
                            f"{len(soundscape.get('sound_configs', []))} configs, "
                            f"{len(soundscape.get('sound_events', []))} events"
                        )
                        return soundscape

                # DataObject format (fallback)
                soundscape = self._parse_soundscape_object(
                    soundscape_obj, model_id
                )
                logger.info(
                    f"Loaded soundscape DataObject from Speckle: "
                    f"{len(soundscape.get('sound_configs', []))} configs, "
                    f"{len(soundscape.get('sound_events', []))} events"
                )
                return soundscape

            # --- Strategy 2: Legacy @soundscape root property ---
            soundscape_obj = getattr(root_object, "@soundscape", None)
            if soundscape_obj is None:
                soundscape_obj = getattr(root_object, "soundscape", None)
            if soundscape_obj is not None:
                soundscape = self._parse_soundscape_object(soundscape_obj, model_id)
                logger.info(
                    f"Loaded legacy @soundscape from Speckle: "
                    f"{len(soundscape.get('sound_configs', []))} configs, "
                    f"{len(soundscape.get('sound_events', []))} events"
                )
                return soundscape

            logger.info("No soundscape data found on model")
            return None

        except Exception as e:
            logger.error(f"Failed to get soundscape data from Speckle: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return None
