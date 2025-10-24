import os
from fastapi import APIRouter, File, UploadFile, HTTPException
from compas_ifc.model import Model
from compas.datastructures import Mesh
import rhino3dm

from utils.helpers import rotate_y_up_to_z_up
from config.constants import SAMPLE_IFC_FILE_PATH, TEMP_UPLOADS_DIR

router = APIRouter()


@router.get("/api/analyze-ifc")
async def analyze_ifc():
    """
    Analyzes the sample IFC model and extracts entity information for sound generation.
    Returns: list of entities with their type, name, position, and geometry bounds.
    """
    if not os.path.exists(SAMPLE_IFC_FILE_PATH):
        raise HTTPException(status_code=404, detail=f"Sample IFC file not found at {SAMPLE_IFC_FILE_PATH}")

    try:
        model = Model(SAMPLE_IFC_FILE_PATH, load_geometries=True)

        # Get building elements
        entities = []
        if hasattr(model, 'building_elements'):
            entities = model.building_elements
            print(f"Found {len(entities)} building elements")

        analyzed_entities = []

        for i, entity in enumerate(entities):
            try:
                # Extract entity information
                entity_type = type(entity).__name__ if hasattr(entity, '__class__') else "Unknown"

                # Try to get entity name
                entity_name = None
                if hasattr(entity, 'Name'):
                    entity_name = entity.Name
                elif hasattr(entity, 'name'):
                    entity_name = entity.name

                # Get geometry to calculate position
                if not hasattr(entity, 'geometry'):
                    continue

                geom = entity.geometry
                if geom is None:
                    continue

                # Convert to mesh to get bounding box
                mesh = None
                if isinstance(geom, Mesh):
                    mesh = geom
                elif hasattr(geom, 'to_mesh'):
                    mesh = geom.to_mesh()
                elif hasattr(geom, 'to_vertices_and_faces'):
                    vertices, faces = geom.to_vertices_and_faces()
                    mesh = Mesh.from_vertices_and_faces(vertices, faces)

                if mesh and mesh.number_of_vertices() > 0:
                    # Calculate bounding box and centroid
                    vertices = list(mesh.vertices_attributes('xyz'))

                    min_coords = [min(v[i] for v in vertices) for i in range(3)]
                    max_coords = [max(v[i] for v in vertices) for i in range(3)]

                    # Calculate centroid (center of bounding box)
                    centroid = [(min_coords[i] + max_coords[i]) / 2 for i in range(3)]

                    # Rotate coordinates from Y-up to Z-up
                    rotated_centroid = rotate_y_up_to_z_up(centroid)
                    rotated_min = rotate_y_up_to_z_up(min_coords)
                    rotated_max = rotate_y_up_to_z_up(max_coords)

                    analyzed_entities.append({
                        "index": i,
                        "type": entity_type,
                        "name": entity_name,
                        "position": rotated_centroid,
                        "bounds": {
                            "min": rotated_min,
                            "max": rotated_max
                        }
                    })

            except Exception as e:
                print(f"Skipping entity {i} during analysis: {e}")
                continue

        print(f"Analyzed {len(analyzed_entities)} entities with geometry")
        return {"entities": analyzed_entities}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to analyze IFC: {str(e)}")


@router.post("/api/analyze-3dm")
async def analyze_3dm(file: UploadFile = File(...)):
    """
    Analyzes a 3DM model and extracts entity information for sound generation.
    Returns: list of objects with their type, name, layer, material, position, and geometry bounds.
    """
    os.makedirs(TEMP_UPLOADS_DIR, exist_ok=True)
    temp_path = os.path.join(TEMP_UPLOADS_DIR, file.filename)

    def get_bbox(geom):
        """Get bounding box from Rhino geometry"""
        try:
            bbox = None

            # Try GetBoundingBox method first
            if hasattr(geom, 'GetBoundingBox') and callable(geom.GetBoundingBox):
                try:
                    bbox = geom.GetBoundingBox(True)
                except TypeError:
                    # Some versions might not accept parameters
                    bbox = geom.GetBoundingBox()

            # Try BoundingBox property as fallback
            if not bbox and hasattr(geom, 'BoundingBox'):
                bbox = geom.BoundingBox

            if bbox:
                # Check if bbox is valid
                if hasattr(bbox, 'IsValid'):
                    if not bbox.IsValid:
                        return None

                # Extract coordinates
                if hasattr(bbox, 'Min') and hasattr(bbox, 'Max'):
                    return {
                        'min': [bbox.Min.X, bbox.Min.Y, bbox.Min.Z],
                        'max': [bbox.Max.X, bbox.Max.Y, bbox.Max.Z],
                        'center': [
                            (bbox.Min.X + bbox.Max.X) / 2,
                            (bbox.Min.Y + bbox.Max.Y) / 2,
                            (bbox.Min.Z + bbox.Max.Z) / 2
                        ]
                    }
        except Exception as e:
            print(f"  Error getting bbox for {type(geom).__name__}: {e}")
        return None

    try:
        # Save uploaded file
        with open(temp_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)

        # Read 3DM file
        file3dm = rhino3dm.File3dm.Read(temp_path)

        analyzed_objects = []

        print(f"Analyzing {len(file3dm.Objects)} objects...")

        # Analyze objects in the model
        for i, obj in enumerate(file3dm.Objects):
            try:
                geom = obj.Geometry
                attrs = obj.Attributes

                # Skip block instances
                if isinstance(geom, rhino3dm.InstanceReference):
                    continue

                # Get object attributes
                obj_type = type(geom).__name__
                obj_name = attrs.Name if attrs and attrs.Name else None

                # Get layer name
                layer_name = None
                if attrs and attrs.LayerIndex >= 0 and attrs.LayerIndex < len(file3dm.Layers):
                    layer = file3dm.Layers[attrs.LayerIndex]
                    if layer:
                        layer_name = layer.Name

                # Get material name
                material_name = None
                if attrs and attrs.MaterialIndex >= 0 and attrs.MaterialIndex < len(file3dm.Materials):
                    material = file3dm.Materials[attrs.MaterialIndex]
                    if material:
                        material_name = material.Name

                # Get bounding box
                bbox = get_bbox(geom)
                if bbox:
                    # Rotate from Y-up to Z-up
                    rotated_centroid = rotate_y_up_to_z_up(bbox['center'])
                    rotated_min = rotate_y_up_to_z_up(bbox['min'])
                    rotated_max = rotate_y_up_to_z_up(bbox['max'])

                    analyzed_objects.append({
                        "index": i,
                        "type": obj_type,
                        "name": obj_name,
                        "layer": layer_name,
                        "material": material_name,
                        "position": rotated_centroid,
                        "bounds": {
                            "min": rotated_min,
                            "max": rotated_max,
                            "center": rotated_centroid
                        }
                    })

            except Exception as e:
                print(f"Skipping object {i} during analysis: {e}")
                continue

        print(f"Analyzed {len(analyzed_objects)} objects with geometry")
        return {"entities": analyzed_objects}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to analyze 3DM: {str(e)}")
    finally:
        # Cleanup
        if os.path.exists(temp_path):
            os.remove(temp_path)
