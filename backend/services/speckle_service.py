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
from typing import Optional, Dict, List
from dotenv import load_dotenv
from gql import gql

from specklepy.api.client import SpeckleClient
from specklepy.api import operations
from specklepy.transports.server import ServerTransport
from specklepy.core.api.inputs.project_inputs import WorkspaceProjectCreateInput
from specklepy.core.api.inputs.model_inputs import CreateModelInput
from specklepy.core.api.inputs.version_inputs import CreateVersionInput
from specklepy.objects import Base
from specklepy.objects.data_objects import DataObject

from config.constants import (
    SPECKLE_SERVER_URL,
    SPECKLE_PROJECT_NAME,
    SPECKLE_SUPPORTED_FORMATS,
)


logger = logging.getLogger(__name__)


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
            token = os.getenv("SPECKLE_TOKEN")
            if not token:
                logger.error("SPECKLE_TOKEN environment variable not set")
                return False

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
            project_name = name or SPECKLE_PROJECT_NAME

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

                result = self.client.httpclient.execute(query, {"projectId": self.project_id})
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

    def upload_model(self, file_path: str, file_type: str, model_name: str = None) -> Optional[Dict]:
        """
        Upload 3dm/obj/ifc file to Speckle using the file upload API.

        This follows the proper Speckle file upload workflow:
        1. Generate presigned upload URL
        2. Upload file to S3
        3. Get or create model (reuses existing model to create new version)
        4. Trigger file import
        5. Return result (import happens asynchronously)

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
            
            response = self.client.httpclient.execute(generate_url_mutation, variables)
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

            # Step 4: Trigger file import
            logger.info("Step 4/5: Triggering file import...")
            start_import_mutation = gql("""
            mutation StartFileImport($input: StartFileImportInput!) {
                fileUploadMutations {
                    startFileImport(input: $input) {
                        id
                        convertedStatus
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
            
            import_response = self.client.httpclient.execute(start_import_mutation, import_variables)
            import_id = import_response["fileUploadMutations"]["startFileImport"]["id"]
            import_status = import_response["fileUploadMutations"]["startFileImport"]["convertedStatus"]
            logger.info(f"File import started: {import_id}, status: {import_status}")

            # Step 5: Return URL immediately - import happens asynchronously
            # The frontend can access the model once it's ready
            logger.info("Step 5/5: Import queued - Speckle will process the file in the background")
            
            # Build Speckle viewer URL pointing to the specific version
            # Include the version ID so the viewer can load the specific upload : REMOVED
            viewer_url = f"https://{SPECKLE_SERVER_URL}/projects/{self.project_id}/models/{model.id}"
            
            result = {
                "model_id": model.id,
                "version_id": import_id,
                "file_id": file_id,
                "url": viewer_url,
                "object_id": import_id
            }

            logger.info(f"File upload initiated: {result['url']}")
            logger.info("Note: Model will be available once Speckle completes the import")
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
                
                if version and version.referencedObject:
                    logger.info(f"Version found. Referenced Object ID: {version.referencedObject}")
                    object_id_to_receive = version.referencedObject
                else:
                    logger.warning(f"Version lookup succeeded but no referencedObject found")
                    raise Exception("No referencedObject in version")
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
        
        def extract_mesh_data(mesh):
            """Extract vertices and faces from a Speckle Mesh object"""
            if not isinstance(mesh, Mesh):
                return None
        def extract_mesh_data(mesh):
            """Extract vertices and faces from a Speckle Mesh object"""
            if not isinstance(mesh, Mesh):
                return None
                
            if not hasattr(mesh, 'vertices') or not hasattr(mesh, 'faces'):
                return None
            
            # Vertices are stored as flat list [x, y, z, x, y, z, ...]
            verts = []
            for i in range(0, len(mesh.vertices), 3):
                verts.append([
                    mesh.vertices[i],
                    mesh.vertices[i + 1],
                    mesh.vertices[i + 2]
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
        
        objects_with_display = []
        total_objects = 0
        object_types = {}
        
        # Track objects with their layer context
        def manual_traverse(obj, depth=0, current_layer=None):
            """Manually traverse object tree while tracking layer context"""
            nonlocal total_objects
            
            if not isinstance(obj, Base):
                return
            
            total_objects += 1
            obj_type = type(obj).__name__
            object_types[obj_type] = object_types.get(obj_type, 0) + 1
            
            # Update current layer if this object has a name and is not geometry
            # (layers/groups are Base objects with names, not Mesh objects)
            if hasattr(obj, 'name') and obj.name and not isinstance(obj, Mesh):
                # This might be a layer or group
                current_layer = obj.name
            
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
            
            # Check if this object has displayValue OR if it IS geometry itself
            if should_include:
                if hasattr(obj, 'displayValue') and obj.displayValue is not None:
                    objects_with_display.append(obj)
                elif isinstance(obj, Mesh):
                    # Object IS geometry (e.g., from Rhino/3dm files)
                    objects_with_display.append(obj)
            
            # Recurse through all properties, passing the current layer context
            for prop_name in obj.get_member_names():
                value = getattr(obj, prop_name, None)
                
                if isinstance(value, Base):
                    manual_traverse(value, depth + 1, current_layer)
                elif isinstance(value, list):
                    for item in value:
                        if isinstance(item, Base):
                            manual_traverse(item, depth + 1, current_layer)
        
        manual_traverse(root_object)
        
        logger.info(f"Total objects traversed: {total_objects}")
        logger.info(f"Object types found: {object_types}")
        logger.info(f"Found {len(objects_with_display)} objects with geometry (displayValue or direct Mesh)")
        
        object_ids_set = set(object_ids_filter) if object_ids_filter else None

        # Process each object with geometry
        for obj in objects_with_display:
            obj_id = getattr(obj, 'id', f"obj_{len(object_ids)}")
            obj_name = getattr(obj, 'name', f"Object {len(object_ids) + 1}")

            # When filtering by explicit object IDs, skip objects not in the list
            if object_ids_set is not None and obj_id not in object_ids_set:
                continue
            
            logger.info(f"Processing object: {obj_name} (id: {obj_id})")
            
            start_face = face_count
            
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
                object_face_ranges[obj_id] = [start_face, face_count - 1]
                logger.info(f"Added {face_count - start_face} faces from {obj_name}")
        
        logger.info(f"Total geometry extracted: {len(all_vertices)} vertices, {len(all_faces)} faces across {len(object_ids)} objects")
        
        return {
            "vertices": all_vertices,
            "faces": all_faces,
            "object_ids": object_ids,
            "object_names": object_names,
            "object_face_ranges": object_face_ranges
        }
    
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
